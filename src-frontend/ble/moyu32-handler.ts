/**
 * ble/moyu32-handler.ts
 * WCU_MY32 加密协议 handler：read/write 特征订阅、AES 解密、事件分发与请求发送。
 *
 * 拆自 moyu-cube-protocol.ts（P1 技术债）：解密为异步操作，通知必须按
 * 抵达顺序串行处理，共享的 notificationQueue 等状态放在 ctx 对象中由外观层持有，
 * handler 与 MHC handler 共用同一实例，避免循环依赖。
 */

import type {
  CubeMoveCallback,
  CubeMoveStreamGapCallback,
  CubeErrorCallback,
  CubeBatteryCallback,
  CubeGyroCallback,
} from "./cube-driver.ts";
import {
  parseMoyu32Data,
  parseMoyu32Gyro,
  MOYU32_SERVICE_UUID,
  MOYU32_CHRCT_UUID_READ,
  MOYU32_CHRCT_UUID_WRITE,
  MOYU32_CIC_LIST,
} from "./moyu-parsers.ts";
import { encodeGanValue, decodeGanValue, type GanDecoder } from "./gan-crypto.ts";
import { Moyu32MoveStream } from "./moyu32-move-stream.ts";
import { BlePacketProtocol, type BlePacketRecorder } from "./ble-packet-harness.ts";
import { debugLog } from "../utils/debug.ts";

const MOYU32_GYRO_REQUEST = 0xac;

/** WCU32 handler 所需的共享状态（外观层提供，是 MHC 上下文的超集） */
export interface Moyu32HandlerContext {
  decoder: GanDecoder | null;
  notificationQueue: Promise<void>;
  packetRecorder: BlePacketRecorder;
  pendingFaceletRequest: ((facelets: string | null) => void) | null;
  prevMoveCnt: number;
  deviceTimestamp: number;
  moyu32MoveStream: Moyu32MoveStream;
  onMove: CubeMoveCallback | null;
  onMoveStreamGap: CubeMoveStreamGapCallback | null;
  onError: CubeErrorCallback | null;
  onBattery: CubeBatteryCallback | null;
  onGyro: CubeGyroCallback | null;
}

export class Moyu32Handler {
  private readChar: BluetoothRemoteGATTCharacteristic | null = null;
  private writeChar: BluetoothRemoteGATTCharacteristic | null = null;
  private boundOnReadChanged: ((e: Event) => void) | null = null;

  constructor(private readonly ctx: Moyu32HandlerContext) {}

  /** write 特征是否就绪（外观层 requestFacelets 前置判断，避免 Promise 悬挂） */
  get hasWriteChar(): boolean {
    return this.writeChar !== null;
  }

