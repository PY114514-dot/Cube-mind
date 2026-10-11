/**
 * ble/gan-v4-handler.ts
 * GAN v4 通知流处理（P1 拆分自 gan-cube-protocol.ts）：
 * 持有 v4 特征、实时动作流（GanV4MoveStream）与历史补偿状态，通过共享上下文
 * 访问外观层的解码器、录制器与回调。解析函数与包类型见 gan-v4-protocol.ts。
 */

import { decodeGanValue, encodeGanValue, type GanDecoder } from "./gan-crypto.ts";
import { BlePacketProtocol, type BlePacketRecorder } from "./ble-packet-harness.ts";
import type {
  CubeBatteryCallback,
  CubeGyroCallback,
  CubeMoveCallback,
  CubeMoveStreamGapCallback,
  CubePacketCallback,
} from "./cube-driver.ts";
import { parseGanV4MovePacket } from "./gan-v4-move-packet.ts";
import { GanV4MoveStream, type GanV4StreamResult } from "./gan-v4-move-stream.ts";
import {
  CHRCT_UUID_V4READ,
  CHRCT_UUID_V4WRITE,
  SERVICE_UUID_V4DATA,
  parseGanV4CubeStatePacket,
  parseGanV4GyroPacket,
  parseGanV4MoveHistoryPacket,
  type GanV4GyroPacketCallback,
} from "./gan-v4-protocol.ts";
import { debugLog } from "../utils/debug.ts";

/**
 * v4 处理器所需的外观层共享状态（v2 子集的超集）。
 * 外观层创建的对象即按此类型组装，并原样传给 v2 处理器（结构兼容）。
 */
export interface GanV4HandlerContext {
  decoder: GanDecoder | null;
  notificationQueue: Promise<void>;
  packetRecorder: BlePacketRecorder;
  latestFacelets: string | null;
  pendingFaceletRequest: ((facelets: string | null) => void) | null;
  onDecryptSuccess: () => void;
  onDecryptFailure: (err: unknown) => void;
  onMove: CubeMoveCallback | null;
  onBattery: CubeBatteryCallback | null;
  onGyro: CubeGyroCallback | null;
  onMoveStreamGap: CubeMoveStreamGapCallback | null;
  onPacket: CubePacketCallback | null;
  onV4GyroPacket: GanV4GyroPacketCallback | null;
}

export class GanV4Handler {
  private v4ReadChar: BluetoothRemoteGATTCharacteristic | null = null;
  private v4WriteChar: BluetoothRemoteGATTCharacteristic | null = null;
  /** 最近一次实时动作包时刻；用于局面快照落后时的历史补偿判定 */
  private prevMoveLocTime: number | null = null;
  private readonly v4MoveStream = new GanV4MoveStream();
  /** 上次历史请求的键，避免同一缺口在通知队列里自旋 */
  private lastV4HistoryRequestKey: string | null = null;
  private boundOnV4ValueChanged: ((e: Event) => void) | null = null;

  constructor(private readonly ctx: GanV4HandlerContext) {}

  get writeChar(): BluetoothRemoteGATTCharacteristic | null {
    return this.v4WriteChar;
  }

