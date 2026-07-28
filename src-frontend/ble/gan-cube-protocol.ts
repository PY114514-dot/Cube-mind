/**
 * ble/gan-cube-protocol.ts
 * GAN 智能魔方 BLE 协议复刻（基于 cstimer/src/js/hardware/gancube.js）
 *
 * 支持的协议版本：
 *   v1  老款 GAN（UUID 0xfff0 0xfff2 0xfff5 0xfff6 0xfff7）
 *   v2  GAN 356 i 系列（UUID 6e400001-b5a3... + AES 加密）
 *   v3  GAN 13/i3（UUID 8653000a-43e6...）
 *   v4  最新 GAN（UUID 00000010-0000-fff7...）
 *
 * ✅ MVP 完整实现 v2 加密（基于 gan-crypto.ts + Web Crypto API）
 * ⚠️ v3/v4 协议作为后续扩展
 */

import { createDecoder, decodeGanValue, encodeGanValue, normalizeMac, type GanDecoder } from "./gan-crypto.ts";
import { BlePacketProtocol, BlePacketRecorder } from "./ble-packet-harness.ts";

// ============== UUID 定义（与 cstimer 一致） ==============
const UUID_SUFFIX = "-0000-1000-8000-00805f9b34fb";

const SERVICE_UUID_META = `0000180a${UUID_SUFFIX}`;
const SERVICE_UUID_DATA = `0000fff0${UUID_SUFFIX}`;
const SERVICE_UUID_V2DATA = "6e400001-b5a3-f393-e0a9-e50e24dc4179";
const SERVICE_UUID_V3DATA = "8653000a-43e6-47b7-9cb0-5fc21d4ae340";
const SERVICE_UUID_V4DATA = "00000010-0000-fff7-fff6-fff5fff4fff0";

const CHRCT_UUID_V2READ = "28be4cb6-cd67-11e9-a32f-2a2ae2dbcce4";
const CHRCT_UUID_V2WRITE = "28be4a4a-cd67-11e9-a32f-2a2ae2dbcce4";

const CHRCT_UUID_V4READ = "0000fff6-0000-1000-8000-00805f9b34fb";
const CHRCT_UUID_V4WRITE = "0000fff5-0000-1000-8000-00805f9b34fb";

const ALL_GAN_SERVICES = [
  SERVICE_UUID_DATA,
  SERVICE_UUID_META,
  SERVICE_UUID_V2DATA,
  SERVICE_UUID_V3DATA,
  SERVICE_UUID_V4DATA,
];

const GAN_V4_AXIS_MASKS = [2, 32, 8, 1, 16, 4];
const GAN_CIC_LOW_BYTE = 0x01;

function createGanCicList(): number[] {
  return Array.from({ length: 256 }, (_, index) => (index << 8) | GAN_CIC_LOW_BYTE);
}

/** GAN 的已知 CIC 范围为 0x0001 到 0xFF01，而非高字节固定。 */
export function isGanCompanyIdentifier(companyId: number): boolean {
  return Number.isInteger(companyId)
    && companyId >= 0
    && companyId <= 0xffff
    && (companyId & 0xff) === GAN_CIC_LOW_BYTE;
}

function findGanManufacturerData(data: Map<number, DataView>): DataView | null {
  for (const [companyId, value] of data) {
    if (isGanCompanyIdentifier(companyId) && value.byteLength >= 6) return value;
  }
  return null;
}

// ============== 类型定义 ==============

/** 单个 move 事件 */
export interface CubeMove {
  /** move 字符串，如 "R", "U'", "F2" */
  move: string;
  /** 设备本地时间戳（毫秒） */
  timestamp: number;
  /** 浏览器接收时间（毫秒，Date.now()） */
  locTime: number;
  /** move 序号（0-255 循环） */
  moveCnt: number;
}

/** 解法记录（一次完整还原） */
export interface SolveRecord {
  /** 打乱序列 */
  scramble: string;
  /** move 序列（从打乱状态到还原） */
  moves: CubeMove[];
  /** 开始时间戳 */
  startTime: number;
  /** 结束时间戳 */
  endTime: number;
  /** 总用时（毫秒） */
  duration: number;
}

