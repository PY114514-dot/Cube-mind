/** 将一次完成解法的运行时数据压缩为可持久化成绩记录。 */

import type { AnalysisInput, BlockPracticeMode, CaseAlgorithmReference } from "../../src-shared/analysis-types.ts";
import { isBlockPracticeComplete } from "./block-practice.ts";
import { calculateCrossMetrics } from "./cross-metrics.ts";
import { getCfopPhase } from "./cstimer-cfop.ts";
import type { CompletedSolveAnalysis } from "./completed-solve-analysis.ts";
import type { InspectionPenalty } from "./inspection-rules.ts";
import type { PhysicalCubeState } from "./solve-validation.ts";

export interface CompletedSolveMove {
  move: string;
  timestamp: number;
  gapFromPrev: number;
}

export interface CompletedSolveRecordInput {
  completedAt: number;
  deviceName: string;
  deviceId?: string;
  groupId?: string;
  scrambleMoves: string[];
  moves: CompletedSolveMove[];
  solveStartTime: number;
  solveEndTime: number;
  totalDuration: number;
  physicalState: PhysicalCubeState;
  inspectionDuration?: number;
  penalty: InspectionPenalty;
  analysis: CompletedSolveAnalysis;
  blockPractice?: { mode: BlockPracticeMode; completed: boolean };
  formulaPractice?: { category: "F2L" | "OLL" | "PLL"; formulaId: string; caseVerified: boolean; referenceAlgorithm?: CaseAlgorithmReference };
}

export interface CompletedSolveRecord {
  input: AnalysisInput;
  formulaPracticeSucceeded: boolean;
  blockPracticeSucceeded: boolean;
}

/**
 * 练习结果和成绩字段只能来自同一份 `CompletedSolveAnalysis`，防止 UI 层用不同规则分别判断。
 */
export function buildCompletedSolveRecord(source: CompletedSolveRecordInput): CompletedSolveRecord {
  const { analysis, moves, totalDuration } = source;
  const formulaPracticeSucceeded = isFormulaPracticeSucceeded(source);
  const blockPracticeSucceeded = Boolean(source.blockPractice?.completed && analysis.reliableMoveStream
    && isBlockPracticeComplete(source.blockPractice.mode, analysis.validation.finalFacelets));
  const input: AnalysisInput = {
    completedAt: source.completedAt,
    deviceName: source.deviceName || "未标识魔方",
    deviceId: source.deviceId,
    groupId: source.groupId,
    practiceMode: source.blockPractice?.mode,
    practiceKind: source.formulaPractice ? "formula" : source.blockPractice?.mode,
    practiceFormulaId: source.formulaPractice?.formulaId,
    practiceReferenceAlgorithm: source.formulaPractice?.referenceAlgorithm
      ? { ...source.formulaPractice.referenceAlgorithm, moves: [...source.formulaPractice.referenceAlgorithm.moves] }
      : undefined,
    practiceOutcome: source.formulaPractice
      ? (formulaPracticeSucceeded ? "success" : "failed")
      : source.blockPractice ? (blockPracticeSucceeded ? "success" : "failed") : undefined,
    recognitionDuration: getRecognitionDuration(source),
    executionDuration: getExecutionDuration(source),
    inspectionDuration: source.inspectionDuration,
    ...getCrossPracticeMetrics(source),
    totalDuration,
    moveCount: moves.length,
    tps: totalDuration > 0 ? moves.length / (totalDuration / 1000) : 0,
    scramble: source.scrambleMoves.join(" "),
    moves: moves.map((move) => move.move),
    ...getStageFields(analysis),
    qualityStatus: analysis.validation.status,
    qualityAnomalies: analysis.validation.anomalies,
    physicalState: source.physicalState,
    trustState: analysis.trust.state,
    analysisEligible: analysis.trust.analysisEligible,
    penalty: source.penalty,
    moveGaps: moves.map((move) => move.gapFromPrev),
    f2lSlots: analysis.f2lSlotAnalysis?.slots.map((slot) => ({
      slot: slot.slot,
      completionOrder: slot.completionOrder,
      completedAtMove: slot.completedAtMove,
      duration: slot.duration,
      moves: slot.moves,
      moveSequence: slot.moveSequence,
      pauseCount: slot.pauseCount,
      maxGap: slot.maxGap,
      breakCount: slot.breakCount,
      repairCount: slot.repairCount,
      completedWithCross: slot.completedWithCross,
      caseId: slot.caseId,
      caseFamily: slot.caseFamily,
      caseConfidence: slot.caseConfidence,
      caseReason: slot.caseReason,
    })),
    stepReview: analysis.stepReview,
    caseEvents: analysis.caseEvents,
  };
  return { input, formulaPracticeSucceeded, blockPracticeSucceeded };
}

function isFormulaPracticeSucceeded(source: CompletedSolveRecordInput): boolean {
  const practice = source.formulaPractice;
  if (!practice || !practice.caseVerified || !source.analysis.reliableMoveStream) return false;
  const phase = getCfopPhase(source.analysis.validation.finalFacelets);
  if (practice.category === "F2L") return phase === "f2l" || phase === "oll" || phase === "solved";
  if (practice.category === "OLL") return phase === "oll" || phase === "solved";
  return source.analysis.validation.isSolved;
}

function getRecognitionDuration(source: CompletedSolveRecordInput): number | undefined {
  const firstMove = source.moves[0];
  if (!source.formulaPractice || !firstMove) return undefined;
  return Math.max(0, firstMove.timestamp - source.solveStartTime);
}

function getExecutionDuration(source: CompletedSolveRecordInput): number | undefined {
  const firstMove = source.moves[0];
  if (!source.formulaPractice || !firstMove) return undefined;
  return Math.max(0, source.solveEndTime - firstMove.timestamp);
}

function getCrossPracticeMetrics(source: CompletedSolveRecordInput): Pick<AnalysisInput, "crossPracticeSteps" | "crossPracticePauses" | "crossPracticeTps"> {
  if (source.blockPractice?.mode !== "cross") return {};
  const metrics = calculateCrossMetrics(source.moves, source.totalDuration);
  return { crossPracticeSteps: metrics.steps, crossPracticePauses: metrics.pauses, crossPracticeTps: metrics.tps };
}

function getStageFields(analysis: CompletedSolveAnalysis): Pick<AnalysisInput, "crossDuration" | "f2lDuration" | "ollDuration" | "pllDuration" | "crossMoves" | "f2lMoves" | "ollMoves" | "pllMoves"> {
  const stage = (name: "cross" | "f2l" | "oll" | "pll") => analysis.cfopResult?.segments.find((segment) => segment.stage === name);
  const cross = stage("cross");
  const f2l = stage("f2l");
  const oll = stage("oll");
  const pll = stage("pll");
  return {
    crossDuration: cross?.duration ?? 0,
    f2lDuration: f2l?.duration ?? 0,
    ollDuration: oll?.duration ?? 0,
    pllDuration: pll?.duration ?? 0,
    crossMoves: cross?.moves.length ?? 0,
    f2lMoves: f2l?.moves.length ?? 0,
    ollMoves: oll?.moves.length ?? 0,
    pllMoves: pll?.moves.length ?? 0,
  };
}
