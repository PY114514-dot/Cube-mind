/**
 * 校验一把成绩是否真的从当前打乱还原到标准状态。
 * 这里把校验放在核心层，避免 UI 的 3D 状态成为唯一事实来源。
 */

import { CubieCube, parseMove, SOLVED_FACELET } from "../utils/mathlib.ts";
import type { AnalysisInput } from "../../src-shared/analysis-types.ts";

export const SolveStatus = {
  Valid: "valid",
  Incomplete: "incomplete",
  Invalid: "invalid",
} as const;

export type SolveStatus = typeof SolveStatus[keyof typeof SolveStatus];
export type SolveAnomaly = "empty-solution" | "invalid-move" | "not-solved" | "duplicate-event" | "out-of-order-event" | "missing-event";
export type PhysicalCubeState = "confirmed-solved" | "confirmed-unsolved" | "unavailable";

export const SolveTrustState = {
  AnalysisReady: "analysis-ready",
  ScoreOnly: "score-only",
  Rejected: "rejected",
} as const;

export type SolveTrustState = typeof SolveTrustState[keyof typeof SolveTrustState];

/** 计时结束后的统一可信度结论；消费者不再自行组合实体状态与动作流异常。 */
export interface SolveTrust {
  state: SolveTrustState;
  scoreEligible: boolean;
  analysisEligible: boolean;
}

export interface PersistedSolveTrustInput {
  physicalState?: PhysicalCubeState;
  qualityStatus?: SolveStatus;
  analysisEligible?: boolean;
  trustState?: SolveTrustState;
}

export interface MoveEventForValidation {
  move: string;
  moveCnt?: number;
  timestamp?: number;
}

/** GAN v2 / 魔域历史包使用无符号 16 位设备时钟，跨 0 回绕不应被当成乱序。 */
function isTimestampWrap(previous: number, current: number): boolean {
  if (current >= previous) return false;
  const modulus = previous <= 0xffff && current <= 0xffff ? 0x10000 : 0x1_0000_0000;
  return previous - current > modulus / 2;
}

export interface SolveValidation {
  status: SolveStatus;
  isSolved: boolean;
  anomalies: SolveAnomaly[];
  finalFacelets: string;
}

/** 将驱动已确认的缺口并入回放校验，保持实体计分与分析资格的既有分层。 */
export function withSolveAnomalies(validation: SolveValidation, anomalies: SolveAnomaly[]): SolveValidation {
  const merged = [...new Set([...validation.anomalies, ...anomalies])];
  const streamAnomaly = merged.some((anomaly) =>
    anomaly === "invalid-move" || anomaly === "duplicate-event" || anomaly === "out-of-order-event" || anomaly === "missing-event"
  );
  return { ...validation, anomalies: merged, status: streamAnomaly ? SolveStatus.Invalid : validation.status };
}

/** Move 流可被可靠回放；阶段专项允许未完整复原，但不接受丢步、重复或乱序。 */
export function isMoveStreamReliable(validation: SolveValidation): boolean {
  return !validation.anomalies.some((anomaly) =>
    anomaly === "invalid-move" || anomaly === "duplicate-event" || anomaly === "out-of-order-event" || anomaly === "missing-event"
  );
}

/**
 * 实体局面是成绩真值，动作流完整性是分析真值。二者冲突时保留成绩、隔离分析。
 */
export function resolveSolveTrust(validation: SolveValidation, physicalState: PhysicalCubeState, allowUnverifiedMoveScore = false): SolveTrust {
  if (physicalState === "confirmed-unsolved") {
    return { state: SolveTrustState.Rejected, scoreEligible: false, analysisEligible: false };
  }
  if (validation.isSolved && isMoveStreamReliable(validation)) {
    return { state: SolveTrustState.AnalysisReady, scoreEligible: true, analysisEligible: true };
  }
  if (physicalState === "confirmed-solved") {
    return { state: SolveTrustState.ScoreOnly, scoreEligible: true, analysisEligible: false };
  }
  // GAN v4 无可靠 54 位回读时遵循智能计时器惯例：连续动作可保留计时，
  // 但只要无法闭合页面打乱，就绝不据此生成 CFOP 或 AI 结论。
  if (physicalState === "unavailable" && allowUnverifiedMoveScore && isMoveStreamReliable(validation)
    && validation.anomalies.length > 0 && validation.anomalies.every((anomaly) => anomaly === "not-solved")) {
    return { state: SolveTrustState.ScoreOnly, scoreEligible: true, analysisEligible: false };
  }
  return { state: SolveTrustState.Rejected, scoreEligible: false, analysisEligible: false };
}

