/**
 * ble/gan-v2-handler.ts
 * GAN v2/v3 通知流处理（P1 拆分自 gan-cube-protocol.ts）：
 * 持有 v2 特征与动作计数基线，通过共享上下文访问外观层的解码器、录制器与回调。
 * 解析函数与包类型见 gan-v2-protocol.ts。
 */

import { decodeGanValue, encodeGanValue, type GanDecoder } from "./gan-crypto.ts";
import { BlePacketProtocol, type BlePacketRecorder } from "./ble-packet-harness.ts";
import type { CubeBatteryCallback, CubeGyroCallback, CubeMoveCallback, CubePacketCallback } from "./cube-driver.ts";
import {
  CHRCT_UUID_V2READ,
  CHRCT_UUID_V2WRITE,
  SERVICE_UUID_V2DATA,
  parseGanV2CubeStatePacket,
  parseGanV2GyroPacket,
  parseGanV2MovePacket,
} from "./gan-v2-protocol.ts";
import { debugLog } from "../utils/debug.ts";

/**
 * v2 处理器所需的外观层共享状态子集。
 * 外观层创建的对象是 v4 超集（gan-v4-handler.ts 的 GanV4HandlerContext），结构兼容此处。
 */
export interface GanV2HandlerContext {
  decoder: GanDecoder | null;
  notificationQueue: Promise<void>;
  packetRecorder: BlePacketRecorder;
  latestFacelets: string | null;
  pendingFaceletRequest: ((facelets: string | null) => void) | null;
  /** 解密成功时由外观层重置失败计数 */
  onDecryptSuccess: () => void;
  /** 解密失败时由外观层累计并决定是否断开 */
  onDecryptFailure: (err: unknown) => void;
  onMove: CubeMoveCallback | null;
  onBattery: CubeBatteryCallback | null;
  onGyro: CubeGyroCallback | null;
  onPacket: CubePacketCallback | null;
}

export class GanV2Handler {
  private v2ReadChar: BluetoothRemoteGATTCharacteristic | null = null;
  private v2WriteChar: BluetoothRemoteGATTCharacteristic | null = null;
  /** 动作计数基线；连接/更新 MAC 后的首个状态包会覆盖 -1 初值 */
  private prevMoveCnt: number = -1;
  private boundOnV2ValueChanged: ((e: Event) => void) | null = null;

  constructor(private readonly ctx: GanV2HandlerContext) {}

  get writeChar(): BluetoothRemoteGATTCharacteristic | null {
    return this.v2WriteChar;
  }

