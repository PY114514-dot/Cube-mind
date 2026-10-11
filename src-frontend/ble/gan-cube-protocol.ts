/**
 * ble/gan-cube-protocol.ts
 * GAN 智能魔方 BLE 协议外观层（基于 cstimer/src/js/hardware/gancube.js）
 *
 * 支持的协议版本：
 *   v1  老款 GAN（UUID 0xfff0 0xfff2 0xfff5 0xfff6 0xfff7）
 *   v2  GAN 356 i 系列（UUID 6e400001-b5a3... + AES 加密）
 *   v3  GAN 13/i3（UUID 8653000a-43e6...）
 *   v4  最新 GAN（UUID 00000010-0000-fff7...）
 *
 * ✅ MVP 完整实现 v2 加密（基于 gan-crypto.ts + Web Crypto API）
 * ⚠️ v3 协议尚未实现
 *
 * 职责（P1 拆分后）：
 *   本文件只保留 GanCube 驱动门面 + 对外 re-export，保证既有 import 路径不变；
 *   纯解析逻辑在 gan-v2-protocol.ts / gan-v4-protocol.ts，
 *   通知流处理在 gan-v2-handler.ts / gan-v4-handler.ts，
 *   四元数公共层在 gan-gyro-common.ts。
 */

import { createDecoder, normalizeMac } from "./gan-crypto.ts";
import { BlePacketRecorder } from "./ble-packet-harness.ts";
import { GanV2Handler } from "./gan-v2-handler.ts";
import { GanV4Handler, type GanV4HandlerContext } from "./gan-v4-handler.ts";
import { ALL_GAN_SERVICES, SERVICE_UUID_DATA, createGanCicList, extractGanMacFromAdvertisement } from "./gan-advertising.ts";
import { SERVICE_UUID_V2DATA, SERVICE_UUID_V3DATA } from "./gan-v2-protocol.ts";
import { SERVICE_UUID_V4DATA, supportsGanFaceletVerification, type GanV4GyroPacketCallback } from "./gan-v4-protocol.ts";
import { debugLog } from "../utils/debug.ts";

// ============== UUID 定义（与 cstimer 一致） ==============
import type { CubeDriver, CubeErrorCallback, CubeGyroCallback, CubeMoveStreamGapCallback, CubePacketCallback, CubeMove, CubeMoveCallback, CubeBatteryCallback, CubeConnectCallback, CubeDisconnectCallback } from "./cube-driver.ts";
export type { CubeMove, CubeMoveCallback as CubeCallback, CubeBatteryCallback as BatteryCallback, CubeConnectCallback as ConnectCallback, CubeDisconnectCallback as DisconnectCallback } from "./cube-driver.ts";

// ============== 对外 re-export（保证原有 import 路径不变） ==============
export { parseGanV4MovePacket, type GanV4LiveMove } from "./gan-v4-move-packet.ts";
export {
  parseGanV2MovePacket,
  parseGanV2CubeStatePacket,
  parseGanV2GyroPacket,
  type GanV2MovePacket,
  type GanV2CubeStatePacket,
} from "./gan-v2-protocol.ts";
export {
  supportsGanFaceletVerification,
  decodeGanV4CubeStatePacket,
  parseGanV4CubeStatePacket,
  parseGanV4MoveHistoryPacket,
  parseGanV4GyroPacket,
  type GanV4CubeStatePacket,
  type GanV4DecodedCubeStatePacket,
  type GanHistoryMove,
  type GanV4MoveHistoryPacket,
  type GanV4GyroPacket,
  type GanV4GyroPacketEvent,
  type GanV4GyroPacketCallback,
} from "./gan-v4-protocol.ts";
export type { CubeQuaternion, GanGyroEvent, GyroCallback } from "./gan-gyro-common.ts";
export { isGanCompanyIdentifier } from "./gan-advertising.ts";

// ============== 类型定义 ==============

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
type CubeCallback = CubeMoveCallback;
type BatteryCallback = CubeBatteryCallback;
type ConnectCallback = CubeConnectCallback;
type DisconnectCallback = CubeDisconnectCallback;

// ============== GAN Cube 类 ==============

export class GanCube implements CubeDriver {
  readonly brand = "GAN";
  readonly needsMac = true;
  readonly supportsGyro = true;
  readonly macStorageKey = "cubemind:gan-mac";

  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private deviceName: string | null = null;
  private macAddress: string | null = null;
  private decryptFailures = 0;
  private static readonly MAX_DECRYPT_FAILURES = 5;

  // 命名事件处理器引用（disconnect 时需 removeEventListener 防止泄漏）
  private boundOnGattDisconnect: (() => void) | null = null;

