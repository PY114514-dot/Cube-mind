/**
 * scramble/scramble-333.ts
 * 3x3 WCA 标准打乱生成器
 *
 * 算法规则（WCA 官方）：
 *   1. 不能与上一步同面（避免 "R R'" 等无效序列）
 *   2. 若前两步属于同一物理轴，则当前步不能在该轴上（避免 "U D U'" 等冗余序列）
 *
 * 物理轴定义：U/D → 轴0，R/L → 轴1，F/B → 轴2
 * 面编号：U=0 R=1 F=2 D=3 L=4 B=5，物理轴 = face % 3
 */

const FACES = [0, 1, 2, 3, 4, 5] as const; // U R F D L B
const POWERS = [0, 1, 2] as const;         // 顺时针 90° / 180° / 逆时针 90°
const FACE_NAMES = "URFDLB";
const POWER_SUFFIX = ["", "2", "'"];
const MAX_ATTEMPTS = 50;

/** 面编号 → 物理轴（U/D=0, R/L=1, F/B=2） */
function physicalAxis(face: number): number {
  return face % 3;
}

/** 随机整数 [min, max] */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** 生成单次打乱（默认 20 步，符合 WCA 标准） */
export function scramble333(length: number = 20): string {
  const moves: number[] = [];

  for (let i = 0; i < length; i++) {
    let face: number = 0;
    let power: number = 0;
    let valid = false;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      face = FACES[randInt(0, 5)];
      power = POWERS[randInt(0, 2)];

      // 规则 1: 不能与上一步同面
      if (i > 0) {
        const prevFace = Math.floor(moves[i - 1] / 3);
        if (face === prevFace) continue;
      }

      // 规则 2: 若前两步同物理轴，当前步不能在该轴上
      if (i > 1) {
        const prevFace1 = Math.floor(moves[i - 1] / 3);
        const prevFace2 = Math.floor(moves[i - 2] / 3);
        if (physicalAxis(prevFace1) === physicalAxis(prevFace2)
          && physicalAxis(face) === physicalAxis(prevFace1)) {
          continue;
        }
      }

      valid = true;
      break;
    }

    if (!valid) {
      throw new Error(`[scramble-333] 无法在 ${MAX_ATTEMPTS} 次尝试内生成合法第 ${i + 1} 步`);
    }

    moves.push(face * 3 + power);
  }

  // 转换为字符串
  return moves.map((idx) => {
    const face = Math.floor(idx / 3);
    const power = idx % 3;
    return FACE_NAMES.charAt(face) + POWER_SUFFIX[power];
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