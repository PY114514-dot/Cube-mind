/**
 * ble/moyu-cube-protocol.ts
 * 魔域智能魔方 BLE 协议外观层（基于 cstimer/src/js/hardware/moyucube.js）
 *
 * 协议特征：
 *   - MHC：明文传输；Service 00001000-...；turn 特征 00001003-...
 *   - WCU_MY32：AES 加密（密钥与 MAC 混合）；read/write 特征 0783b03e-...
 *
 * 文件结构（P1 技术债拆分后）：
 *   - moyu-parsers.ts     纯解析层（turn/state/gyro/facelets + UUID 常量）
 *   - moyu32-crypto.ts    WCU_MY32 的 AES decoder 构造
 *   - moyu-mhc-handler.ts MHC 连接订阅与事件处理
 *   - moyu32-handler.ts   WCU32 连接订阅、解密分发与请求发送
 *   - 本文件              MoyuCube 类：连接生命周期 + 共享 ctx + 对外 API
 *
 * 本文件通过 re-export 保持既有 import 路径不变（main.ts、各测试文件）。
 */

import type {
  CubeBatteryCallback as BatteryCallback,
  CubeConnectCallback as ConnectCallback,
  CubeDisconnectCallback as DisconnectCallback,
  CubeDriver,
  CubeErrorCallback,
  CubeGyroCallback,
  CubeMoveCallback as CubeCallback,
  CubeMoveStreamGapCallback,
} from "./cube-driver.ts";
import { BlePacketRecorder } from "./ble-packet-harness.ts";
import { normalizeMac } from "./gan-crypto.ts";
import { createMoyu32Decoder } from "./moyu32-crypto.ts";
import { MhcHandler, type MhcHandlerContext } from "./moyu-mhc-handler.ts";
import { extractMoyu32Mac, Moyu32Handler, type Moyu32HandlerContext } from "./moyu32-handler.ts";
import { Moyu32MoveStream } from "./moyu32-move-stream.ts";
import {
  MOYU_SERVICE_UUID,
  MOYU32_CIC_LIST,
  MOYU32_SERVICE_UUID,
  type MoyuGyroRawCallback,
} from "./moyu-parsers.ts";
import { debugLog } from "../utils/debug.ts";

/** 创建一个新的魔域魔方实例 */
export class MoyuCube implements CubeDriver {
  readonly brand = "魔域";
  readonly needsMac = true;
  readonly macStorageKey = "cubemind:moyu-mac";

  private device: BluetoothDevice | null = null;
  private deviceName: string | null = null;
  private macAddress: string | null = null;
  private isMoyu32 = false;
  private boundOnGattDisconnect: (() => void) | null = null;
  private onConnectCb: ConnectCallback | null = null;
  private onDisconnectCb: DisconnectCallback | null = null;

  // MHC 与 WCU32 handler 共用的可变状态；两个 handler 各自声明所需子集，
  // 外观层以超集对象同时满足两者，避免 handler 反向依赖外观层。
  private readonly ctx: Moyu32HandlerContext & MhcHandlerContext = {
    decoder: null,
    notificationQueue: Promise.resolve(),
    packetRecorder: new BlePacketRecorder(),
    pendingFaceletRequest: null,
    prevMoveCnt: -1,
    deviceTimestamp: 0,
    moyu32MoveStream: new Moyu32MoveStream(),
    faceStatus: [0, 0, 0, 0, 0, 0],
    onMove: null,
    onMoveStreamGap: null,
    onError: null,
    onBattery: null,
    onGyro: null,
    onGyroRaw: null,
  };
  private readonly mhcHandler = new MhcHandler(this.ctx);
  private readonly moyu32Handler = new Moyu32Handler(this.ctx);

  get supportsGyro(): boolean { return this.isMoyu32; }

  startPacketRecording(): void { this.ctx.packetRecorder.start(); }
  stopPacketRecording(): void { this.ctx.packetRecorder.stop(); }
  exportPacketRecording(): string { return this.ctx.packetRecorder.exportFixture(); }
  exportReplayFixture(): string { return this.ctx.packetRecorder.exportReplayFixture(); }