  /** 两个协议 handler 共用的可变状态；解码器是唯一真源，解密成败由外观层裁决。 */
  private readonly ctx: GanV4HandlerContext = {
    decoder: null,
    notificationQueue: Promise.resolve(),
    packetRecorder: new BlePacketRecorder(),
    latestFacelets: null,
    pendingFaceletRequest: null,
    onDecryptSuccess: () => { this.decryptFailures = 0; },
    onDecryptFailure: (err) => { this.handleDecryptFailure(err); },
    onMove: null,
    onBattery: null,
    onGyro: null,
    onMoveStreamGap: null,
    onPacket: null,
    onV4GyroPacket: null,
  };
  private readonly v2Handler = new GanV2Handler(this.ctx);
  private readonly v4Handler = new GanV4Handler(this.ctx);

  // 外观层专属回调
  private onConnectCb: ConnectCallback | null = null;
  private onDisconnectCb: DisconnectCallback | null = null;
  private onErrorCb: CubeErrorCallback | null = null;
  private onDecryptErrorCb: ((message: string) => void) | null = null;

  /** 开始仅存于内存的原始通知包录制，供真机问题排查。 */
  startPacketRecording(): void {
    this.ctx.packetRecorder.start();
  }

  stopPacketRecording(): void {
    this.ctx.packetRecorder.stop();
  }

  exportPacketRecording(): string {
    return this.ctx.packetRecorder.exportFixture();
  }

  exportReplayFixture(): string {
    return this.ctx.packetRecorder.exportReplayFixture();
  }

  /** 读取 GAN 当前局面；用于结束时以实体状态校验本地动作流。 */
  async requestFacelets(): Promise<string | null> {
    const v2WriteChar = this.v2Handler.writeChar;
    const v4WriteChar = this.v4Handler.writeChar;
    if (v4WriteChar && !v2WriteChar && !supportsGanFaceletVerification("v4")) {
      return null;
    }
    if (!v2WriteChar && !v4WriteChar) return null;
    return new Promise<string | null>((resolve) => {
      const timer = window.setTimeout(() => {
        if (this.ctx.pendingFaceletRequest !== settle) return;
        this.ctx.pendingFaceletRequest = null;
        resolve(null);
      }, 900);
      const settle = (facelets: string | null): void => {
        window.clearTimeout(timer);
        if (this.ctx.pendingFaceletRequest === settle) this.ctx.pendingFaceletRequest = null;
        resolve(facelets);
      };
      this.ctx.pendingFaceletRequest?.(null);
      this.ctx.pendingFaceletRequest = settle;
      const request = v2WriteChar ? this.v2Handler.sendV2Request(4) : this.v4Handler.sendV4FaceletsRequest();
      void request.catch((error: unknown) => {
        console.error("[gan-cube] 无法请求 GAN 局面:", error);
        this.onErrorCb?.("无法读取 GAN 实体局面，已断开连接以避免使用不可靠数据。");
        settle(null);
        void this.disconnect().catch((disconnectError: unknown) => {
          console.error("[gan-cube] 请求局面失败后的断开清理失败:", disconnectError);
        });
      });
    });
  }

  allowsUnverifiedMoveScore(): boolean {
    return this.v4Handler.writeChar !== null && this.v2Handler.writeChar === null;
  }

  /**
   * 从 BLE advertisement 的 manufacturerData 提取 MAC 地址
   * （实现见 gan-advertising.ts；GAN 魔方通过 CIC 广播 MAC，前 6 字节反向即为 MAC）
   *
   * @returns MAC 地址（AA:BB:CC:DD:EE:FF 格式）或 null
   */
  async extractMac(): Promise<string | null> {
    if (!this.device) return null;
    return extractGanMacFromAdvertisement(this.device);
  }

  /**
   * 设置 v2 协议的 MAC 地址（用于派生 AES 密钥）
   * 调用 connect() 成功后，如果魔方是加密模式，调用此方法启用解密
   */
  async setMacAddress(mac: string): Promise<void> {
    try {
      const normalizedMac = normalizeMac(mac);
      this.ctx.decoder = await createDecoder(normalizedMac);
      this.macAddress = normalizedMac;
      debugLog(`[gan-cube] AES 解码器已初始化 (MAC=${normalizedMac})`);
    } catch (err) {
      console.error("[gan-cube] AES 解码器创建失败", err);
      this.ctx.decoder = null;
      this.macAddress = null;
      throw err;
    }
  }

  async updateMacAddress(mac: string): Promise<void> {
    await this.setMacAddress(mac);
    this.v2Handler.reset();
    this.v4Handler.reset();
    if (this.v2Handler.writeChar) {
      await this.v2Handler.sendV2Request(5);
      await this.v2Handler.sendV2Request(4);
      await this.v2Handler.sendV2Request(9);
    }
    if (this.v4Handler.writeChar) {
      await this.v4Handler.sendV4HardwareInfoRequest();
      await this.v4Handler.sendV4FaceletsRequest();
      await this.v4Handler.sendV4BatteryRequest();
    }
  }

  getMacAddress(): string | null {
    return this.macAddress;
  }
  /** 获取当前是否已启用 AES 解密 */
  isEncrypted(): boolean {
    return this.ctx.decoder !== null;
  }

