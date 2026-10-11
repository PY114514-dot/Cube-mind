import { invertAlgorithm } from "../formula/cube-case-diagram.ts";
import { moveToStr, parseMove } from "../utils/mathlib.ts";

/** 合并相邻同面动作，避免连续重试把已互相抵消的过渡链反复累积。 */
export function compactMoves(sequence: string[]): string[] {
  const moves: number[] = [];
  for (const move of sequence) {
    const index = parseMove(move);
    const previous = moves[moves.length - 1];
    if (previous !== undefined && Math.floor(previous / 3) === Math.floor(index / 3)) {
      moves.pop();
      const turns = ((previous % 3) + (index % 3) + 2) % 4;
      if (turns > 0) moves.push(Math.floor(index / 3) * 3 + turns - 1);
    } else moves.push(index);
  }
  return moves.map(moveToStr);
}

/** 从页面已追踪的实体局面切换到下一个公式 setup，不能假设用户已手动复原。 */
export function buildPracticeTransitionMoves(currentMoves: string[], targetSetupMoves: string[]): string[] {
  return [...invertAlgorithm(currentMoves), ...targetSetupMoves];
}
