/**
 * 解法结束后的可回放数据准备：将局面真值、动作流可信度和 CFOP 衍生数据一次性计算。
 * 调用方只负责获取实体局面与呈现结果，不能重新组合 eligibility 规则。
 */

import { parseCfop, type CfopResult } from "./cfop-parser.ts";
import { analyzeF2lSlots, type F2lSlotAnalysis } from "./f2l-slot-tracker.ts";
import { analyzeSolveSteps, type SolveReview } from "./solve-review.ts";
import { assembleCaseEvents } from "./case-event-assembly.ts";
import type { CaseEvent } from "../../src-shared/analysis-types.ts";
import {
  isMoveStreamReliable,
  resolveSolveTrust,
  type MoveEventForValidation,
  type PhysicalCubeState,
  type SolveTrust,
  type SolveValidation,
  validateSolve,
  withSolveAnomalies,
  type SolveAnomaly,
} from "./solve-validation.ts";

export interface CompletedSolveAnalysisInput {
  scrambleMoves: string[];
  moveEvents: MoveEventForValidation[];
  moveTimes: number[];
  moveGaps: number[];
  solveStartTime: number;
  solveEndTime: number;
  physicalState: PhysicalCubeState;
  /** GAN v4 等无可靠实体回读协议可保留连续动作流计时，但不生成分析。 */
  allowUnverifiedMoveScore?: boolean;
  /** 协议层确认无法恢复的缺步，会让本把退出 CFOP/AI。 */
  externalAnomalies?: SolveAnomaly[];
}

export interface CompletedSolveAnalysis {
  validation: SolveValidation;
  trust: SolveTrust;
  reliableMoveStream: boolean;
  cfopResult: CfopResult | null;
  stepReview?: SolveReview;
  f2lSlotAnalysis?: F2lSlotAnalysis | null;
  /** 本把命中的 case 证据流（未命中任何 case 时保持 undefined）。 */
  caseEvents?: CaseEvent[];
}

/**
 * 动作流不具备分析资格时，严格跳过 CFOP、F2L 与停顿推断，避免生成不可信的零值数据。
 */
export function analyzeCompletedSolve(input: CompletedSolveAnalysisInput): CompletedSolveAnalysis {
  const validation = withSolveAnomalies(
    validateSolve(input.scrambleMoves, input.moveEvents),
    input.externalAnomalies ?? [],
  );
  const trust = resolveSolveTrust(validation, input.physicalState, input.allowUnverifiedMoveScore);
  const reliableMoveStream = isMoveStreamReliable(validation);
  if (!trust.analysisEligible) {
    return { validation, trust, reliableMoveStream, cfopResult: null };
  }

  const moves = input.moveEvents.map((event) => event.move);
  const cfopResult = parseCfop(moves, input.moveTimes, input.scrambleMoves, input.solveStartTime, input.solveEndTime);
  const stepReview = analyzeSolveSteps(moves, input.moveGaps, cfopResult.segments);
  const f2lSlotAnalysis = analyzeF2lSlots(
    input.scrambleMoves,
    moves,
    input.moveTimes,
    input.moveGaps,
    input.solveStartTime,
    stepReview.pauseThreshold,
  );
  const assembledEvents = assembleCaseEvents({
    scrambleMoves: input.scrambleMoves,
    solveMoves: moves,
    moveGaps: input.moveGaps,
    cfop: cfopResult,
    f2lSlots: f2lSlotAnalysis,
  });
  const caseEvents = assembledEvents.length > 0 ? assembledEvents : undefined;
  return { validation, trust, reliableMoveStream, cfopResult, stepReview, f2lSlotAnalysis, caseEvents };
}