  /**
   * 连接 GAN 智能魔方
   * 调用浏览器蓝牙选择器（必须用户手势触发）
   */
  async connect(preferredMac?: string): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error("当前浏览器不支持 Web Bluetooth API，请使用 Chrome/Edge");
    }

    debugLog("[gan-cube] 开始扫描...");

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
    debugLog(`[gan-cube] 选中设备: ${this.deviceName}`);

    this.boundOnGattDisconnect = () => this.handleDisconnect();
    device.addEventListener("gattserverdisconnected", this.boundOnGattDisconnect);

    // 自动提取 MAC 地址（从 advertisement 的 manufacturerData）。GAN v2/v3/v4 加密都依赖它。
    if (preferredMac?.trim()) {
      await this.setMacAddress(preferredMac);
      debugLog(`[gan-cube] using input MAC: ${this.macAddress}`);
    } else if (this.macAddress) {
      debugLog(`[gan-cube] 使用手动 MAC: ${this.macAddress}`);
    } else {
      const mac = await this.extractMac();
      if (mac) {
        debugLog(`[gan-cube] 自动提取 MAC: ${mac}`);
        await this.setMacAddress(mac);
      } else {
        console.warn("[gan-cube] 自动提取 MAC 失败，将尝试明文通信；若无 move 数据，请补充 MAC 地址");
      }
    }

    // 连接 GATT
    if (!device.gatt) throw new Error("GATT 不可用");
    this.server = await device.gatt.connect();
    debugLog("[gan-cube] GATT 已连接");

    // 获取所有 service
    const services = await this.server.getPrimaryServices();
    const serviceUuids = services.map((s) => s.uuid.toUpperCase());

    debugLog("[gan-cube] 可用 services:", serviceUuids);

    // 按优先级尝试：v2 > v3 > v4 > v1
    if (serviceUuids.includes(SERVICE_UUID_V2DATA.toUpperCase())) {
      await this.v2Handler.initV2(services);
    } else if (serviceUuids.includes(SERVICE_UUID_V3DATA.toUpperCase())) {
      throw new Error("v3 协议尚未实现");
    } else if (serviceUuids.includes(SERVICE_UUID_V4DATA.toUpperCase())) {
      await this.v4Handler.initV4(services);
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

  /** 连续解密失败超过阈值时断开连接并通知 UI，避免垃圾 move 流 */
  private handleDecryptFailure(err: unknown): void {
    this.decryptFailures++;
    console.error(`[gan-cube] AES 解密失败 (${this.decryptFailures}/${GanCube.MAX_DECRYPT_FAILURES}):`, err);
    if (this.decryptFailures >= GanCube.MAX_DECRYPT_FAILURES) {
      this.onDecryptErrorCb?.("连续解密失败，MAC 地址可能错误，已自动断开。请重新配对。");
      void this.disconnect();
    }
  }

  private handleDisconnect(): void {
    debugLog("[gan-cube] 设备已断开");

    // 移除事件监听器，防止重连时泄漏
    if (this.device && this.boundOnGattDisconnect) {
      this.device.removeEventListener("gattserverdisconnected", this.boundOnGattDisconnect);
    }
    this.v2Handler.dispose();
    this.v4Handler.dispose();

    this.boundOnGattDisconnect = null;
    this.device = null;
    this.server = null;
    this.decryptFailures = 0;
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

  onMove(cb: CubeCallback): void { this.ctx.onMove = cb; }
  onMoveStreamGap(cb: CubeMoveStreamGapCallback): void { this.ctx.onMoveStreamGap = cb; }
  onError(cb: CubeErrorCallback): void { this.onErrorCb = cb; }
  onBattery(cb: BatteryCallback): void { this.ctx.onBattery = cb; }
  onGyro(cb: CubeGyroCallback): void { this.ctx.onGyro = cb; }
  onPacket(cb: CubePacketCallback): void { this.ctx.onPacket = cb; }
  onV4GyroPacket(cb: GanV4GyroPacketCallback): void { this.ctx.onV4GyroPacket = cb; }
  onConnect(cb: ConnectCallback): void { this.onConnectCb = cb; }
  onDisconnect(cb: DisconnectCallback): void { this.onDisconnectCb = cb; }
  onDecryptError(cb: (message: string) => void): void { this.onDecryptErrorCb = cb; }

  /** 重连到之前已授权的设备（不弹选择器），失败时 reject */
  async reconnect(): Promise<void> {
    if (!this.device?.gatt) throw new Error("无已授权设备，无法重连");
    this.boundOnGattDisconnect = () => this.handleDisconnect();
    this.device.addEventListener("gattserverdisconnected", this.boundOnGattDisconnect);
    this.server = await this.device.gatt.connect();
    const services = await this.server.getPrimaryServices();
    const serviceUuids = services.map((s) => s.uuid.toUpperCase());
    if (serviceUuids.includes(SERVICE_UUID_V2DATA.toUpperCase())) {
      await this.v2Handler.initV2(services);
    } else if (serviceUuids.some((u) => u.startsWith("00000010-0000-fff7"))) {
      await this.v4Handler.initV4(services);
    }
    this.onConnectCb?.();
  }
}

/** 单例导出 */
export const ganCube = new GanCube();
