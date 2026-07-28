/** GAN v2 通知包回放器，用于把真机录包固定为可重复的回归测试。 */

import { parseGanV2MovePacket } from "./gan-cube-protocol.ts";

export interface GanV2ReplayPacket {
  bytes: number[];
  receivedAt: number;
}

export interface GanV2ReplayMove {
  move: string;
  moveCnt: number;
  timestamp: number;
  receivedAt: number;
}

export interface GanV2ReplayResult {
  moves: GanV2ReplayMove[];
  ignoredPacketIndexes: number[];
  finalMoveCnt: number;
}

/**
 * 逐包重放 GAN v2 的历史窗口。
 * 首包只建立 moveCnt 基线；重复包不得重复产生动作。
 */
export function replayGanV2Packets(packets: GanV2ReplayPacket[]): GanV2ReplayResult {
  let prevMoveCnt = -1;
  const moves: GanV2ReplayMove[] = [];
  const ignoredPacketIndexes: number[] = [];

  packets.forEach((packet, index) => {
    const parsed = parseGanV2MovePacket(packet.bytes, prevMoveCnt);
    if (!parsed) {
      ignoredPacketIndexes.push(index);
      return;
    }
    prevMoveCnt = parsed.moveCnt;
    for (const move of parsed.moves) {
      moves.push({ ...move, receivedAt: packet.receivedAt });
    }
  });

  return { moves, ignoredPacketIndexes, finalMoveCnt: prevMoveCnt };
}
