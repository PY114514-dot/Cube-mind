/**
 * BLE 调试包录制器。
 * 默认关闭且仅保存在内存中，避免真实设备数据在未确认时被持久化。
 */

import type { CubePacketProtocol } from "./cube-driver.ts";

export const BlePacketProtocol = {
  GanV2: "gan-v2",
  GanV4: "gan-v4",
  MoyuTurn: "moyu-turn",
  Moyu32: "moyu32",
} as const;

export type BlePacketProtocol = CubePacketProtocol;

export interface BlePacketRecord {
  protocol: BlePacketProtocol;
  receivedAt: number;
  bytes: number[];
  decodedBytes?: number[];
  mode?: number;
}

export interface BlePacketFixture {
  schemaVersion: 1;
  packets: BlePacketRecord[];
}

function copyBytes(bytes: readonly number[] | Uint8Array, label: string): number[] {
  return Array.from(bytes, (byte) => {
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error(`[ble-packet-harness] 非法${label}: ${byte}`);
    }
    return byte;
  });
}

/**
 * 仅在调用 start 后保存原始 BLE 通知包。
 *
 * 录制器不使用网络或 localStorage；超出上限时丢弃最早的包，确保调试不会无界占用内存。
 */
export class BlePacketRecorder {
  private enabled = false;
  private records: BlePacketRecord[] = [];

  constructor(private readonly maxRecords = 200) {
    if (!Number.isInteger(maxRecords) || maxRecords < 1) {
      throw new Error(`[ble-packet-harness] maxRecords 必须是正整数: ${maxRecords}`);
    }
  }

  start(clear = true): void {
    this.enabled = true;
    if (clear) this.records = [];
  }

  stop(): void {
    this.enabled = false;
  }

  record(
    protocol: BlePacketProtocol,
    bytes: readonly number[] | Uint8Array,
    receivedAt: number,
    decodedBytes?: readonly number[] | Uint8Array,
    mode?: number,
  ): void {
    if (!this.enabled) return;
    if (!Number.isFinite(receivedAt)) {
      throw new Error(`[ble-packet-harness] 非法接收时间: ${receivedAt}`);
    }
    if (mode !== undefined && (!Number.isInteger(mode) || mode < 0 || mode > 0xff)) {
      throw new Error(`[ble-packet-harness] 非法包模式: ${mode}`);
    }
    const record: BlePacketRecord = {
      protocol,
      receivedAt,
      bytes: copyBytes(bytes, "字节"),
    };
    if (decodedBytes !== undefined) record.decodedBytes = copyBytes(decodedBytes, "解密字节");
    if (mode !== undefined) record.mode = mode;
    this.records.push(record);
    if (this.records.length > this.maxRecords) this.records.shift();
  }

  annotateLast(decodedBytes: readonly number[] | Uint8Array, mode?: number): void {
    if (!this.enabled || this.records.length === 0) return;
    if (mode !== undefined && (!Number.isInteger(mode) || mode < 0 || mode > 0xff)) {
      throw new Error(`[ble-packet-harness] 非法包模式: ${mode}`);
    }
    const record = this.records[this.records.length - 1];
    record.decodedBytes = copyBytes(decodedBytes, "解密字节");
    if (mode !== undefined) record.mode = mode;
  }

  getRecords(): BlePacketRecord[] {
    return this.records.map((record) => ({
      ...record,
      bytes: [...record.bytes],
      ...(record.decodedBytes ? { decodedBytes: [...record.decodedBytes] } : {}),
    }));
  }

  exportFixture(): string {
    const fixture: BlePacketFixture = { schemaVersion: 1, packets: this.getRecords() };
    return JSON.stringify(fixture, null, 2);
  }
}
