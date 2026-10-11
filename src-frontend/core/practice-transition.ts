import { invertAlgorithm } from "../formula/cube-case-diagram.ts";

/** 从页面已追踪的实体局面切换到下一个公式 setup，不能假设用户已手动复原。 */
export function buildPracticeTransitionMoves(currentMoves: string[], targetSetupMoves: string[]): string[] {
  return [...invertAlgorithm(currentMoves), ...targetSetupMoves];
}