  async initV4(services: BluetoothRemoteGATTService[]): Promise<void> {
    const v4Service = services.find((s) => s.uuid.toUpperCase() === SERVICE_UUID_V4DATA.toUpperCase());
    if (!v4Service) throw new Error("找不到 v4 service");

    const chars = await v4Service.getCharacteristics();
    this.v4ReadChar = chars.find((c) => c.uuid.toUpperCase() === CHRCT_UUID_V4READ.toUpperCase()) || null;
    this.v4WriteChar = chars.find((c) => c.uuid.toUpperCase() === CHRCT_UUID_V4WRITE.toUpperCase()) || null;

    if (!this.v4ReadChar) throw new Error("找不到 v4 read characteristic");

    await this.v4ReadChar.startNotifications();
    this.boundOnV4ValueChanged = (e: Event) => {
      const value = (e.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;
      const bytes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
      this.ctx.notificationQueue = this.ctx.notificationQueue
        .then(() => this.handleV4Event(new DataView(bytes.buffer)))
        .catch((err: unknown) => console.error("[gan-cube] v4 通知处理异常:", err));
    };
    this.v4ReadChar.addEventListener("characteristicvaluechanged", this.boundOnV4ValueChanged);

    await this.sendV4HardwareInfoRequest();
    await this.sendV4FaceletsRequest();
    await this.sendV4BatteryRequest();

    debugLog("[gan-cube] v4 协议初始化完成");
  }

  private async sendV4Request(req: number[]): Promise<void> {
    if (!this.v4WriteChar) return;
    const encodedReq = this.ctx.decoder ? await encodeGanValue(this.ctx.decoder, req) : req;
    await this.v4WriteChar.writeValue(new Uint8Array(encodedReq).buffer);
  }

  async sendV4FaceletsRequest(): Promise<void> {
    const req = new Array(20).fill(0);
    req[0] = 0xdd;
    req[1] = 0x04;
    req[3] = 0xed;
    await this.sendV4Request(req);
  }

  async sendV4BatteryRequest(): Promise<void> {
    const req = new Array(20).fill(0);
    req[0] = 0xdd;
    req[1] = 0x04;
    req[3] = 0xef;
    await this.sendV4Request(req);
  }

  async sendV4HardwareInfoRequest(): Promise<void> {
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

  private async requestV4MoveHistoryForGap(previousMoveCnt: number, headMoveCnt: number, diff: number): Promise<void> {
    const key = `${previousMoveCnt}:${headMoveCnt}`;
    // 同一历史响应若没有推进计数，不能在通知队列里自旋；等待下一条实时 move 再重试。
    if (key === this.lastV4HistoryRequestKey) return;
    this.lastV4HistoryRequestKey = key;
    await this.requestV4MoveHistory(headMoveCnt, diff);
  }

  private async handleV4StreamResult(result: GanV4StreamResult, requestHistory: boolean): Promise<void> {
    for (const move of result.emitted) {
      this.lastV4HistoryRequestKey = null;
      this.ctx.onMove?.({
        move: move.move,
        timestamp: move.timestamp ?? 0,
        locTime: move.locTime ?? Date.now(),
        moveCnt: move.moveCnt,
      });
    }
    if (result.overflowed) {
      console.warn("[gan-cube] v4 move 缓冲过长，已重置动作流恢复状态");
      this.prevMoveLocTime = null;
      return;
    }
    if (!result.gap) return;
    console.warn(`[gan-cube] v4 检测到丢步 prev=${result.gap.previousMoveCnt} next=${result.gap.nextMoveCnt} diff=${result.gap.missing}`);
    if (!requestHistory) {
      this.ctx.onMoveStreamGap?.(result.gap);
      return;
    }
    this.ctx.packetRecorder.start(false);
    await this.requestV4MoveHistoryForGap(result.gap.previousMoveCnt, result.gap.nextMoveCnt, result.gap.missing);
  }

  private async handleV4Event(value: DataView): Promise<void> {
    const locTime = Date.now();
    const rawBytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    this.ctx.packetRecorder.record(BlePacketProtocol.GanV4, rawBytes, locTime);
    let bytes: number[];
    try {
      bytes = await this.decodeValue(value);
    } catch (error) {
      console.error("[gan-cube] v4 包解密失败，已按原始包记录:", error);
      this.ctx.onPacket?.({
        protocol: "gan-v4",
        receivedAt: locTime,
        mode: null,
        rawBytes: Array.from(rawBytes),
      });
      return;
    }
    const binaryStr = bytes.map((b) => b.toString(2).padStart(8, "0")).join("");
    const mode = parseInt(binaryStr.slice(0, 8), 2);
    const len = parseInt(binaryStr.slice(8, 16), 2);
    this.ctx.packetRecorder.annotateLast(bytes, mode);
    this.ctx.onPacket?.({
      protocol: "gan-v4",
      receivedAt: locTime,
      mode,
      rawBytes: Array.from(rawBytes),
      decodedBytes: [...bytes],
    });

    if (mode === 0x01) {
      this.prevMoveLocTime = locTime;
      const moves = parseGanV4MovePacket(bytes);
      if (moves.length === 0) {
        console.warn("[gan-cube] v4 实时动作包没有可用的 72-bit 动作块");
        return;
      }
      const result = this.v4MoveStream.acceptLive(moves.map((move) => ({ ...move, locTime })));
      await this.handleV4StreamResult(result, true);
    } else if (mode === 0xed) {
      const state = parseGanV4CubeStatePacket(bytes);
      if (!state) {
        console.warn("[gan-cube] v4 局面包校验失败，无法确认实体状态");
        this.ctx.pendingFaceletRequest?.(null);
        return;
      }
      const moveCnt = state.moveCnt;
      this.ctx.latestFacelets = state.facelets;
      this.ctx.pendingFaceletRequest?.(state.facelets);
      if (this.v4MoveStream.hasBaseline) {
        const diff = (moveCnt - this.v4MoveStream.previous) & 0xff;
        if (diff > 0 && moveCnt !== 0 && this.prevMoveLocTime !== null && locTime - this.prevMoveLocTime > 500) {
          const startMoveCnt = this.v4MoveStream.nextBufferedMoveCnt ?? ((moveCnt + 1) & 0xff);
          await this.requestV4MoveHistory(startMoveCnt, diff + 1);
        }
        return;
      }
      this.v4MoveStream.reset(moveCnt);
      debugLog(`[gan-cube] v4 facelets event #${moveCnt}`);
    } else if (mode === 0xd1) {
      const packet = parseGanV4MoveHistoryPacket(bytes);
      if (!packet) return;
      debugLog(`[gan-cube] v4 历史 move 响应 start=${packet.startMoveCnt} count=${packet.moves.length}`);
      const result = this.v4MoveStream.acceptHistory(packet.moves.map((item) => ({
          moveCnt: item.moveCnt,
          move: item.move,
          timestamp: null,
          locTime: null,
      })));
      await this.handleV4StreamResult(result, false);
    } else if (mode === 0xef) {
      const level = parseInt(binaryStr.slice(8 + len * 8, 16 + len * 8), 2);
      if (!Number.isFinite(level)) {
        console.warn("[gan-cube] v4 battery event length invalid", { len, byteLength: bytes.length });
        return;
      }
      debugLog(`[gan-cube] v4 电量 ${level}%`);
      this.ctx.onBattery?.(level);
    } else if ([0xf5, 0xf6, 0xfa, 0xfc, 0xfd, 0xfe, 0xff].includes(mode)) {
      debugLog(`[gan-cube] v4 hardware info mode=0x${mode.toString(16)}`);
    } else if (mode === 0xec) {
      const gyroPacket = parseGanV4GyroPacket(bytes);
      if (!gyroPacket) return;
      this.ctx.onGyro?.(gyroPacket.quaternion);
      this.ctx.onV4GyroPacket?.({
        ...gyroPacket,
        rawBytes: Array.from(rawBytes),
        locTime,
      });
    } else {
      console.warn(`[gan-cube] v4 unknown event mode=0x${mode.toString(16)}`);
    }
  }

  private async decodeValue(value: DataView): Promise<number[]> {
    const raw = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (!this.ctx.decoder) return Array.from(raw);
    try {
      const decrypted = await decodeGanValue(this.ctx.decoder, raw);
      this.ctx.onDecryptSuccess();
      return Array.from(decrypted);
    } catch (err) {
      this.ctx.onDecryptFailure(err);
      throw err;
    }
  }

  /** 更新 MAC / 断开后重置动作流状态，避免新旧会话混淆。 */
  reset(): void {
    this.prevMoveLocTime = null;
    this.v4MoveStream.reset();
    this.lastV4HistoryRequestKey = null;
  }

  /** 移除通知监听并停止通知；断连清理时调用，防止重连时泄漏。 */
  dispose(): void {
    if (this.v4ReadChar && this.boundOnV4ValueChanged) {
      this.v4ReadChar.removeEventListener("characteristicvaluechanged", this.boundOnV4ValueChanged);
      this.v4ReadChar.stopNotifications().catch((error: unknown) => {
        console.error("[gan-cube] v4 stopNotifications 失败:", error);
      });
    }
    this.boundOnV4ValueChanged = null;
    this.v4ReadChar = null;
    this.v4WriteChar = null;
    this.reset();
  }
}
