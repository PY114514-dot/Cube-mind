/**
 * core/case-event-assembly.ts
 * 把 P0-1（F2L 槽位 caseId）与 P0-2（OLL/PLL caseId）的识别输出组装成
 * AGENT 可直接消费的 CaseEvent 证据流：实际步数、所选解法参照与起手停顿。
 * 停顿按 move 索引与 moveGaps 对齐，不能仅凭间隔推断停顿原因。
 */

import type { CaseEvent } from "../../src-shared/analysis-types.ts";
import type { CfopResult } from "./cfop-parser.ts";
import type { F2lSlotAnalysis } from "./f2l-slot-tracker.ts";
import { isCubeSolved, isF2lComplete, isOllComplete } from "./last-layer-recognizer.ts";
import { normalizeCubeForD } from "./solve-notation.ts";
import { CubieCube, parseMove } from "../utils/mathlib.ts";

export interface CaseEventAssemblyInput {
  scrambleMoves: string[];
  solveMoves: string[];
  moveGaps: number[];
  cfop: CfopResult;
  f2lSlots: F2lSlotAnalysis | null;
  getCaseReference: (caseId: string) => CaseEvent["referenceAlgorithm"];
}

/** 按时间顺序组装本把的全部 case 事件：F2L 槽位完成序 → OLL → PLL。 */
export function assembleCaseEvents(input: CaseEventAssemblyInput): CaseEvent[] {
  const events: (CaseEvent | null)[] = [];

  const slots = (input.f2lSlots?.slots ?? [])
    .filter((slot) =>
      slot.caseId !== undefined
      && !slot.completedWithCross
      && slot.completedAtMove !== undefined
      && (slot.moves ?? 0) > 0)
    .sort((left, right) =>
      (left.completionOrder ?? Number.MAX_SAFE_INTEGER) - (right.completionOrder ?? Number.MAX_SAFE_INTEGER));
  for (const slot of slots) {
    if (slot.caseId === undefined) continue;
    const execMoves = slot.moves ?? 0;
    // moveSequence 起点 = 完成步数 - 步数；该索引的 gap 即识别停顿。
    const firstMoveIndex = (slot.completedAtMove ?? execMoves) - execMoves;
    events.push(buildEvent({
      stage: "F2L",
      caseId: slot.caseId,
      execMoves,
      recognitionPauseMs: pauseBeforeMove(input.moveGaps, firstMoveIndex),
      startMoveIndex: firstMoveIndex,
      endMoveIndex: slot.completedAtMove,
    }, input.getCaseReference));
  }

  const states = rebuildStates(input.scrambleMoves, input.solveMoves);
  const targetFace = input.cfop.caseTargetFace;
  if (input.cfop.ollCaseId !== undefined && input.cfop.ollCaseStartIndex !== undefined && targetFace !== undefined) {
    const startMoveIndex = input.cfop.ollCaseStartIndex + 1;
    const execMoves = countMovesUntil(states, input.cfop.ollCaseStartIndex, (state) => {
      const normalized = normalizeCubeForD(state, targetFace);
      return isF2lComplete(normalized) && isOllComplete(normalized);
    });
    events.push(buildEvent({
      stage: "OLL",
      caseId: input.cfop.ollCaseId,
      execMoves,
      recognitionPauseMs: pauseBeforeMove(input.moveGaps, startMoveIndex),
      startMoveIndex,
      endMoveIndex: startMoveIndex + execMoves,
    }, input.getCaseReference));
  }
  if (input.cfop.pllCaseId !== undefined && input.cfop.pllCaseStartIndex !== undefined) {
    const startMoveIndex = input.cfop.pllCaseStartIndex + 1;
    const execMoves = countMovesUntil(states, input.cfop.pllCaseStartIndex, isCubeSolved);
    events.push(buildEvent({
      stage: "PLL",
      caseId: input.cfop.pllCaseId,
      execMoves,
      recognitionPauseMs: pauseBeforeMove(input.moveGaps, startMoveIndex),
      startMoveIndex,
      endMoveIndex: startMoveIndex + execMoves,
    }, input.getCaseReference));
  }
  return events.filter((event): event is CaseEvent => event !== null);
}

function buildEvent(partial: {
  stage: CaseEvent["stage"];
  caseId: string;
  execMoves: number;
  recognitionPauseMs: number;
  startMoveIndex?: number;
  endMoveIndex?: number;
}, getCaseReference: CaseEventAssemblyInput["getCaseReference"]): CaseEvent | null {
  const reference = getCaseReference(partial.caseId);
  if (!reference) return null;
  const expectedMoves = reference.moves.length;
  return {
    stage: partial.stage,
    caseId: partial.caseId,
    recognitionPauseMs: partial.recognitionPauseMs,
    execMoves: partial.execMoves,
    expectedMoves,
    moveDelta: partial.execMoves - expectedMoves,
    referenceAlgorithm: { name: reference.name, moves: [...reference.moves] },
    startMoveIndex: partial.startMoveIndex,
    endMoveIndex: partial.endMoveIndex,
  };
}

/** 从打乱 + 解法重建每步后的局面，与 cfop-parser 的 states 口径一致。 */
function rebuildStates(scrambleMoves: string[], solveMoves: string[]): CubieCube[] {
  let cube = CubieCube.SOLVED;
  for (const move of scrambleMoves) cube = cube.applyMove(parseMove(move));
  const states: CubieCube[] = [];
  for (const move of solveMoves) {
    cube = cube.applyMove(parseMove(move));
    states.push(cube);
  }
  return states;
}

/** 从 case 局面（startIndex）起数到满足 done 局面所需的步数；未满足时计到结尾。 */
function countMovesUntil(states: CubieCube[], startIndex: number, done: (state: CubieCube) => boolean): number {
  for (let index = startIndex + 1; index < states.length; index++) {
    if (done(states[index])) return index - startIndex;
  }
  return Math.max(0, states.length - startIndex - 1);
}

function pauseBeforeMove(gaps: number[], moveIndex: number): number {
  if (moveIndex < 0 || moveIndex >= gaps.length) return 0;
  const gap = gaps[moveIndex];
  return Number.isFinite(gap) && gap > 0 ? gap : 0;
}