  /** 连接 GATT、订阅 read 通知并完成 WCU 握手（info/state/battery/gyro 请求序列） */
  async init(device: BluetoothDevice): Promise<void> {
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
      const receivedAt = Date.now();
      this.ctx.notificationQueue = this.ctx.notificationQueue
        .then(() => this.handleMoyu32(value, receivedAt))
        .catch((err: unknown) => console.error("[moyu-cube] WCU event error:", err));
    };
    this.readChar.addEventListener("characteristicvaluechanged", this.boundOnReadChanged);
    await this.readChar.startNotifications();
    await this.sendMoyu32Request(161);
    await this.sendMoyu32Request(163);
    await this.sendMoyu32Request(164);
    await this.sendMoyu32GyroEnableRequest();
    await this.sendMoyu32Request(163);
  }

  /** 解密后的 WCU 载荷统一入口：gyro 优先，其余按事件类型分发 */
  private async handleMoyu32(data: DataView, locTime: number): Promise<void> {
    this.ctx.packetRecorder.record(BlePacketProtocol.Moyu32, new Uint8Array(data.buffer, data.byteOffset, data.byteLength), locTime);
    const bytes = await this.decodeMoyu32(data);
    this.ctx.packetRecorder.annotateLast(bytes, bytes[0]);
    const gyro = parseMoyu32Gyro(bytes);
    if (gyro) {
      this.ctx.onGyro?.(gyro);
      return;
    }
    const event = parseMoyu32Data(bytes, this.ctx.prevMoveCnt);
    if (event.type === "state" && event.moveCnt !== undefined) {
      if (this.ctx.prevMoveCnt === -1) {
        this.ctx.prevMoveCnt = event.moveCnt;
        this.ctx.moyu32MoveStream.reset(event.moveCnt);
      }
      this.ctx.pendingFaceletRequest?.(event.facelets ?? null);
      return;
    }
    if (event.type === "battery" && event.batteryLevel !== undefined) {
      this.ctx.onBattery?.(event.batteryLevel);
      return;
    }
    if (event.type === "info") {
      debugLog(`[moyu-cube] WCU ${event.deviceName} HW=${event.hardwareVersion} SW=${event.softwareVersion}`);
      return;
    }
    if (event.type !== "move" || !event.moves || event.moveCnt === undefined) return;

    const previousMoveCnt = this.ctx.prevMoveCnt;
    this.ctx.prevMoveCnt = event.moveCnt;
    const streamResult = this.ctx.moyu32MoveStream.accept(event.moveCnt, event.moves);
    if (streamResult.missing > 0) {
      this.ctx.onMoveStreamGap?.({ missing: streamResult.missing, previousMoveCnt, nextMoveCnt: event.moveCnt });
    }
    const moves = streamResult.emitted;
    const totalOffset = moves.reduce((sum, move) => sum + Math.max(1, move.timestamp), 0);
    let timestamp = this.ctx.deviceTimestamp || locTime - totalOffset;
    for (let i = 0; i < moves.length; i++) {
      timestamp += Math.max(1, moves[i].timestamp);
      const move = moves[i];
      this.ctx.onMove?.({
        move: move.move,
        timestamp,
        locTime: i === moves.length - 1 ? locTime : locTime - (moves.length - i - 1) * 10,
        moveCnt: move.moveCnt,
      });
    }
    // 设备间隔累计在重连或长时间空闲后会漂移；只在明显失真时重新锚定浏览器时间。
    this.ctx.deviceTimestamp = Math.abs(locTime - timestamp) > 2000 ? locTime : timestamp;
  }

  /** 发送 WCU 请求（20 字节，opcode 打头，有 decoder 时加密） */
  async sendMoyu32Request(opcode: number): Promise<void> {
    if (!this.writeChar) return;
    const req = new Array(20).fill(0);
    req[0] = opcode;
    const encoded = this.ctx.decoder ? await encodeGanValue(this.ctx.decoder, req) : req;
    await this.writeChar.writeValue(new Uint8Array(encoded).buffer);
  }

  private async sendMoyu32GyroEnableRequest(): Promise<void> {
    if (!this.writeChar) return;
    const req = new Array(20).fill(0);
    req[0] = MOYU32_GYRO_REQUEST;
    req[2] = 1;
    const encoded = this.ctx.decoder ? await encodeGanValue(this.ctx.decoder, req) : req;
    await this.writeChar.writeValue(new Uint8Array(encoded).buffer);
  }

  private async decodeMoyu32(value: DataView): Promise<number[]> {
    const raw = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (!this.ctx.decoder) return Array.from(raw);
    const decrypted = await decodeGanValue(this.ctx.decoder, raw);
    return Array.from(decrypted);
  }

  /** 移除监听并停止通知（幂等，可重复调用） */
  dispose(): void {
    if (this.readChar && this.boundOnReadChanged) {
      this.readChar.removeEventListener("characteristicvaluechanged", this.boundOnReadChanged);
      this.readChar.stopNotifications().catch((error: unknown) => {
        console.error("[moyu-cube] read 特征 stopNotifications 失败:", error);
      });
    }
    this.boundOnReadChanged = null;
    this.readChar = null;
    this.writeChar = null;
  }
}

/**
 * 从 WCU 广播的 manufacturerData 提取 MAC 地址（字节逆序拼成 xx:xx:xx:xx:xx:xx）。
 * 5 秒内收不到广播则返回 null，由调用方走设备名 fallback。
 */
export async function extractMoyu32Mac(device: BluetoothDevice | null): Promise<string | null> {
  const watchAdvertisements = device?.watchAdvertisements?.bind(device);
  if (!device || !watchAdvertisements) return null;
  return new Promise((resolve) => {
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      device.removeEventListener("advertisementreceived", handler);
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
        device.removeEventListener("advertisementreceived", handler);
        abortController.abort();
        resolve(bytes.map((b) => b.toString(16).padStart(2, "0")).join(":"));
        return;
      }
    };

    device.addEventListener("advertisementreceived", handler);
    watchAdvertisements({ signal: abortController.signal }).catch((error: unknown) => {
      console.error("[moyu-cube] watchAdvertisements 失败:", error);
    });
  });
}
