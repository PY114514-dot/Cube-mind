/**
 * ble/moyu-cube-protocol.ts
 * 魔域智能魔方 BLE 协议复刻（基于 cstimer/src/js/hardware/moyucube.js）
 *
 * 协议特征：
 *   - 明文传输，无加密
 *   - Service UUID: 00001000-0000-1000-8000-00805f9b34fb
 *   - 转动事件 characteristic: 00001003-0000-1000-8000-00805f9b34fb
 *   - 数据格式：[n_moves, ts_low, ts_high, ts_byte3, ts_byte4, face, dir] × n
 *
 * 文件结构：
 *   - parseTurn(): 纯函数，从 DataView 提取 move 列表（可单元测试）
 *   - MoyuCube: BLE 连接类（依赖 navigator.bluetooth）
 */

import type { CubeMove, CubeMoveCallback as CubeCallback, CubeBatteryCallback as BatteryCallback, CubeConnectCallback as ConnectCallback, CubeDisconnectCallback as DisconnectCallback, CubeDriver, CubeGyroCallback, CubeQuaternion } from "./cube-driver.ts";
import { Aes128 } from "./aes128.ts";
import { decodeGanValue, encodeGanValue, parseMac, normalizeMac, type GanDecoder } from "./gan-crypto.ts";
import { decodeCompressedKey } from "./gan-crypto-helpers.ts";

const UUID_SUFFIX = "-0000-1000-8000-00805f9b34fb";
export const MOYU_SERVICE_UUID = `00001000${UUID_SUFFIX}`;
export const MOYU_CHRCT_UUID_READ = `00001002${UUID_SUFFIX}`;
export const MOYU_CHRCT_UUID_TURN = `00001003${UUID_SUFFIX}`;
export const MOYU_CHRCT_UUID_GYRO = `00001004${UUID_SUFFIX}`;

export const MOYU32_SERVICE_UUID = "0783b03e-7735-b5a0-1760-a305d2795cb0";
export const MOYU32_CHRCT_UUID_READ = "0783b03e-7735-b5a0-1760-a305d2795cb1";
export const MOYU32_CHRCT_UUID_WRITE = "0783b03e-7735-b5a0-1760-a305d2795cb2";

const MOYU32_CIC_LIST = Array.from({ length: 255 }, (_, i) => (i + 1) << 8);
const MOYU32_KEY = "NoJgjANGYJwQrADgjEUAMBmKAWCP4JNIRswt81Yp5DztE1EB2AXSA";
const MOYU32_IV = "NoRg7ANAzArNAc1IigFgqgTB9MCcE8cAbBCJpKgeaSAAxTSPxgC6QA";

/** face 编号到 axis 的映射：[3,4,5,1,2,0]（cstimer moyucube.js:84） */
const FACE_TO_AXIS: readonly number[] = [3, 4, 5, 1, 2, 0];
const FACE_NAMES = "URFDLB";

/** 单个 turn 事件的结构化结果 */
export interface ParsedTurn {
  move: string;
  face: number;
  dir: number;
  timestamp: number; // 设备本地时间戳（毫秒）
}

export interface ParsedMoyu32Event {
  type: "info" | "state" | "battery" | "move" | "unknown";
  moveCnt?: number;
  moves?: ParsedTurn[];
  batteryLevel?: number;
  deviceName?: string;
  hardwareVersion?: string;
  softwareVersion?: string;
}

const MOYU32_GYRO_RESPONSE = 0xab;
const MOYU32_GYRO_REQUEST = 0xac;
const MOYU32_GYRO_SCALE = 1_073_741_824;

/**
 * 解析 WCU_MY32 的姿态通知。DCTimer-BLE 已验证该包为 0xAB + 4 个
 * little-endian int32（w/x/y/z），数值缩放为 2^30。
 */
export function parseMoyu32Gyro(data: number[]): CubeQuaternion | null {
  if (data.length < 17 || data[0] !== MOYU32_GYRO_RESPONSE) return null;
  const bytes = new Uint8Array(data.slice(0, 17));
  const view = new DataView(bytes.buffer);
  const w = view.getInt32(1, true) / MOYU32_GYRO_SCALE;
  const x = view.getInt32(5, true) / MOYU32_GYRO_SCALE;
  const y = view.getInt32(9, true) / MOYU32_GYRO_SCALE;
  const z = view.getInt32(13, true) / MOYU32_GYRO_SCALE;
  const length = Math.hypot(w, x, y, z);
  if (!Number.isFinite(length) || length < 0.0001) return null;
  // WCU 传感器坐标系与页面坐标系不同；映射与 DCTimer-BLE 保持一致。
  return { x: x / length, y: z / length, z: -y / length, w: w / length };
}