/** 为历史记录提供同一可信度 Interface，并兼容 M6 前未保存 trustState 的旧数据。 */
export function resolvePersistedSolveTrust(input: PersistedSolveTrustInput): SolveTrust {
  if (input.trustState === SolveTrustState.AnalysisReady) return { state: input.trustState, scoreEligible: true, analysisEligible: true };
  if (input.trustState === SolveTrustState.ScoreOnly) return { state: input.trustState, scoreEligible: true, analysisEligible: false };
  if (input.trustState === SolveTrustState.Rejected) return { state: input.trustState, scoreEligible: false, analysisEligible: false };
  if (input.physicalState === "confirmed-unsolved") return { state: SolveTrustState.Rejected, scoreEligible: false, analysisEligible: false };
  if (input.analysisEligible ?? isSolveEligible(input.qualityStatus)) {
    return { state: SolveTrustState.AnalysisReady, scoreEligible: true, analysisEligible: true };
  }
  if (input.physicalState === "confirmed-solved") return { state: SolveTrustState.ScoreOnly, scoreEligible: true, analysisEligible: false };
  return { state: SolveTrustState.Rejected, scoreEligible: false, analysisEligible: false };
}

function applyMoves(cube: CubieCube, moves: string[]): CubieCube {
  let state = cube;
  for (const move of moves) state = state.applyMove(parseMove(move));
  return state;
}

function findEventAnomalies(events: MoveEventForValidation[]): SolveAnomaly[] {
  const anomalies: SolveAnomaly[] = [];
  const seen = new Set<number>();
  let previousTimestamp: number | undefined;
  let previousMoveCnt: number | undefined;
  for (const event of events) {
    if (event.moveCnt !== undefined) {
      if (seen.has(event.moveCnt)) anomalies.push("duplicate-event");
      if (previousMoveCnt !== undefined && ((event.moveCnt - previousMoveCnt + 256) & 0xff) !== 1) {
        anomalies.push("missing-event");
      }
      seen.add(event.moveCnt);
      previousMoveCnt = event.moveCnt;
    }
    if (event.timestamp !== undefined && previousTimestamp !== undefined
      && event.timestamp < previousTimestamp && !isTimestampWrap(previousTimestamp, event.timestamp)) {
      anomalies.push("out-of-order-event");
    }
    previousTimestamp = event.timestamp;
  }
  return anomalies;
}

export function validateSolve(
  scrambleMoves: string[],
  solutionEvents: MoveEventForValidation[],
): SolveValidation {
  const anomalies = findEventAnomalies(solutionEvents);
  if (solutionEvents.length === 0) anomalies.push("empty-solution");

  let finalFacelets = SOLVED_FACELET;
  try {
    const scrambled = applyMoves(CubieCube.SOLVED, scrambleMoves);
    finalFacelets = applyMoves(scrambled, solutionEvents.map((event) => event.move)).toFaceCube();
  } catch (error) {
    console.error("[solve-validation] 无法回放解法动作:", error);
    anomalies.push("invalid-move");
  }

  const isSolved = finalFacelets === SOLVED_FACELET;
  if (!isSolved && !anomalies.includes("invalid-move")) anomalies.push("not-solved");
  const streamAnomaly = anomalies.some((anomaly) =>
    anomaly === "invalid-move" || anomaly === "duplicate-event" || anomaly === "out-of-order-event" || anomaly === "missing-event"
  );
  const status: SolveStatus = anomalies.length === 0
    ? SolveStatus.Valid
    : streamAnomaly
      ? SolveStatus.Invalid
      : SolveStatus.Incomplete;

  return { status, isSolved, anomalies: [...new Set(anomalies)], finalFacelets };
}

export function isSolveEligible(status: SolveStatus | undefined): boolean {
  return status === undefined || status === SolveStatus.Valid;
}

/**
 * PB/AO 以设备回读的实体状态为最高优先级；动作流完整性只决定能否做 CFOP/AI。
 * 旧历史没有实体回读字段时，保持原有 qualityStatus 规则。
 */
export function isScoreEligible(
  physicalState: "confirmed-solved" | "confirmed-unsolved" | "unavailable" | undefined,
  qualityStatus: SolveStatus | undefined,
): boolean {
  if (physicalState === "confirmed-solved") return true;
  if (physicalState === "confirmed-unsolved") return false;
  return isSolveEligible(qualityStatus);
}

/** 仅完整、可回放的动作流可以产生 CFOP 阶段、停顿和 Agent 建议。 */
export function isAnalysisEligible(
  analysisEligible: boolean | undefined,
  qualityStatus: SolveStatus | undefined,
): boolean {
  return analysisEligible ?? isSolveEligible(qualityStatus);
}

/** 复盘窗口与训练回流共用常规成绩资格，专项及被拒绝的记录不能成为实战证据。 */
export function isNormalAnalysisEligible(solve: AnalysisInput): boolean {
  return solve.practiceKind === undefined && solve.practiceMode === undefined
    && resolvePersistedSolveTrust(solve).analysisEligible;
}
