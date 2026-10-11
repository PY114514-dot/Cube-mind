/**
 * ble/moyu-mhc-handler.ts
 * MHC 明文协议 handler：负责 turn/gyro 特征订阅与事件解析，不含连接生命周期。
 *
 * 拆自 moyu-cube-protocol.ts（P1 技术债）：共享可变状态（faceStatus、回调、
 * 录制器）由外观层的 ctx 对象持有，handler 只声明自己需要的子集，
 * 与 WCU32 handler 通过同一个 ctx 实例协作。
 */

import type { CubeMove, CubeMoveCallback } from "./cube-driver.ts";
import {
  parseTurn,
  MOYU_SERVICE_UUID,
  MOYU_CHRCT_UUID_READ,
  MOYU_CHRCT_UUID_TURN,
  MOYU_CHRCT_UUID_GYRO,
  type MoyuGyroRawCallback,
} from "./moyu-parsers.ts";
import { BlePacketProtocol, type BlePacketRecorder } from "./ble-packet-harness.ts";

/** MHC handler 所需的共享状态子集（外观层提供，与 WCU32 上下文共用同一对象） */
export interface MhcHandlerContext {
  faceStatus: number[];
  packetRecorder: BlePacketRecorder;
  onMove: CubeMoveCallback | null;
  onGyroRaw: MoyuGyroRawCallback | null;
}

export class MhcHandler {
  private turnChar: BluetoothRemoteGATTCharacteristic | null = null;
  private gyroChar: BluetoothRemoteGATTCharacteristic | null = null;
  private boundOnTurnChanged: ((e: Event) => void) | null = null;
  private boundOnGyroChanged: ((e: Event) => void) | null = null;

  constructor(private readonly ctx: MhcHandlerContext) {}

  /** 连接 GATT、订阅 turn/gyro 通知；失败时抛错由外观层统一清理 */
  async init(device: BluetoothDevice): Promise<void> {
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
        this.ctx.onGyroRaw?.({
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

  /** 处理 turn 事件，喂入 parseTurn 并触发回调 */
  private handleTurn(data: DataView, locTime: number): void {
    this.ctx.packetRecorder.record(BlePacketProtocol.MoyuTurn, new Uint8Array(data.buffer, data.byteOffset, data.byteLength), locTime);
    const results = parseTurn(data, locTime, this.ctx.faceStatus);
    for (const r of results) {
      const move: CubeMove = {
        move: r.move,
        timestamp: r.timestamp,
        locTime,
        moveCnt: -1, // 魔域无 moveCnt
      };
      this.ctx.onMove?.(move);
    }
  }

  /** 移除监听并停止通知，防止重连时泄漏（幂等，可重复调用） */
  dispose(): void {
    if (this.turnChar && this.boundOnTurnChanged) {
      this.turnChar.removeEventListener("characteristicvaluechanged", this.boundOnTurnChanged);
      this.turnChar.stopNotifications().catch((error: unknown) => {
        console.error("[moyu-cube] turn 特征 stopNotifications 失败:", error);
      });
    }
    if (this.gyroChar && this.boundOnGyroChanged) {
      this.gyroChar.removeEventListener("characteristicvaluechanged", this.boundOnGyroChanged);
      this.gyroChar.stopNotifications().catch((error: unknown) => {
        console.error("[moyu-cube] gyro 特征 stopNotifications 失败:", error);
      });
    }
    this.boundOnTurnChanged = null;
    this.boundOnGyroChanged = null;
    this.turnChar = null;
    this.gyroChar = null;
  }
}
