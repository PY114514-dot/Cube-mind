/**
 * CASE 训练迁移验证：专项完成后，观察之后最多三十把常规复原里同一 CASE 的表现。
 * 只消费已可信的实战 caseEvents；训练把和其他专项把不混入，避免把刷题成绩当实战进步。
 */

import type { AnalysisInput, CaseEvent, CaseTransferMetrics, CaseTransferProgress } from "../../src-shared/analysis-types.ts";
import { hasSameCaseReference } from "../../src-shared/analysis-coaching.ts";
import type { FormulaAssignment } from "./assignment-progress.ts";
import { isNormalAnalysisEligible } from "./solve-validation.ts";

const TRANSFER_SAMPLE_SIZE = 30;
const MIN_CASE_HITS = 3;

function isNormalAnalysisReady(solve: AnalysisInput): boolean {
  return isNormalAnalysisEligible(solve) && typeof solve.completedAt === "number";
}

function takeNearest(solves: AnalysisInput[], limit: number, newestFirst: boolean): AnalysisInput[] {
  const ordered = [...solves].sort((left, right) => (left.completedAt ?? 0) - (right.completedAt ?? 0));
  return newestFirst ? ordered.slice(-limit) : ordered.slice(0, limit);
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;
}

function caseEventsFor(solves: AnalysisInput[], formulaId: string): CaseEvent[] {
  return solves.flatMap((solve) =>
    (solve.caseEvents ?? []).filter((event) => event.caseId === formulaId));
}

function metricsFor(events: CaseEvent[]): CaseTransferMetrics {
  return {
    caseHits: events.length,
    averageRecognitionPauseMs: average(events.map((event) => event.recognitionPauseMs)),
    averageMoveDelta: average(events.map((event) => event.moveDelta)),
  };
}

/** 已完成专项的指派按训练前/后各最多三十把常规复原进行比较。 */
export function buildCaseTransferProgress(
  assignments: FormulaAssignment[],
  solves: AnalysisInput[],
  sampleSize = TRANSFER_SAMPLE_SIZE,
): CaseTransferProgress[] {
  return assignments.flatMap((assignment) => {
    if (assignment.trainedAt === undefined) return [];
    const normal = solves.filter(isNormalAnalysisReady);
    const before = takeNearest(normal.filter((solve) => (solve.completedAt ?? 0) < assignment.trainedAt!), sampleSize, true);
    const after = takeNearest(normal.filter((solve) => (solve.completedAt ?? 0) >= assignment.trainedAt!), sampleSize, false);
    const beforeEvents = caseEventsFor(before, assignment.formulaId);
    const afterEvents = caseEventsFor(after, assignment.formulaId);
    const beforeMetrics = metricsFor(beforeEvents);
    const afterMetrics = metricsFor(afterEvents);
    // 换成更长的参照也会让步数差下降，不能把更换手法当成训练进步。
    if (!hasSameCaseReference([...beforeEvents, ...afterEvents])) {
      beforeMetrics.averageMoveDelta = null;
      afterMetrics.averageMoveDelta = null;
    }
    return [{
      formulaId: assignment.formulaId,
      stage: assignment.stage,
      normalSolveCount: after.length,
      targetSolveCount: sampleSize,
      before: beforeMetrics,
      after: afterMetrics,
      readyForComparison: beforeMetrics.caseHits >= MIN_CASE_HITS && afterMetrics.caseHits >= MIN_CASE_HITS,
    }];
  });
}
