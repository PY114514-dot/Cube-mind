/**
 * scramble/scramble-333.ts
 * 3x3 WCA 标准打乱生成器
 *
 * 算法规则（WCA 官方）：
 *   1. 从 6 个轴中随机选一个
 *   2. power 从 {0,1,2} 中随机选
 *   3. 不能与上一个 move 同轴
 *   4. 不能与上一个 move 同轴反向（避免 "R R'" 等无效序列）
 *
 * 与 cstimer 的差异：
 *   cstimer 还会在第一/最后一move避免 D/D'、最后一步避免 D
 *   这里先实现核心规则，留作扩展
 */

const AXES = [0, 1, 2, 3, 4, 5] as const; // U R F D L B
const POWERS = [0, 1, 2] as const;        // 顺时针 90° / 180° / 逆时针 90°
const FACE_NAMES = "URFDLB";
const POWER_SUFFIX = ["", "2", "'"];

/** 随机整数 [min, max] */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** 生成单次打乱（默认 20 步，符合 WCA 标准） */
export function scramble333(length: number = 20): string {
  const moves: number[] = [];
  let prevAxis = -1;

  for (let i = 0; i < length; i++) {
    let axis: number;
    let power: number;
    let attempts = 0;

    do {
      axis = AXES[randInt(0, 5)];
      power = POWERS[randInt(0, 2)];
      attempts++;

      // 规则 1: 不能与上一步同轴
      if (axis === prevAxis) continue;

      // 规则 2: 不能与上一步同轴反向（power 互补）
      if (
        i > 0 &&
        axis === Math.floor(moves[i - 1] / 3) &&
        power + (moves[i - 1] % 3) === 2
      ) {
        continue;
      }

      break;
    } while (attempts < 20);

    moves.push(axis * 3 + power);
    prevAxis = axis;
  }

  // 转换为字符串
  return moves.map((idx) => {
    const axis = Math.floor(idx / 3);
    const power = idx % 3;
    return FACE_NAMES.charAt(axis) + POWER_SUFFIX[power];
  }).join(" ");
}

/** 解析打乱字符串为 move index 数组 */
export function parseScramble(scramble: string): number[] {
  return scramble
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0)
    .map((s) => {
      const face = s[0].toUpperCase();
      const axis = FACE_NAMES.indexOf(face);
      if (axis === -1) throw new Error(`Invalid face: ${face}`);
      const power = s.includes("'") ? 2 : s.includes("2") ? 1 : 0;
      return axis * 3 + power;
    });
}

/** 打乱字符串转可读展示（可选：替换空格的换行） */
export function scrambleToDisplay(scramble: string, perLine: number = 10): string {
  const moves = scramble.split(" ");
  const lines: string[] = [];
  for (let i = 0; i < moves.length; i += perLine) {
    lines.push(moves.slice(i, i + perLine).join(" "));
  }
  return lines.join("\n");
}