/** GAN v4 已解密 BLE 包回放器：验证合包、补包与最终缺口结论。 */

import type { BlePacketRecord } from "./ble-packet-harness.ts";
import { parseGanV4MoveHistoryPacket } from "./gan-cube-protocol.ts";
import { parseGanV4MovePacket } from "./gan-v4-move-packet.ts";
import { GanV4MoveStream, type GanV4MoveGap, type GanV4StreamMove } from "./gan-v4-move-stream.ts";

export interface GanV4ReplayResult {
  moves: GanV4StreamMove[];
  finalGap: GanV4MoveGap | null;
  ignoredPacketIndexes: number[];
}

/** `baseline` 来自连接后状态包的 moveCnt；录包使用 decodedBytes 以避免保存密钥。 */
export function replayGanV4Packets(packets: BlePacketRecord[], baseline: number): GanV4ReplayResult {
  const stream = new GanV4MoveStream();
  stream.reset(baseline);
  const moves: GanV4StreamMove[] = [];
  const ignoredPacketIndexes: number[] = [];
  let finalGap: GanV4MoveGap | null = null;
  packets.forEach((packet, index) => {
    if (packet.protocol !== "gan-v4") return;
    const bytes = packet.decodedBytes ?? packet.bytes;
    const mode = bytes[0];
    const result = mode === 0x01
      ? stream.acceptLive(parseGanV4MovePacket(bytes).map((move) => ({ ...move, locTime: packet.receivedAt })))
      : mode === 0xd1
        ? stream.acceptHistory((parseGanV4MoveHistoryPacket(bytes)?.moves ?? []).map((move) => ({ ...move, timestamp: null, locTime: null })))
        : null;
    if (!result) {
      ignoredPacketIndexes.push(index);
      return;
    }
    moves.push(...result.emitted);
    finalGap = result.gap;
  });
  return { moves, finalGap, ignoredPacketIndexes };
}