/** 回调函数签名 */
export type CubeCallback = (move: CubeMove) => void;
export type BatteryCallback = (level: number) => void;
export type ConnectCallback = () => void;
export type DisconnectCallback = () => void;

export interface CubeQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface GanGyroEvent {
  quaternion: CubeQuaternion;
  velocity: { x: number; y: number; z: number };
  locTime: number;
}

export type GyroCallback = (event: GanGyroEvent) => void;

export interface GanV2MovePacket {
  moveCnt: number;
  moves: { move: string; timestamp: number; moveCnt: number }[];
}

export interface GanHistoryMove {
  move: string;
  moveCnt: number;
}

export interface GanV4MoveHistoryPacket {
  startMoveCnt: number;
  moves: GanHistoryMove[];
}

interface BufferedMove {
  moveCnt: number;
  move: string;
  timestamp: number | null;
  locTime: number | null;
}

/** 按设备计数从 v2 的 7 步历史窗口中提取本次通知新增的 move。 */
export function parseGanV2MovePacket(bytes: number[], prevMoveCnt: number): GanV2MovePacket | null {
  const binaryStr = bytes.map((b) => b.toString(2).padStart(8, "0")).join("");
  if (binaryStr.length < 159 || parseInt(binaryStr.slice(0, 4), 2) !== 2) return null;

  const moveCnt = parseInt(binaryStr.slice(4, 12), 2);
  if (prevMoveCnt === -1 || moveCnt === prevMoveCnt) return { moveCnt, moves: [] };

  const moveDiff = (moveCnt - prevMoveCnt) & 0xff;
  const count = Math.min(moveDiff, 7);
  const window: { move: string; timestamp: number }[] = [];
  for (let i = 0; i < count; i++) {
    const encodedMove = parseInt(binaryStr.slice(12 + i * 5, 17 + i * 5), 2);
    if (encodedMove >= 12) return { moveCnt, moves: [] };
    const timestamp = parseInt(binaryStr.slice(47 + i * 16, 63 + i * 16), 2);
    const face = "URFDLB".charAt(encodedMove >> 1);
    window.push({ move: face + ((encodedMove & 1) === 1 ? "'" : ""), timestamp });
  }

  const moves: { move: string; timestamp: number; moveCnt: number }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    moves.push({ ...window[i], moveCnt: (moveCnt - i) & 0xff });
  }
  return { moveCnt, moves };
}

function decodeSignedMagnitude(value: number, magnitudeBits: number): number {
  const sign = value >> magnitudeBits;
  const magnitude = value & ((1 << magnitudeBits) - 1);
  return sign === 0 ? magnitude : -magnitude;
}

/** 解析 GAN v2 的姿态四元数与三轴角速度（协议 mode=1）。 */
export function parseGanV2GyroPacket(bytes: number[]): Omit<GanGyroEvent, "locTime"> | null {
  const bits = bytes.map((byte) => byte.toString(2).padStart(8, "0")).join("");
  if (bits.length < 80 || parseInt(bits.slice(0, 4), 2) !== 1) return null;
  const read = (start: number, length: number): number => parseInt(bits.slice(start, start + length), 2);
  const quaternion = {
    w: decodeSignedMagnitude(read(4, 16), 15) / 0x7fff,
    x: decodeSignedMagnitude(read(20, 16), 15) / 0x7fff,
    y: decodeSignedMagnitude(read(36, 16), 15) / 0x7fff,
    z: decodeSignedMagnitude(read(52, 16), 15) / 0x7fff,
  };
  return {
    quaternion,
    velocity: {
      x: decodeSignedMagnitude(read(68, 4), 3),
      y: decodeSignedMagnitude(read(72, 4), 3),
      z: decodeSignedMagnitude(read(76, 4), 3),
    },
  };
}

