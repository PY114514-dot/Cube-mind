import { CubieCube, parseMove } from "../utils/mathlib.ts";

export interface ScrambleReplayBaseline {
  moves: string[];
  matchesPlannedScramble: boolean;
}

/** 比较目标打乱和设备实际执行的动作是否到达同一状态。 */
export function isScrambleStateVerified(expectedMoves: string[], performedMoves: string[]): boolean {
  try {
    const expected = CubieCube.SOLVED.applyMoves(expectedMoves.map(parseMove)).toFaceCube();
    const performed = CubieCube.SOLVED.applyMoves(performedMoves.map(parseMove)).toFaceCube();
    return expected === performed;
  } catch (error) {
    console.error("[scramble-verification] 无法验证打乱状态:", error);
    return false;
  }
}

/**
 * 页面提示序列与实体实际执行的打乱不同时，后续回放必须从实体实际局面起算。
 * 这只修正分析基线，不会把“按提示完成打乱”的状态伪装成已验证。
 */
export function resolveScrambleReplayBaseline(expectedMoves: string[], performedMoves: string[]): ScrambleReplayBaseline {
  const matchesPlannedScramble = isScrambleStateVerified(expectedMoves, performedMoves);
  return {
    moves: matchesPlannedScramble ? [...expectedMoves] : [...performedMoves],
    matchesPlannedScramble,
  };
}