  async requestFacelets(): Promise<string | null> {
    if (!this.isMoyu32 || !this.moyu32Handler.hasWriteChar) return null;
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
      this.ctx.pendingFaceletRequest = settle;
      void this.moyu32Handler.sendMoyu32Request(163).catch((error: unknown) => {
        console.error("[moyu-cube] 无法请求 WCU 当前局面:", error);
        this.ctx.onError?.("无法读取 WCU 实体局面，已断开连接以避免使用不可靠数据。");
        settle(null);
        void this.disconnect().catch((disconnectError: unknown) => {
          console.error("[moyu-cube] 请求局面失败后的断开清理失败:", disconnectError);
        });
      });
    });
  }

  async connect(preferredMac?: string): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error("当前浏览器不支持 Web Bluetooth API");
    }

    debugLog("[moyu-cube] 开始扫描...");

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
    debugLog(`[moyu-cube] 选中设备: ${this.deviceName}`);

    this.boundOnGattDisconnect = () => this.handleDisconnect();
    device.addEventListener("gattserverdisconnected", this.boundOnGattDisconnect);

    if (this.deviceName && this.deviceName.startsWith("WCU_MY3")) {
      this.isMoyu32 = true;
      await this.connectMoyu32(preferredMac);
    } else {
      this.isMoyu32 = false;
      await this.mhcHandler.init(device);
    }

    debugLog("[moyu-cube] 连接成功");
    this.onConnectCb?.();
    } catch (error) {
      console.error("[moyu-cube] connection failed:", error);
      await this.disconnect();
      throw new Error(`[moyu-cube] connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async connectMoyu32(preferredMac?: string): Promise<void> {
    const mac = await extractMoyu32Mac(this.device);
    const fallbackMac = this.getMoyu32FallbackMac();
    const activeMac = preferredMac?.trim() || this.macAddress || mac || fallbackMac;
    if (!activeMac) {
      throw new Error("无法获取魔域 WCU MAC 地址，请先在 WCU Cube App 绑定魔方后再试");
    }
    await this.setMacAddress(activeMac);
    debugLog(`[moyu-cube] WCU decoder ready (MAC=${activeMac})`);

    if (!this.device?.gatt) throw new Error("GATT 不可用");
    await this.moyu32Handler.init(this.device);
  }

  private getMoyu32FallbackMac(): string | null {
    if (!this.deviceName || !/^WCU_MY32_[0-9A-F]{4}$/.test(this.deviceName)) return null;
    return `CF:30:16:00:${this.deviceName.slice(9, 11)}:${this.deviceName.slice(11, 13)}`;
  }

  private handleDisconnect(): void {
    debugLog("[moyu-cube] 设备已断开");

    // 移除事件监听器，防止重连时泄漏
    if (this.device && this.boundOnGattDisconnect) {
      this.device.removeEventListener("gattserverdisconnected", this.boundOnGattDisconnect);
    }
    this.mhcHandler.dispose();
    this.moyu32Handler.dispose();

    this.boundOnGattDisconnect = null;
    this.device = null;
    this.ctx.decoder = null;
    this.ctx.faceStatus = [0, 0, 0, 0, 0, 0];
    this.ctx.prevMoveCnt = -1;
    this.ctx.moyu32MoveStream.reset();
    this.ctx.deviceTimestamp = 0;
    this.ctx.notificationQueue = Promise.resolve();
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
    this.ctx.decoder = createMoyu32Decoder(normalized);
    this.macAddress = normalized;
  }

  /** 暴露给测试用：重置内部 faceStatus */
  resetFaceStatus(): void {
    this.ctx.faceStatus = [0, 0, 0, 0, 0, 0];
  }

  onMove(cb: CubeCallback): void { this.ctx.onMove = cb; }
  onMoveStreamGap(cb: CubeMoveStreamGapCallback): void { this.ctx.onMoveStreamGap = cb; }
  onError(cb: CubeErrorCallback): void { this.ctx.onError = cb; }
  onBattery(cb: BatteryCallback): void { this.ctx.onBattery = cb; }
  onGyro(cb: CubeGyroCallback): void { this.ctx.onGyro = cb; }
  onGyroRaw(cb: MoyuGyroRawCallback): void { this.ctx.onGyroRaw = cb; }
  onConnect(cb: ConnectCallback): void { this.onConnectCb = cb; }
  onDisconnect(cb: DisconnectCallback): void { this.onDisconnectCb = cb; }

  /** 重连到之前已授权的设备（不弹选择器），失败时 reject */
  async reconnect(): Promise<void> {
    if (!this.device?.gatt) throw new Error("无已授权设备，无法重连");
    this.boundOnGattDisconnect = () => this.handleDisconnect();
    this.device.addEventListener("gattserverdisconnected", this.boundOnGattDisconnect);
    // 重连与首连共用 handler 的订阅序列；MHC 路径因此补齐了 gyro 重订阅
    //（原实现只重订阅 turn，重连后陀螺仪会静默失效）。
    if (this.deviceName?.startsWith("WCU_MY3")) {
      this.isMoyu32 = true;
      await this.moyu32Handler.init(this.device);
    } else {
      this.isMoyu32 = false;
      await this.mhcHandler.init(this.device);
    }
    this.onConnectCb?.();
  }
}

// 既有 import 路径不变：main.ts 用 moyuCube，测试用各纯函数与常量
export {
  parseTurn,
  parseMoyu32Data,
  parseMoyu32Gyro,
  parseMoyu32Facelets,
  MOYU_SERVICE_UUID,
  MOYU_CHRCT_UUID_READ,
  MOYU_CHRCT_UUID_TURN,
  MOYU_CHRCT_UUID_GYRO,
  MOYU32_SERVICE_UUID,
  MOYU32_CHRCT_UUID_READ,
  MOYU32_CHRCT_UUID_WRITE,
} from "./moyu-parsers.ts";

export const moyuCube = new MoyuCube();
