/** GAN v4 实时动作包：一个 BLE 通知可连续包含多个 72-bit 动作块。 */

const GAN_V4_AXIS_MASKS = [2, 32, 8, 1, 16, 4];
const GAN_V4_MOVE_CHUNK_BITS = 72;

export interface GanV4LiveMove {
  moveCnt: number;
  move: string;
  timestamp: number;
}

/**
 * 只负责将已解密通知转换为有序动作；遇到非动作尾块或非法轴即停止，避免把填充位当成转动。
 */
export function parseGanV4MovePacket(bytes: readonly number[]): GanV4LiveMove[] {
  const bits = bytes.map((byte) => byte.toString(2).padStart(8, "0")).join("");
  const moves: GanV4LiveMove[] = [];
  for (let offset = 0; offset + GAN_V4_MOVE_CHUNK_BITS <= bits.length; offset += GAN_V4_MOVE_CHUNK_BITS) {
    if (readBits(bits, offset, 8) !== 0x01) break;
    const axis = GAN_V4_AXIS_MASKS.indexOf(readBits(bits, offset + 66, 6));
    if (axis === -1) break;
    moves.push({
      moveCnt: readBits(bits, offset + 56, 8) << 8 | readBits(bits, offset + 48, 8),
      move: "URFDLB".charAt(axis) + powerToSuffix(readBits(bits, offset + 64, 2)),
      timestamp: (readBits(bits, offset + 40, 8) << 24
        | readBits(bits, offset + 32, 8) << 16
        | readBits(bits, offset + 24, 8) << 8
        | readBits(bits, offset + 16, 8)) >>> 0,
    });
  }
  return moves;
}

function readBits(bits: string, start: number, length: number): number {
  return parseInt(bits.slice(start, start + length), 2);
}

function powerToSuffix(power: number): string {
  if (power === 1) return "'";
  if (power === 2) return "2";
  return "";
}