export function parseGanV4MoveHistoryPacket(bytes: number[]): GanV4MoveHistoryPacket | null {
  const binaryStr = bytes.map((b) => b.toString(2).padStart(8, "0")).join("");
  if (binaryStr.length < 24 || parseInt(binaryStr.slice(0, 8), 2) !== 0xd1) return null;
  const len = parseInt(binaryStr.slice(8, 16), 2);
  const startMoveCnt = parseInt(binaryStr.slice(16, 24), 2);
  const numberOfMoves = Math.max(0, (len - 1) * 2);
  const moves: GanHistoryMove[] = [];
  for (let i = 0; i < numberOfMoves; i++) {
    const axis = parseInt(binaryStr.slice(24 + 4 * i, 27 + 4 * i), 2);
    const pow = parseInt(binaryStr.slice(27 + 4 * i, 28 + 4 * i), 2);
    if (axis < 6) {
      moves.push({
        move: "DUBFLR".charAt(axis) + (pow === 1 ? "'" : ""),
        moveCnt: (startMoveCnt - i) & 0xff,
      });
    }
  }
  return { startMoveCnt, moves };
}

function isMoveNumberInRange(start: number, end: number, moveCnt: number, closedStart = false, closedEnd = false): boolean {
  return ((end - start) & 0xff) >= ((moveCnt - start) & 0xff)
    && (closedStart || ((start - moveCnt) & 0xff) > 0)
    && (closedEnd || ((end - moveCnt) & 0xff) > 0);
}

// ============== GAN Cube 类 ==============

export class GanCube {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private v2ReadChar: BluetoothRemoteGATTCharacteristic | null = null;
  private v2WriteChar: BluetoothRemoteGATTCharacteristic | null = null;
  private v4ReadChar: BluetoothRemoteGATTCharacteristic | null = null;
  private v4WriteChar: BluetoothRemoteGATTCharacteristic | null = null;
  private deviceName: string | null = null;
  private prevMoveCnt: number = -1;
  private prevMoveLocTime: number | null = null;
  private moveBuffer: BufferedMove[] = [];
  private decoder: GanDecoder | null = null;
  private macAddress: string | null = null;
  private notificationQueue: Promise<void> = Promise.resolve();
  private readonly packetRecorder = new BlePacketRecorder();

  // 回调
  private onMoveCb: CubeCallback | null = null;
  private onBatteryCb: BatteryCallback | null = null;
  private onConnectCb: ConnectCallback | null = null;
  private onDisconnectCb: DisconnectCallback | null = null;
  private onGyroCb: GyroCallback | null = null;

  /** 开始仅存于内存的原始通知包录制，供真机问题排查。 */
  startPacketRecording(): void {
    this.packetRecorder.start();
  }

  stopPacketRecording(): void {
    this.packetRecorder.stop();
  }

  exportPacketRecording(): string {
    return this.packetRecorder.exportFixture();
  }

