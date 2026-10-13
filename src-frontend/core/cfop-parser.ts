/** 按 CSTimer 的进度下降规则切分 CFOP 阶段。 */

import { CubieCube, parseMove, SOLVED_FACELET } from "../utils/mathlib.ts";
import { getCfopPhase, type CfopPhase } from "./cstimer-cfop.ts";
import { formatMovesForWhiteBottom, normalizeCubeForD } from "./solve-notation.ts";
import {
  isCubeSolved,
  isF2lComplete,
  isOllComplete,
  recognizeOllCaseFromCube,
  recognizePllCaseFromCube,
} from "./last-layer-recognizer.ts";

export type Stage = CfopPhase | "pll" | "incomplete";

export interface StageSegment {
  stage: Stage;
  moves: string[];
  moveIndices: number[];
  startIdx: number;
  endIdx: number;
  duration: number;
  timestamps: number[];
  /** 该阶段被跳过（如 OLL skip），无实际 move */
  skipped?: boolean;
}

export interface CfopResult {
  segments: StageSegment[];
  totalMoves: number;
  isSolved: boolean;
  /** OLL 阶段起点（首个 F2L 严格完成且顶层未朝向的局面）命中的公式编号；未命中保持 undefined。 */
  ollCaseId?: string;
  /** PLL 阶段起点（首个 F2L 与顶层朝向均完成且未还原的局面）命中的公式编号；未命中保持 undefined。 */
  pllCaseId?: string;
  /** 严格 F2L 完成时确认的底层，供 CASE 识别与事件终点使用同一坐标。 */
  caseTargetFace?: "U" | "D";
  /** OLL case 首次出现的局面索引（第几步之后，-1 表示首步前）；供事件组装对齐停顿与步数。 */
  ollCaseStartIndex?: number;
  /** PLL case 首次出现的局面索引（第几步之后，-1 表示首步前）；供事件组装对齐停顿与步数。 */
  pllCaseStartIndex?: number;
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
  const initialState = cube;
  let progress = getCfopProgress(getCfopPhase(cube.toFaceCube()));

  const states: CubieCube[] = [];
  for (const moveIndex of moveIndices) {
    cube = cube.applyMove(moveIndex);
    states.push(cube);
  }

  const segments: StageSegment[] = [];
  let startIdx = 0;
  const buildSegment = (stage: Stage, endIdx: number): void => {
    // 阶段被跳过（如 OLL skip）：生成零长度标记 segment
    if (endIdx <= startIdx) {
      segments.push({
        stage, moves: [], moveIndices: [], startIdx, endIdx: startIdx,
        duration: 0, timestamps: [], skipped: true,
      });
      return;
    }
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
  return { segments, totalMoves: moveCount, isSolved, ...matchCaseIds(initialState, states) };
}

/**
 * 实战 case 编号接线：包含首步前的局面，不依赖 CSTimer 形状掩码的分段边界。
 * 掩码在轴旋转下会提前判定 F2L 完成，因此用严格的 U/D 底层 F2L 校验；
 * 未命中的局面保持 undefined，保证绝不误报。起始索引只在真正命中编号时记录。
 */
function matchCaseIds(initialState: CubieCube, states: CubieCube[]): {
  caseTargetFace?: "U" | "D";
  ollCaseId?: string;
  ollCaseStartIndex?: number;
  pllCaseId?: string;
  pllCaseStartIndex?: number;
} {
  let caseTargetFace: "U" | "D" | undefined;
  let ollCaseId: string | undefined;
  let ollCaseStartIndex: number | undefined;
  let pllCaseId: string | undefined;
  let pllCaseStartIndex: number | undefined;
  for (let index = -1; index < states.length; index++) {
    const original = index === -1 ? initialState : states[index];
    const targetFace = caseTargetFace ?? (isF2lComplete(original) ? "D" : "U");
    const state = normalizeCubeForD(original, targetFace);
    if (!isF2lComplete(state) || isCubeSolved(state)) continue;
    // 只看十字会把四条顶棱已朝向的 OLL/PLL 误当另一底层；严格 F2L 才能确认。
    caseTargetFace = targetFace;
    if (ollCaseId === undefined && !isOllComplete(state)) {
      const match = recognizeOllCaseFromCube(state);
      if (match) {
        ollCaseId = match.formulaId;
        ollCaseStartIndex = index;
      }
    }
    if (pllCaseId === undefined && isOllComplete(state)) {
      const match = recognizePllCaseFromCube(state);
      if (match) {
        pllCaseId = match.formulaId;
        pllCaseStartIndex = index;
      }
    }
    if (ollCaseId !== undefined && pllCaseId !== undefined) break;
  }
  return { caseTargetFace, ollCaseId, ollCaseStartIndex, pllCaseId, pllCaseStartIndex };
}

export function formatCfop(result: CfopResult, targetFace: "U" | "D"): string {
  const names: Record<Stage, string> = {
    scramble: "Scramble",
    cross: "Cross",
    f2l: "F2L",
    oll: "OLL",
    pll: "PLL",
    incomplete: "未完成",
    solved: "已还原",
  };
  const notation = targetFace === "U" ? "白底记谱（白下黄上）" : "底层记谱";
  const lines = [notation, `总步数: ${result.totalMoves} | 已还原: ${result.isSolved ? "是" : "否"}`, "─".repeat(60)];
  for (const segment of result.segments) {
    if (segment.stage === "solved") continue;
    const displayMoves = formatMovesForWhiteBottom(segment.moves, targetFace);
    lines.push(`${names[segment.stage].padEnd(8)} ${String(segment.moves.length).padStart(2)}步  ${displayMoves.length > 0 ? displayMoves.join(" ") : "(空)"}`);
  }
  return lines.join("\n");
}
