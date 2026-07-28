/** 按 CSTimer 的进度下降规则切分 CFOP 阶段。 */

import { CubieCube, parseMove, SOLVED_FACELET } from "../utils/mathlib.ts";
import { getCfopPhase, type CfopPhase } from "./cstimer-cfop.ts";

export type Stage = CfopPhase | "pll" | "incomplete";

export interface StageSegment {
  stage: Stage;
  moves: string[];
  moveIndices: number[];
  startIdx: number;
  endIdx: number;
  duration: number;
  timestamps: number[];
}

export interface CfopResult {
  segments: StageSegment[];
  totalMoves: number;
  isSolved: boolean;
}

function calcDuration(timestamps: number[], startTime?: number, endTime?: number): number {
  if (timestamps.length === 0) return 0;
  return Math.max(0, (endTime ?? timestamps[timestamps.length - 1]) - (startTime ?? timestamps[0]));
}

function getCfopProgress(phase: CfopPhase): number {
  const progress: Record<CfopPhase, number> = {
    scramble: 4,
    cross: 3,
    f2l: 2,
    oll: 1,
    solved: 0,
  };
  return progress[phase];
}

function stageForProgress(progress: number): Stage {
  const stages: Record<number, Stage> = { 3: "cross", 2: "f2l", 1: "oll", 0: "pll" };
  return stages[progress] ?? "incomplete";
}

/**
 * CSTimer 会在每一步后计算 CFOP progress（4→0）。进度第一次下降时，
 * 当前步骤就是阶段终点；后续即使退回，也不会撤销已记录的边界。
 */
export function parseCfop(
  moveStrs: string[],
  moveTimes?: number[],
  scrambleMoves: string[] = [],
  solveStartTime?: number,
  solveEndTime?: number,
): CfopResult {
  const moveCount = moveStrs.length;
  if (moveCount === 0) return { segments: [], totalMoves: 0, isSolved: true };

  const moveIndices = moveStrs.map(parseMove);
  let cube = CubieCube.SOLVED;
  for (const move of scrambleMoves) cube = cube.applyMove(parseMove(move));
  let progress = getCfopProgress(getCfopPhase(cube.toFaceCube()));

  const states: CubieCube[] = [];
  for (const moveIndex of moveIndices) {
    cube = cube.applyMove(moveIndex);
    states.push(cube);
  }

  const segments: StageSegment[] = [];
  let startIdx = 0;
  const buildSegment = (stage: Stage, endIdx: number): void => {
    if (endIdx <= startIdx) return;
    const timestamps = moveTimes?.slice(startIdx, endIdx) ?? [];
    segments.push({
      stage,
      moves: moveStrs.slice(startIdx, endIdx),
      moveIndices: moveIndices.slice(startIdx, endIdx),
      startIdx,
      endIdx,
      duration: calcDuration(
        timestamps,
        startIdx === 0 ? solveStartTime : moveTimes?.[startIdx - 1],
        endIdx === moveCount ? solveEndTime : moveTimes?.[endIdx - 1],
      ),
      timestamps,
    });
    startIdx = endIdx;
  };

  for (let index = 0; index < states.length; index++) {
    const currentProgress = getCfopProgress(getCfopPhase(states[index].toFaceCube()));
    if (currentProgress >= progress) continue;
    while (progress > currentProgress) {
      progress--;
      buildSegment(stageForProgress(progress), index + 1);
    }
  }

  if (startIdx < moveCount) buildSegment("incomplete", moveCount);
  const finalState = states[states.length - 1];
  const isSolved = finalState?.toFaceCube() === SOLVED_FACELET;
  if (isSolved) {
    segments.push({ stage: "solved", moves: [], moveIndices: [], startIdx: moveCount, endIdx: moveCount, duration: 0, timestamps: [] });
  }
  return { segments, totalMoves: moveCount, isSolved };
}

export function formatCfop(result: CfopResult): string {
  const names: Record<Stage, string> = {
    scramble: "Scramble",
    cross: "Cross",
    f2l: "F2L",
    oll: "OLL",
    pll: "PLL",
    incomplete: "未完成",
    solved: "已还原",
  };
  const lines = [`总步数: ${result.totalMoves} | 已还原: ${result.isSolved ? "是" : "否"}`, "─".repeat(60)];
  for (const segment of result.segments) {
    if (segment.stage === "solved") continue;
    lines.push(`${names[segment.stage].padEnd(8)} ${String(segment.moves.length).padStart(2)}步  ${(segment.duration / 1000).toFixed(2).padStart(6)}s  ${segment.moves.length > 0 ? segment.moves.join(" ") : "(空)"}`);
  }
  return lines.join("\n");
}