  /**
   * 从 BLE advertisement 的 manufacturerData 提取 MAC 地址
   *
   * GAN 魔方在 advertisement 中通过 CIC（Company Identifier Code）
   * 发送 MAC 地址，manufacturerData 前 6 字节反向即为 MAC。
   *
   * @returns MAC 地址（AA:BB:CC:DD:EE:FF 格式）或 null
   */
  async extractMac(): Promise<string | null> {
    const watchAdvertisements = this.device?.watchAdvertisements?.bind(this.device);
    if (!this.device || !watchAdvertisements) {
      return null;
    }

    return new Promise((resolve) => {
      const abortController = new AbortController();
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const finish = (mac: string | null): void => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        this.device?.removeEventListener("advertisementreceived", handler);
        abortController.abort();
        resolve(mac);
      };
      const handler = (event: Event) => {
        const adv = event as unknown as { manufacturerData?: Map<number, DataView> };
        const value = adv.manufacturerData ? findGanManufacturerData(adv.manufacturerData) : null;
        if (!value) return;
        const end = Math.min(value.byteLength, 9);
        const bytes: number[] = [];
        for (let index = 0; index < 6; index++) bytes.push(value.getUint8(end - index - 1));
        finish(bytes.map((byte) => (byte + 0x100).toString(16).slice(1)).join(":"));
      };
      this.device!.addEventListener("advertisementreceived", handler);
      timeout = setTimeout(() => finish(null), 5000);
      watchAdvertisements({ signal: abortController.signal }).catch((error: unknown) => {
        if (!settled) console.warn("[gan-cube] 广播扫描失败:", error);
        finish(null);
      });
    });
  }

  /**
   * 设置 v2 协议的 MAC 地址（用于派生 AES 密钥）
   * 调用 connect() 成功后，如果魔方是加密模式，调用此方法启用解密
   */
  async setMacAddress(mac: string): Promise<void> {
    try {
      const normalizedMac = normalizeMac(mac);
      this.decoder = await createDecoder(normalizedMac);
      this.macAddress = normalizedMac;
      console.log(`[gan-cube] AES 解码器已初始化 (MAC=${normalizedMac})`);
    } catch (err) {
      console.error("[gan-cube] AES 解码器创建失败", err);
      this.decoder = null;
      this.macAddress = null;
      throw err;
    }
  }

  async updateMacAddress(mac: string): Promise<void> {
    await this.setMacAddress(mac);
    this.prevMoveCnt = -1;
    this.prevMoveLocTime = null;
    this.moveBuffer = [];
    if (this.v2WriteChar) {
      await this.sendV2Request(5);
      await this.sendV2Request(4);
      await this.sendV2Request(9);
    }
    if (this.v4WriteChar) {
      await this.sendV4HardwareInfoRequest();
      await this.sendV4FaceletsRequest();
      await this.sendV4BatteryRequest();
    }
  }

  getMacAddress(): string | null {
    return this.macAddress;
  }
  /** 获取当前是否已启用 AES 解密 */
  isEncrypted(): boolean {
    return this.decoder !== null;
  }

  /**
   * 连接 GAN 智能魔方
   * 调用浏览器蓝牙选择器（必须用户手势触发）
   */
  async connect(preferredMac?: string): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error("当前浏览器不支持 Web Bluetooth API，请使用 Chrome/Edge");
    }

    console.log("[gan-cube] 开始扫描...");

    try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: "GAN" },
        { namePrefix: "AiCube" },
        { namePrefix: "MG" },
      ],
      optionalServices: ALL_GAN_SERVICES,
      optionalManufacturerData: createGanCicList(),
    });

    this.device = device;
    this.deviceName = device.name || "Unknown GAN Cube";
    console.log(`[gan-cube] 选中设备: ${this.deviceName}`);

    device.addEventListener("gattserverdisconnected", () => this.handleDisconnect());

    // 自动提取 MAC 地址（从 advertisement 的 manufacturerData）。GAN v2/v3/v4 加密都依赖它。
    if (preferredMac?.trim()) {
      await this.setMacAddress(preferredMac);
      console.log(`[gan-cube] using input MAC: ${this.macAddress}`);
    } else if (this.macAddress) {
      console.log(`[gan-cube] 使用手动 MAC: ${this.macAddress}`);
    } else {
      const mac = await this.extractMac();
      if (mac) {
        console.log(`[gan-cube] 自动提取 MAC: ${mac}`);
        await this.setMacAddress(mac);
      } else {
        console.warn("[gan-cube] 自动提取 MAC 失败，将尝试明文通信；若无 move 数据，请补充 MAC 地址");
      }
    }

    // 连接 GATT
    if (!device.gatt) throw new Error("GATT 不可用");
    this.server = await device.gatt.connect();
    console.log("[gan-cube] GATT 已连接");

    // 获取所有 service
    const services = await this.server.getPrimaryServices();
    const serviceUuids = services.map((s) => s.uuid.toUpperCase());

    console.log("[gan-cube] 可用 services:", serviceUuids);

    // 按优先级尝试：v2 > v3 > v4 > v1
    if (serviceUuids.includes(SERVICE_UUID_V2DATA.toUpperCase())) {
      await this.initV2(services);
    } else if (serviceUuids.includes(SERVICE_UUID_V3DATA.toUpperCase())) {
      await this.initV3(services);
    } else if (serviceUuids.includes(SERVICE_UUID_V4DATA.toUpperCase())) {
      await this.initV4(services);
    } else if (serviceUuids.includes(SERVICE_UUID_DATA.toUpperCase())) {
      throw new Error("v1 协议暂未实现（仅 v2/v3/v4）");
    } else {
      throw new Error("未识别的 GAN 魔方协议");
    }

    this.onConnectCb?.();
    } catch (error) {
      console.error("[gan-cube] connection failed:", error);
      await this.disconnect();
      throw new Error(`[gan-cube] connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 初始化 v2 协议（GAN 356 i 系列，最常见）
   * 复刻自 cstimer gancube.js v2init()
   */
  private async initV2(services: BluetoothRemoteGATTService[]): Promise<void> {
    const v2Service = services.find((s) => s.uuid.toUpperCase() === SERVICE_UUID_V2DATA.toUpperCase());
    if (!v2Service) throw new Error("找不到 v2 service");

    const chars = await v2Service.getCharacteristics();
    this.v2ReadChar = chars.find((c) => c.uuid.toUpperCase() === CHRCT_UUID_V2READ.toUpperCase()) || null;
    this.v2WriteChar = chars.find((c) => c.uuid.toUpperCase() === CHRCT_UUID_V2WRITE.toUpperCase()) || null;

    if (!this.v2ReadChar) {
      throw new Error("找不到 v2 read characteristic");
    }

    // 启动通知监听
    await this.v2ReadChar.startNotifications();
    this.v2ReadChar.addEventListener("characteristicvaluechanged", (e) => {
      const value = (e.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;
      const bytes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
      this.notificationQueue = this.notificationQueue
        .then(() => this.handleV2Event(new DataView(bytes.buffer)))
        .catch((err: unknown) => console.error("[gan-cube] v2 通知处理异常:", err));
    });

    // 请求硬件信息、面状态、电量
    await this.sendV2Request(5);  // hardware info
    await this.sendV2Request(4);  // facelets
    await this.sendV2Request(9);  // battery

    console.log("[gan-cube] v2 协议初始化完成");
  }

  private async initV3(_services: BluetoothRemoteGATTService[]): Promise<void> {
    throw new Error("v3 协议尚未实现");
  }

  private async initV4(services: BluetoothRemoteGATTService[]): Promise<void> {
    const v4Service = services.find((s) => s.uuid.toUpperCase() === SERVICE_UUID_V4DATA.toUpperCase());
    if (!v4Service) throw new Error("找不到 v4 service");

    const chars = await v4Service.getCharacteristics();
    this.v4ReadChar = chars.find((c) => c.uuid.toUpperCase() === CHRCT_UUID_V4READ.toUpperCase()) || null;
    this.v4WriteChar = chars.find((c) => c.uuid.toUpperCase() === CHRCT_UUID_V4WRITE.toUpperCase()) || null;

    if (!this.v4ReadChar) throw new Error("找不到 v4 read characteristic");

    await this.v4ReadChar.startNotifications();
    this.v4ReadChar.addEventListener("characteristicvaluechanged", (e) => {
      const value = (e.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;
      const bytes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
      this.notificationQueue = this.notificationQueue
        .then(() => this.handleV4Event(new DataView(bytes.buffer)))
        .catch((err: unknown) => console.error("[gan-cube] v4 通知处理异常:", err));
    });

    await this.sendV4HardwareInfoRequest();
    await this.sendV4FaceletsRequest();
    await this.sendV4BatteryRequest();

    console.log("[gan-cube] v4 协议初始化完成");
  }

  /**
   * 发送 v2 协议请求
   * opcode 4=facelets, 5=hardware, 9=battery
   */
  private async sendV2Request(opcode: number): Promise<void> {
    if (!this.v2WriteChar) return;
    const req = new Array(20).fill(0);
    req[0] = opcode;
    const encodedReq = this.decoder ? await encodeGanValue(this.decoder, req) : req;
    await this.v2WriteChar.writeValue(new Uint8Array(encodedReq).buffer);
    console.log(`[gan-cube] v2 sent opcode=${opcode}`);
  }

  private async sendV4Request(req: number[]): Promise<void> {
    if (!this.v4WriteChar) return;
    const encodedReq = this.decoder ? await encodeGanValue(this.decoder, req) : req;
    await this.v4WriteChar.writeValue(new Uint8Array(encodedReq).buffer);
  }

  private async sendV4FaceletsRequest(): Promise<void> {
    const req = new Array(20).fill(0);
    req[0] = 0xdd;
    req[1] = 0x04;
    req[3] = 0xed;
    await this.sendV4Request(req);
  }

  private async sendV4BatteryRequest(): Promise<void> {
    const req = new Array(20).fill(0);
    req[0] = 0xdd;
    req[1] = 0x04;
    req[3] = 0xef;
    await this.sendV4Request(req);
  }

  private async sendV4HardwareInfoRequest(): Promise<void> {
    const req = new Array(20).fill(0);
    req[0] = 0xdf;
    req[1] = 0x03;
    await this.sendV4Request(req);
  }

  private async requestV4MoveHistory(startMoveCnt: number, numberOfMoves: number): Promise<void> {
    if (!this.v4WriteChar) return;
    let start = startMoveCnt;
    let count = numberOfMoves;
    if (start % 2 === 0) start = (start - 1) & 0xff;
    if (count % 2 === 1) count++;
    count = Math.min(count, start + 1);
    const req = new Array(20).fill(0);
    req[0] = 0xd1;
    req[1] = 0x04;
    req[2] = start;
    req[4] = count;
    console.warn(`[gan-cube] v4 请求历史 move start=${start} count=${count}`);
    await this.sendV4Request(req).catch((err: unknown) => {
      console.warn("[gan-cube] v4 历史 move 请求失败，将在后续事件重试", err);
    });
  }

  private injectLostMoveToBuffer(move: BufferedMove): void {
    if (this.moveBuffer.some((item) => item.moveCnt === move.moveCnt)) return;
    if (this.moveBuffer.length > 0) {
      if (!isMoveNumberInRange(this.prevMoveCnt, this.moveBuffer[0].moveCnt, move.moveCnt)) return;
      if (move.moveCnt === ((this.moveBuffer[0].moveCnt - 1) & 0xff)) this.moveBuffer.unshift(move);
      return;
    }
    if (isMoveNumberInRange(this.prevMoveCnt, move.moveCnt, move.moveCnt, false, true)) {
      this.moveBuffer.unshift(move);
    }
  }

  private async evictMoveBuffer(requestLostMoves: boolean): Promise<void> {
    while (this.moveBuffer.length > 0) {
      const head = this.moveBuffer[0];
      const diff = (head.moveCnt - this.prevMoveCnt) & 0xff;
      if (diff > 1) {
        console.warn(`[gan-cube] v4 检测到丢步 prev=${this.prevMoveCnt} next=${head.moveCnt} diff=${diff}`);
        if (requestLostMoves) await this.requestV4MoveHistory(head.moveCnt, diff);
        break;
      }
      const move = this.moveBuffer.shift();
      if (!move) break;
      this.prevMoveCnt = move.moveCnt;
      this.onMoveCb?.({
        move: move.move,
        timestamp: move.timestamp ?? 0,
        locTime: move.locTime ?? Date.now(),
        moveCnt: move.moveCnt,
      });
    }
    if (this.moveBuffer.length > 16) {
      console.warn("[gan-cube] v4 move 缓冲过长，清空缓冲以避免错误连锁", this.moveBuffer);
      this.moveBuffer = [];
      this.prevMoveCnt = -1;
      this.prevMoveLocTime = null;
    }
  }

  /**
   * 处理 v2 协议事件
   * 复刻自 cstimer gancube.js parseV2Data()
   */
  private async handleV2Event(value: DataView): Promise<void> {
    const locTime = Date.now();
    const rawBytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    this.packetRecorder.record(BlePacketProtocol.GanV2, rawBytes, locTime);

    // 如果有解码器，先 AES 解密
    let bytes: number[];
    if (this.decoder) {
      try {
        const decrypted = await decodeGanValue(this.decoder, rawBytes);
        bytes = Array.from(decrypted);
      } catch (err) {
        console.error("[gan-cube] AES 解密失败，回退到明文:", err);
        bytes = [];
        for (let i = 0; i < value.byteLength; i++) bytes.push(value.getUint8(i));
      }
    } else {
      // 未配置解密器（明文模式）
      bytes = [];
      for (let i = 0; i < value.byteLength; i++) bytes.push(value.getUint8(i));
    }

    // 转换为 8 位二进制字符串
    const binaryStr = bytes.map((b) => b.toString(2).padStart(8, "0")).join("");

    // 前 4 位是 mode
    const mode = parseInt(binaryStr.slice(0, 4), 2);
    console.log(`[gan-cube] v2 event mode=${mode} bytes=${value.byteLength}`);

    if (mode === 2) {
      // ===== 魔方转动事件 =====
      const packet = parseGanV2MovePacket(bytes, this.prevMoveCnt);
      if (!packet) return;
      if (packet.moves.length === 0 && this.prevMoveCnt !== -1 && packet.moveCnt !== this.prevMoveCnt) {
        console.warn(`[gan-cube] v2 历史窗口含无效数据，无法恢复 moveCnt=${packet.moveCnt}`);
      }
      this.prevMoveCnt = packet.moveCnt;
      for (const item of packet.moves) {
        this.onMoveCb?.({ ...item, locTime });
      }
    } else if (mode === 4) {
      console.log("[gan-cube] v2 facelets event（魔方面状态）");
    } else if (mode === 5) {
      console.log("[gan-cube] v2 hardware info event");
      const hardwareVersion = parseInt(binaryStr.slice(8, 16), 2) + "." + parseInt(binaryStr.slice(16, 24), 2);
      const softwareVersion = parseInt(binaryStr.slice(24, 32), 2) + "." + parseInt(binaryStr.slice(32, 40), 2);
      console.log(`[gan-cube] HW=${hardwareVersion} SW=${softwareVersion}`);
    } else if (mode === 9) {
      const level = parseInt(binaryStr.slice(8, 16), 2);
      if (!Number.isFinite(level)) return;
      console.log(`[gan-cube] 电量 ${level}%`);
      this.onBatteryCb?.(level);
    } else if (mode === 1) {
      const gyro = parseGanV2GyroPacket(bytes);
      if (!gyro) return;
      this.onGyroCb?.({ ...gyro, locTime });
    } else {
      console.warn(`[gan-cube] v2 unknown event mode=${mode}`);
    }
  }

  private async handleV4Event(value: DataView): Promise<void> {
    const locTime = Date.now();
    const rawBytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    this.packetRecorder.record(BlePacketProtocol.GanV4, rawBytes, locTime);
    const bytes = await this.decodeValue(value);
    const binaryStr = bytes.map((b) => b.toString(2).padStart(8, "0")).join("");
    const mode = parseInt(binaryStr.slice(0, 8), 2);
    const len = parseInt(binaryStr.slice(8, 16), 2);

    if (mode === 0x01) {
      this.prevMoveLocTime = locTime;
      const moveCnt = parseInt(binaryStr.slice(56, 64) + binaryStr.slice(48, 56), 2);
      if (moveCnt === this.prevMoveCnt) return;

      const timestamp = parseInt(
        binaryStr.slice(40, 48) +
        binaryStr.slice(32, 40) +
        binaryStr.slice(24, 32) +
        binaryStr.slice(16, 24),
        2
      );
      const pow = parseInt(binaryStr.slice(64, 66), 2);
      const axisMask = parseInt(binaryStr.slice(66, 72), 2);
      const axis = GAN_V4_AXIS_MASKS.indexOf(axisMask);
      if (axis === -1) {
        console.warn(`[gan-cube] v4 invalid axis mask=${axisMask}`);
        return;
      }

      const move = "URFDLB".charAt(axis) + this.powerToSuffix(pow);
      this.moveBuffer.push({ moveCnt, move, timestamp, locTime });
      console.log(`[gan-cube] v4 move buffered ${move} #${moveCnt}`);
      await this.evictMoveBuffer(true);
    } else if (mode === 0xed) {
      const moveCnt = parseInt(binaryStr.slice(24, 32) + binaryStr.slice(16, 24), 2);
      if (this.prevMoveCnt !== -1) {
        const diff = (moveCnt - this.prevMoveCnt) & 0xff;
        if (diff > 0 && moveCnt !== 0 && this.prevMoveLocTime !== null && locTime - this.prevMoveLocTime > 500) {
          const startMoveCnt = this.moveBuffer[0]?.moveCnt ?? ((moveCnt + 1) & 0xff);
          await this.requestV4MoveHistory(startMoveCnt, diff + 1);
        }
        return;
      }
      this.prevMoveCnt = moveCnt;
      console.log(`[gan-cube] v4 facelets event #${moveCnt}`);
    } else if (mode === 0xd1) {
      const packet = parseGanV4MoveHistoryPacket(bytes);
      if (!packet) return;
      console.log(`[gan-cube] v4 历史 move 响应 start=${packet.startMoveCnt} count=${packet.moves.length}`);
      for (const item of packet.moves) {
        this.injectLostMoveToBuffer({
          moveCnt: item.moveCnt,
          move: item.move,
          timestamp: null,
          locTime: null,
        });
      }
      await this.evictMoveBuffer(false);
    } else if (mode === 0xef) {
      const level = parseInt(binaryStr.slice(8 + len * 8, 16 + len * 8), 2);
      if (!Number.isFinite(level)) {
        console.warn("[gan-cube] v4 battery event length invalid", { len, byteLength: bytes.length });
        return;
      }
      console.log(`[gan-cube] v4 电量 ${level}%`);
      this.onBatteryCb?.(level);
    } else if ([0xf5, 0xf6, 0xfa, 0xfc, 0xfd, 0xfe, 0xff].includes(mode)) {
      console.log(`[gan-cube] v4 hardware info mode=0x${mode.toString(16)}`);
    } else if (mode !== 0xec) {
      console.warn(`[gan-cube] v4 unknown event mode=0x${mode.toString(16)}`);
    }
  }

  private async decodeValue(value: DataView): Promise<number[]> {
    const raw = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (!this.decoder) return Array.from(raw);
    try {
      const decrypted = await decodeGanValue(this.decoder, raw);
      return Array.from(decrypted);
    } catch (err) {
      console.error("[gan-cube] AES 解密失败，回退到明文:", err);
      return Array.from(raw);
    }
  }

  private powerToSuffix(power: number): string {
    if (power === 1) return "'";
    if (power === 2) return "2";
    return "";
  }

  private handleDisconnect(): void {
    console.log("[gan-cube] 设备已断开");
    this.device = null;
    this.server = null;
    this.v2ReadChar = null;
    this.v2WriteChar = null;
    this.v4ReadChar = null;
    this.v4WriteChar = null;
    this.prevMoveCnt = -1;
    this.onDisconnectCb?.();
  }

  /** 断开连接 */
  async disconnect(): Promise<void> {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.handleDisconnect();
  }

  /** 获取设备名称 */
  getName(): string | null {
    return this.deviceName;
  }

  // ====== 回调注册 ======

  onMove(cb: CubeCallback): void { this.onMoveCb = cb; }
  onBattery(cb: BatteryCallback): void { this.onBatteryCb = cb; }
  onGyro(cb: GyroCallback): void { this.onGyroCb = cb; }
  onConnect(cb: ConnectCallback): void { this.onConnectCb = cb; }
  onDisconnect(cb: DisconnectCallback): void { this.onDisconnectCb = cb; }
}

/** 单例导出 */
export const ganCube = new GanCube();