/** MHC 陀螺特征值的原始通知；尚未假设未经验证的四元数编码。 */
export interface MoyuGyroRawEvent {
  bytes: number[];
  locTime: number;
}

export type MoyuGyroRawCallback = (event: MoyuGyroRawEvent) => void;

/**
 * 纯函数：解析魔域魔方的 turn 事件 DataView
 * 复刻 cstimer moyucube.js parseTurn()
 *
 * @param data BLE characteristic value DataView
 * @param locTime 浏览器接收时间（Date.now()）
 * @param faceStatus 累计的面状态数组（length=6，跨多次调用保持）
 * @returns 解析出的 move 列表
 */
export function parseTurn(
  data: DataView,
  _locTime: number,
  faceStatus: number[]
): ParsedTurn[] {
  if (data.byteLength < 1) return [];

  const nMoves = data.getUint8(0);
  if (data.byteLength < 1 + nMoves * 6) return [];

  const results: ParsedTurn[] = [];
  for (let i = 0; i < nMoves; i++) {
    const offset = 1 + i * 6;
    // 时间戳：4 字节组合 / 65536 * 1000（>>> 0 强制无符号，避免高位 ≥128 时溢出为负）
    const ts = (
      (data.getUint8(offset + 1) << 24) |
      (data.getUint8(offset + 0) << 16) |
      (data.getUint8(offset + 3) << 8) |
      data.getUint8(offset + 2)
    ) >>> 0;
    const tsMs = Math.round((ts / 65536) * 1000);

    const face = data.getUint8(offset + 4);
    const dir = Math.round(data.getUint8(offset + 5) / 36);

    // 畸形包可能产生 face >= 6，跳过以避免 NaN 污染 faceStatus
    if (face >= 6) continue;

    const prevRot = faceStatus[face];
    const curRot = faceStatus[face] + dir;
    faceStatus[face] = (curRot + 9) % 9;

    // 只有 4→5（顺时针）或 5→4（逆时针）跨越中线时才算有效转动
    let power = 0;
    if (prevRot >= 5 && curRot <= 4) {
      power = 2; // 逆时针 90°
    } else if (prevRot <= 4 && curRot >= 5) {
      power = 0; // 顺时针 90°
    } else {
      continue; // 跨越中线失败，可能是噪声
    }

    const axis = FACE_TO_AXIS[face];
    const suffix = power === 1 ? "2" : power === 2 ? "'" : "";
    const moveStr = FACE_NAMES.charAt(axis) + suffix;

    results.push({
      move: moveStr,
      face,
      dir,
      timestamp: tsMs,
    });
  }

  return results;
}

export function parseMoyu32Data(data: number[], prevMoveCnt: number): ParsedMoyu32Event {
  const binaryStr = data.map((b) => b.toString(2).padStart(8, "0")).join("");
  const msgType = parseInt(binaryStr.slice(0, 8), 2);

  if (msgType === 161) {
    let deviceName = "";
    for (let i = 0; i < 8; i++) {
      deviceName += String.fromCharCode(parseInt(binaryStr.slice(8 + i * 8, 16 + i * 8), 2));
    }
    return {
      type: "info",
      deviceName,
      hardwareVersion: `${parseInt(binaryStr.slice(72, 80), 2)}.${parseInt(binaryStr.slice(80, 88), 2)}`,
      softwareVersion: `${parseInt(binaryStr.slice(88, 96), 2)}.${parseInt(binaryStr.slice(96, 104), 2)}`,
    };
  }

  if (msgType === 163) {
    return {
      type: "state",
      moveCnt: parseInt(binaryStr.slice(152, 160), 2),
    };
  }

  if (msgType === 164) {
    return {
      type: "battery",
      batteryLevel: parseInt(binaryStr.slice(8, 16), 2),
    };
  }

  if (msgType === 165) {
    const moveCnt = parseInt(binaryStr.slice(88, 96), 2);
    if (moveCnt === prevMoveCnt || prevMoveCnt === -1) {
      return { type: "move", moveCnt, moves: [] };
    }

    const moves: ParsedTurn[] = [];
    let invalidMove = false;
    for (let i = 0; i < 5; i++) {
      const m = parseInt(binaryStr.slice(96 + i * 5, 101 + i * 5), 2);
      const timestamp = parseInt(binaryStr.slice(8 + i * 16, 24 + i * 16), 2);
      if (m >= 12) {
        invalidMove = true;
        continue;
      }
      moves.push({
        move: "FBUDLR".charAt(m >> 1) + ((m & 1) === 1 ? "'" : ""),
        face: m >> 1,
        dir: (m & 1) === 1 ? -1 : 1,
        timestamp,
      });
    }
    return { type: "move", moveCnt, moves: invalidMove ? [] : moves };
  }

  return { type: "unknown" };
}

