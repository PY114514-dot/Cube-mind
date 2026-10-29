import type { F2lSolutionReview } from "../src-shared/analysis-types.ts";
import { isRecord, isInteger } from "./validation-values.ts";

function isSlots(value: unknown): value is F2lSolutionReview["slots"] {
  return Array.isArray(value) && value.length <= 4 && new Set(value).size === value.length
    && value.every((slot) => slot === "FR" || slot === "FL" || slot === "BL" || slot === "BR");
}

/** 限定候选证据的动作范围与记谱，模型只能引用已提交的局部方案。 */
export function parseF2lSolutions(value: unknown, moves: string[] | undefined): F2lSolutionReview[] | undefined {
  if (!Array.isArray(value) || value.length > 4) return undefined;
  const result: F2lSolutionReview[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isSlots(item.slots) || item.slots.length === 0 || !isSlots(item.preservedSlots)
      || (item.targetFace !== "U" && item.targetFace !== "D") || !isInteger(item.startMoveIndex)
      || !isInteger(item.endMoveIndex) || item.startMoveIndex < 0 || item.endMoveIndex <= item.startMoveIndex
      || item.endMoveIndex > (moves?.length ?? 0) || !isInteger(item.actualStepCount) || item.actualStepCount < 0
      || item.actualStepCount > item.endMoveIndex - item.startMoveIndex || typeof item.note !== "string" || item.note.length > 500) return undefined;
    let candidate: F2lSolutionReview["candidate"];
    if (item.candidate !== undefined) {
      if (!isRecord(item.candidate) || typeof item.candidate.name !== "string" || item.candidate.name.length > 100
        || !Array.isArray(item.candidate.moves) || item.candidate.moves.length === 0 || item.candidate.moves.length > 81
        || !item.candidate.moves.every((move): move is string => typeof move === "string" && /^[URFDLB](?:2|')?$/.test(move))) return undefined;
      candidate = { name: item.candidate.name, moves: item.candidate.moves };
    }
    result.push({ slots: item.slots, targetFace: item.targetFace, startMoveIndex: item.startMoveIndex,
      endMoveIndex: item.endMoveIndex, actualStepCount: item.actualStepCount, preservedSlots: item.preservedSlots,
      candidate, note: item.note });
  }
  return result;
}