  /**
   * 初始化 v2 协议（GAN 356 i 系列，最常见）
   * 复刻自 cstimer gancube.js v2init()
   */
  async initV2(services: BluetoothRemoteGATTService[]): Promise<void> {
    const v2Service = services.find((s) => s.uuid.toUpperCase() === SERVICE_UUID_V2DATA.toUpperCase());
    if (!v2Service) throw new Error("找不到 v2 service");

    const chars = await v2Service.getCharacteristics();
    this.v2ReadChar = chars.find((c) => c.uuid.toUpperCase() === CHRCT_UUID_V2READ.toUpperCase()) || null;
    this.v2WriteChar = chars.find((c) => c.uuid.toUpperCase() === CHRCT_UUID_V2WRITE.toUpperCase()) || null;

    if (!this.v2ReadChar) {
      throw new Error("找不到 v2 read characteristic");
    }

    // 启动通知监听；通知按顺序入队，避免并发解密交错
    await this.v2ReadChar.startNotifications();
    this.boundOnV2ValueChanged = (e: Event) => {
      const value = (e.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;
      const bytes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
      this.ctx.notificationQueue = this.ctx.notificationQueue
        .then(() => this.handleV2Event(new DataView(bytes.buffer)))
        .catch((err: unknown) => console.error("[gan-cube] v2 通知处理异常:", err));
    };
    this.v2ReadChar.addEventListener("characteristicvaluechanged", this.boundOnV2ValueChanged);

    // 请求硬件信息、面状态、电量
    await this.sendV2Request(5);  // hardware info
    await this.sendV2Request(4);  // facelets
    await this.sendV2Request(9);  // battery

    debugLog("[gan-cube] v2 协议初始化完成");
  }

  /**
   * 发送 v2 协议请求
   * opcode 4=facelets, 5=hardware, 9=battery
   */
  async sendV2Request(opcode: number): Promise<void> {
    if (!this.v2WriteChar) return;
    const req = new Array(20).fill(0);
    req[0] = opcode;
    const encodedReq = this.ctx.decoder ? await encodeGanValue(this.ctx.decoder, req) : req;
    await this.v2WriteChar.writeValue(new Uint8Array(encodedReq).buffer);
    debugLog(`[gan-cube] v2 sent opcode=${opcode}`);
  }

  /** 更新 MAC / 断开后重置动作计数基线，避免旧会话计数与新通知混淆。 */
  reset(): void {
    this.prevMoveCnt = -1;
  }

  /** 移除通知监听并停止通知；断连清理时调用，防止重连时泄漏。 */
  dispose(): void {
    if (this.v2ReadChar && this.boundOnV2ValueChanged) {
      this.v2ReadChar.removeEventListener("characteristicvaluechanged", this.boundOnV2ValueChanged);
      this.v2ReadChar.stopNotifications().catch((error: unknown) => {
        console.error("[gan-cube] v2 stopNotifications 失败:", error);
      });
    }
    this.boundOnV2ValueChanged = null;
    this.v2ReadChar = null;
    this.v2WriteChar = null;
    this.reset();
  }

  /**
   * 处理 v2 协议事件
   * 复刻自 cstimer gancube.js parseV2Data()
   */
  private async handleV2Event(value: DataView): Promise<void> {
    const locTime = Date.now();
    const rawBytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    this.ctx.packetRecorder.record(BlePacketProtocol.GanV2, rawBytes, locTime);

    // 如果有解码器，先 AES 解密
    let bytes: number[];
    if (this.ctx.decoder) {
      try {
        const decrypted = await decodeGanValue(this.ctx.decoder, rawBytes);
        bytes = Array.from(decrypted);
        this.ctx.onDecryptSuccess();
      } catch (err) {
        this.ctx.onPacket?.({
          protocol: "gan-v2",
          receivedAt: locTime,
          mode: null,
          rawBytes: Array.from(rawBytes),
        });
        this.ctx.onDecryptFailure(err);
        return;
      }
    } else {
      // 未配置解码器（明文模式）
      bytes = [];
      for (let i = 0; i < value.byteLength; i++) bytes.push(value.getUint8(i));
    }

    // 转换为 8 位二进制字符串
    const binaryStr = bytes.map((b) => b.toString(2).padStart(8, "0")).join("");

    // 前 4 位是 mode
    const mode = parseInt(binaryStr.slice(0, 4), 2);
    this.ctx.packetRecorder.annotateLast(bytes, mode);
    this.ctx.onPacket?.({
      protocol: "gan-v2",
      receivedAt: locTime,
      mode,
      rawBytes: Array.from(rawBytes),
      decodedBytes: [...bytes],
    });
    debugLog(`[gan-cube] v2 event mode=${mode} bytes=${value.byteLength}`);

    if (mode === 2) {
      // ===== 魔方转动事件 =====
      const packet = parseGanV2MovePacket(bytes, this.prevMoveCnt);
      if (!packet) return;
      if (packet.moves.length === 0 && this.prevMoveCnt !== -1 && packet.moveCnt !== this.prevMoveCnt) {
        console.warn(`[gan-cube] v2 历史窗口含无效数据，无法恢复 moveCnt=${packet.moveCnt}`);
      }
      this.prevMoveCnt = packet.moveCnt;
      for (const item of packet.moves) {
        this.ctx.onMove?.({ ...item, locTime });
      }
    } else if (mode === 4) {
      const state = parseGanV2CubeStatePacket(bytes);
      if (!state) {
        console.warn("[gan-cube] v2 局面包校验失败，不能建立动作计数基线");
        return;
      }
      // 连接/更新 MAC 后的首个状态包是动作流起点；不设基线会静默吞掉第一条实际转动。
      if (this.prevMoveCnt === -1) {
        this.prevMoveCnt = state.moveCnt;
      }
      this.ctx.latestFacelets = state.facelets;
      this.ctx.pendingFaceletRequest?.(state.facelets);
    } else if (mode === 5) {
      debugLog("[gan-cube] v2 hardware info event");
      const hardwareVersion = parseInt(binaryStr.slice(8, 16), 2) + "." + parseInt(binaryStr.slice(16, 24), 2);
      const softwareVersion = parseInt(binaryStr.slice(24, 32), 2) + "." + parseInt(binaryStr.slice(32, 40), 2);
      debugLog(`[gan-cube] HW=${hardwareVersion} SW=${softwareVersion}`);
    } else if (mode === 9) {
      const level = parseInt(binaryStr.slice(8, 16), 2);
      if (!Number.isFinite(level)) return;
      debugLog(`[gan-cube] 电量 ${level}%`);
      this.ctx.onBattery?.(level);
    } else if (mode === 1) {
      const gyro = parseGanV2GyroPacket(bytes);
      if (!gyro) return;
      this.ctx.onGyro?.(gyro.quaternion);
    } else {
      console.warn(`[gan-cube] v2 unknown event mode=${mode}`);
    }
  }
}