class Moyu32Decoder implements GanDecoder {
  private aes: Aes128;

  constructor(public key: Uint8Array, public iv: Uint8Array) {
    this.aes = new Aes128(key);
  }

  async decryptBlock(block: Uint8Array): Promise<Uint8Array> {
    return this.aes.decrypt(block);
  }

  async encryptBlock(block: Uint8Array): Promise<Uint8Array> {
    return this.aes.encrypt(block);
  }
}

function createMoyu32Decoder(mac: string): GanDecoder {
  const key = new Uint8Array(decodeCompressedKey(MOYU32_KEY));
  const iv = new Uint8Array(decodeCompressedKey(MOYU32_IV));
  const macBytes = parseMac(normalizeMac(mac));
  for (let i = 0; i < 6; i++) {
    key[i] = (key[i] + macBytes[5 - i]) % 255;
    iv[i] = (iv[i] + macBytes[5 - i]) % 255;
  }
  return new Moyu32Decoder(key, iv);
}

/** 创建一个新的魔域魔方实例 */
export class MoyuCube implements CubeDriver {
  readonly brand = "魔域";
  readonly needsMac = true;
  readonly macStorageKey = "cubemind:moyu-mac";

  private device: BluetoothDevice | null = null;
  private deviceName: string | null = null;
  private readChar: BluetoothRemoteGATTCharacteristic | null = null;
  private writeChar: BluetoothRemoteGATTCharacteristic | null = null;
  private decoder: GanDecoder | null = null;
  private macAddress: string | null = null;
  private faceStatus: number[] = [0, 0, 0, 0, 0, 0];
  private prevMoveCnt = -1;
  private isMoyu32 = false;

  private onMoveCb: CubeCallback | null = null;
  private onBatteryCb: BatteryCallback | null = null;
  private onConnectCb: ConnectCallback | null = null;
  private onDisconnectCb: DisconnectCallback | null = null;
  private onGyroCb: CubeGyroCallback | null = null;
  private onGyroRawCb: MoyuGyroRawCallback | null = null;

  // 命名事件处理器引用（disconnect 时需 removeEventListener 防止泄漏）
  private boundOnGattDisconnect: (() => void) | null = null;
  private boundOnTurnChanged: ((e: Event) => void) | null = null;
  private boundOnGyroChanged: ((e: Event) => void) | null = null;
  private boundOnReadChanged: ((e: Event) => void) | null = null;
  private turnChar: BluetoothRemoteGATTCharacteristic | null = null;
  private gyroChar: BluetoothRemoteGATTCharacteristic | null = null;

  get supportsGyro(): boolean { return this.isMoyu32; }

