import { scramble333 } from "../scramble/scramble-333.ts";
import { getCrossDistanceForScramble } from "./cross-solver.ts";

export interface CrossScrambleOptions {
  targetFace?: string;
  scrambleLength?: number;
  maxAttempts?: number;
}

const DEFAULT_SCRAMBLE_LENGTH = 20;
// 8 步 Cross 在完整随机状态中较少见；宁可多抽样，也不能退化为短打乱。
const DEFAULT_MAX_ATTEMPTS = 24_000;
const MAX_CROSS_STEPS = 8;

function findExactLengthScramble(
  targetSteps: number,
  targetFace: string,
  scrambleLength: number,
  maxAttempts: number,
): string | null {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const scramble = scramble333(scrambleLength);
    if (getCrossDistanceForScramble(scramble, targetFace) === targetSteps) return scramble;
  }
  return null;
}

/**
 * 生成 Cross 最短解恰好为指定步数的打乱。
 *
 * 始终返回指定长度的 WCA 风格打乱；训练难度只约束最短 Cross 解，
 * 绝不缩短整条打乱序列。
 */
export function scrambleWithCrossSteps(targetSteps: number, options: CrossScrambleOptions = {}): string {
  if (!Number.isInteger(targetSteps) || targetSteps < 1 || targetSteps > MAX_CROSS_STEPS) {
    throw new Error(`[cross-scramble] Cross 步数必须是 1 到 ${MAX_CROSS_STEPS} 的整数`);
  }
  const targetFace = options.targetFace ?? "U";
  const length = options.scrambleLength ?? DEFAULT_SCRAMBLE_LENGTH;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(length) || length < targetSteps) {
    throw new Error("[cross-scramble] 打乱长度不能小于指定 Cross 步数");
  }

  const exact = findExactLengthScramble(targetSteps, targetFace, length, maxAttempts);
  if (exact) return exact;
  throw new Error(`[cross-scramble] ${targetSteps} 步 Cross 在 ${maxAttempts} 次 WCA 20 步抽样内未找到，请重新生成`);
}