  async connect(preferredMac?: string): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error("当前浏览器不支持 Web Bluetooth API");
    }

    console.log("[moyu-cube] 开始扫描...");

    try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: "MHC" },
        { namePrefix: "WCU_MY3" },
      ],
      optionalServices: [MOYU_SERVICE_UUID, MOYU32_SERVICE_UUID],
      optionalManufacturerData: MOYU32_CIC_LIST,
    });

    this.device = device;
    this.deviceName = (device.name || "Unknown MoYu Cube").trim();
    console.log(`[moyu-cube] 选中设备: ${this.deviceName}`);

    this.boundOnGattDisconnect = () => this.handleDisconnect();
    device.addEventListener("gattserverdisconnected", this.boundOnGattDisconnect);

    if (this.deviceName && this.deviceName.startsWith("WCU_MY3")) {
      this.isMoyu32 = true;
      await this.connectMoyu32(device, preferredMac);
    } else {
      this.isMoyu32 = false;
      await this.connectMhc(device);
    }

    console.log("[moyu-cube] 连接成功");
    this.onConnectCb?.();
    } catch (error) {
      console.error("[moyu-cube] connection failed:", error);
      await this.disconnect();
      throw new Error(`[moyu-cube] connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async connectMhc(device: BluetoothDevice): Promise<void> {
    if (!device.gatt) throw new Error("GATT 不可用");
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(MOYU_SERVICE_UUID);
    const chars = await service.getCharacteristics();

    this.turnChar = chars.find((c) => c.uuid.toUpperCase() === MOYU_CHRCT_UUID_TURN.toUpperCase()) || null;

    if (!this.turnChar) throw new Error("找不到 turn characteristic");

    this.boundOnTurnChanged = (e: Event) => {
      const value = (e.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;
      this.handleTurn(value, Date.now());
    };
    this.turnChar.addEventListener("characteristicvaluechanged", this.boundOnTurnChanged);

    const readChar = chars.find((c) => c.uuid.toUpperCase() === MOYU_CHRCT_UUID_READ.toUpperCase());
    this.gyroChar = chars.find((c) => c.uuid.toUpperCase() === MOYU_CHRCT_UUID_GYRO.toUpperCase()) || null;
    if (this.gyroChar) {
      this.boundOnGyroChanged = (event: Event) => {
        const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
        if (!value) return;
        this.onGyroRawCb?.({
          bytes: Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)),
          locTime: Date.now(),
        });
      };
      this.gyroChar.addEventListener("characteristicvaluechanged", this.boundOnGyroChanged);
    }
    await Promise.all([
      readChar?.startNotifications(),
      this.turnChar.startNotifications(),
      this.gyroChar?.startNotifications(),
    ]);
  }

  private async connectMoyu32(device: BluetoothDevice, preferredMac?: string): Promise<void> {
    const mac = await this.extractMoyu32Mac();
    const fallbackMac = this.getMoyu32FallbackMac();
    const activeMac = preferredMac?.trim() || this.macAddress || mac || fallbackMac;
    if (!activeMac) {
      throw new Error("无法获取魔域 WCU MAC 地址，请先在 WCU Cube App 绑定魔方后再试");
    }
    await this.setMacAddress(activeMac);
    console.log(`[moyu-cube] WCU decoder ready (MAC=${activeMac})`);

    if (!device.gatt) throw new Error("GATT 不可用");
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(MOYU32_SERVICE_UUID);
    const chars = await service.getCharacteristics();
    this.readChar = chars.find((c) => c.uuid.toUpperCase() === MOYU32_CHRCT_UUID_READ.toUpperCase()) || null;
    this.writeChar = chars.find((c) => c.uuid.toUpperCase() === MOYU32_CHRCT_UUID_WRITE.toUpperCase()) || null;
    if (!this.readChar || !this.writeChar) throw new Error("找不到魔域 WCU read/write characteristic");

    this.boundOnReadChanged = (e: Event) => {
      const value = (e.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;
      this.handleMoyu32(value, Date.now()).catch((err) => console.error("[moyu-cube] WCU event error:", err));
    };
    this.readChar.addEventListener("characteristicvaluechanged", this.boundOnReadChanged);
    await this.readChar.startNotifications();
    await this.sendMoyu32Request(161);
    await this.sendMoyu32Request(163);
    await this.sendMoyu32Request(164);
    await this.sendMoyu32GyroEnableRequest();
    await this.sendMoyu32Request(163);
  }

  /** 处理 turn 事件，喂入 parseTurn 并触发回调 */
  private handleTurn(data: DataView, locTime: number): void {
    const results = parseTurn(data, locTime, this.faceStatus);
    for (const r of results) {
      const move: CubeMove = {
        move: r.move,
        timestamp: r.timestamp,
        locTime,
        moveCnt: -1, // 魔域无 moveCnt
      };
      this.onMoveCb?.(move);
    }
  }

  private async handleMoyu32(data: DataView, locTime: number): Promise<void> {
    const bytes = await this.decodeMoyu32(data);
    const gyro = parseMoyu32Gyro(bytes);
    if (gyro) {
      this.onGyroCb?.(gyro);
      return;
    }
    const event = parseMoyu32Data(bytes, this.prevMoveCnt);
    if (event.type === "state" && event.moveCnt !== undefined && this.prevMoveCnt === -1) {
      this.prevMoveCnt = event.moveCnt;
      console.log(`[moyu-cube] WCU 初始状态 moveCnt=${event.moveCnt}`);
      return;
    }
    if (event.type === "battery" && event.batteryLevel !== undefined) {
      this.onBatteryCb?.(event.batteryLevel);
      return;
    }
    if (event.type === "info") {
      console.log(`[moyu-cube] WCU ${event.deviceName} HW=${event.hardwareVersion} SW=${event.softwareVersion}`);
      return;
    }
    if (event.type !== "move" || !event.moves || event.moveCnt === undefined) return;

    const moveDiff = (event.moveCnt - this.prevMoveCnt) & 0xff;
    this.prevMoveCnt = event.moveCnt;
    const moves = event.moves.slice(0, Math.min(moveDiff, event.moves.length));
    for (let i = moves.length - 1; i >= 0; i--) {
      this.onMoveCb?.({
        move: moves[i].move,
        timestamp: moves[i].timestamp,
        locTime: i === 0 ? locTime : locTime - (moves.length - i) * 10,
        moveCnt: (event.moveCnt - i) & 0xff,
      });
    }
  }

  private async sendMoyu32Request(opcode: number): Promise<void> {
    if (!this.writeChar) return;
    const req = new Array(20).fill(0);
    req[0] = opcode;
    const encoded = this.decoder ? await encodeGanValue(this.decoder, req) : req;
    await this.writeChar.writeValue(new Uint8Array(encoded).buffer);
  }

  private async sendMoyu32GyroEnableRequest(): Promise<void> {
    if (!this.writeChar) return;
    const req = new Array(20).fill(0);
    req[0] = MOYU32_GYRO_REQUEST;
    req[2] = 1;
    const encoded = this.decoder ? await encodeGanValue(this.decoder, req) : req;
    await this.writeChar.writeValue(new Uint8Array(encoded).buffer);
  }

  private async decodeMoyu32(value: DataView): Promise<number[]> {
    const raw = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (!this.decoder) return Array.from(raw);
    const decrypted = await decodeGanValue(this.decoder, raw);
    return Array.from(decrypted);
  }

  private async extractMoyu32Mac(): Promise<string | null> {
    const watchAdvertisements = this.device?.watchAdvertisements?.bind(this.device);
    if (!this.device || !watchAdvertisements) return null;
    return new Promise((resolve) => {
      const abortController = new AbortController();
      const timeout = setTimeout(() => {
        this.device?.removeEventListener("advertisementreceived", handler);
        abortController.abort();
        resolve(null);
      }, 5000);

      const handler = (event: Event) => {
        const adv = event as unknown as { manufacturerData?: Map<number, DataView> };
        const mfData = adv.manufacturerData;
        if (!mfData) return;
        for (const cic of MOYU32_CIC_LIST) {
          const data = mfData.get(cic);
          if (!data || data.byteLength < 6) continue;
          const bytes: number[] = [];
          for (let i = 0; i < 6; i++) {
            bytes.push(data.getUint8(data.byteLength - i - 1));
          }
          clearTimeout(timeout);
          this.device?.removeEventListener("advertisementreceived", handler);
          abortController.abort();
          resolve(bytes.map((b) => b.toString(16).padStart(2, "0")).join(":"));
          return;
        }
      };

      this.device!.addEventListener("advertisementreceived", handler);
      watchAdvertisements({ signal: abortController.signal }).catch(() => {});
    });
  }

  private getMoyu32FallbackMac(): string | null {
    if (!this.deviceName || !/^WCU_MY32_[0-9A-F]{4}$/.test(this.deviceName)) return null;
    return `CF:30:16:00:${this.deviceName.slice(9, 11)}:${this.deviceName.slice(11, 13)}`;
  }

  private handleDisconnect(): void {
    console.log("[moyu-cube] 设备已断开");

    // 移除事件监听器，防止重连时泄漏
    if (this.device && this.boundOnGattDisconnect) {
      this.device.removeEventListener("gattserverdisconnected", this.boundOnGattDisconnect);
    }
    if (this.turnChar && this.boundOnTurnChanged) {
      this.turnChar.removeEventListener("characteristicvaluechanged", this.boundOnTurnChanged);
      this.turnChar.stopNotifications().catch(() => {});
    }
    if (this.gyroChar && this.boundOnGyroChanged) {
      this.gyroChar.removeEventListener("characteristicvaluechanged", this.boundOnGyroChanged);
      this.gyroChar.stopNotifications().catch(() => {});
    }
    if (this.readChar && this.boundOnReadChanged) {
      this.readChar.removeEventListener("characteristicvaluechanged", this.boundOnReadChanged);
      this.readChar.stopNotifications().catch(() => {});
    }

    this.boundOnGattDisconnect = null;
    this.boundOnTurnChanged = null;
    this.boundOnGyroChanged = null;
    this.boundOnReadChanged = null;
    this.device = null;
    this.readChar = null;
    this.writeChar = null;
    this.turnChar = null;
    this.gyroChar = null;
    this.decoder = null;
    this.faceStatus = [0, 0, 0, 0, 0, 0];
    this.prevMoveCnt = -1;
    this.isMoyu32 = false;
    this.onDisconnectCb?.();
  }

  async disconnect(): Promise<void> {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.handleDisconnect();
  }

  getName(): string | null { return this.deviceName; }

  getMacAddress(): string | null { return this.macAddress; }

  async setMacAddress(mac: string): Promise<void> {
    const normalized = normalizeMac(mac);
    this.decoder = createMoyu32Decoder(normalized);
    this.macAddress = normalized;
  }

  /** 暴露给测试用：重置内部 faceStatus */
  resetFaceStatus(): void {
    this.faceStatus = [0, 0, 0, 0, 0, 0];
  }

  onMove(cb: CubeCallback): void { this.onMoveCb = cb; }
  onBattery(cb: BatteryCallback): void { this.onBatteryCb = cb; }
  onGyro(cb: CubeGyroCallback): void { this.onGyroCb = cb; }
  onGyroRaw(cb: MoyuGyroRawCallback): void { this.onGyroRawCb = cb; }
  onConnect(cb: ConnectCallback): void { this.onConnectCb = cb; }
  onDisconnect(cb: DisconnectCallback): void { this.onDisconnectCb = cb; }

  /** 重连到之前已授权的设备（不弹选择器），失败时 reject */
  async reconnect(): Promise<void> {
    if (!this.device?.gatt) throw new Error("无已授权设备，无法重连");
    this.boundOnGattDisconnect = () => this.handleDisconnect();
    this.device.addEventListener("gattserverdisconnected", this.boundOnGattDisconnect);
    const server = await this.device.gatt.connect();
    // 根据设备名判断协议类型并重新订阅
    if (this.deviceName?.startsWith("WCU_MY3")) {
      this.isMoyu32 = true;
      const service = await server.getPrimaryService(MOYU32_SERVICE_UUID);
      const chars = await service.getCharacteristics();
      this.writeChar = chars.find((c) => c.uuid.toUpperCase() === MOYU32_CHRCT_UUID_WRITE.toUpperCase()) ?? null;
      const readChar = chars.find((c) => c.uuid.toUpperCase() === MOYU32_CHRCT_UUID_READ.toUpperCase());
      if (!readChar) throw new Error("重连失败：找不到 WCU read characteristic");
      this.boundOnReadChanged = (e: Event) => {
        const value = (e.target as BluetoothRemoteGATTCharacteristic).value;
        if (!value) return;
        this.handleMoyu32(value, Date.now()).catch((err) => console.error("[moyu-cube] WCU reconnect event error:", err));
      };
      readChar.addEventListener("characteristicvaluechanged", this.boundOnReadChanged);
      await readChar.startNotifications();
      this.readChar = readChar;
      await this.sendMoyu32Request(161);
      await this.sendMoyu32Request(163);
      await this.sendMoyu32Request(164);
      await this.sendMoyu32GyroEnableRequest();
      await this.sendMoyu32Request(163);
    } else {
      this.isMoyu32 = false;
      const service = await server.getPrimaryService(MOYU_SERVICE_UUID);
      const chars = await service.getCharacteristics();
      const turnChar = chars.find((c) => c.uuid.toUpperCase() === MOYU_CHRCT_UUID_TURN.toUpperCase());
      if (!turnChar) throw new Error("重连失败：找不到 MHC turn characteristic");
      this.boundOnTurnChanged = (e: Event) => {
        const value = (e.target as BluetoothRemoteGATTCharacteristic).value;
        if (!value) return;
        this.handleTurn(value, Date.now());
      };
      turnChar.addEventListener("characteristicvaluechanged", this.boundOnTurnChanged);
      await turnChar.startNotifications();
      this.turnChar = turnChar;
    }
    this.onConnectCb?.();
  }
}

export const moyuCube = new MoyuCube();
