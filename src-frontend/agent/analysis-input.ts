import type { AnalysisInput } from "./types.ts";
import { isNormalAnalysisEligible } from "../core/solve-validation.ts";
import { buildAnalysisBaseline, MAX_ANALYSIS_SOLVES, toAnalysisSolve } from "../../src-shared/analysis-coaching.ts";

export function getAnalysisEligibleSolves(records: AnalysisInput[]): AnalysisInput[] {
  return records.filter(isNormalAnalysisEligible);
}

export function createHistoryAnalysisInput(records: AnalysisInput[], scope: number): AnalysisInput | null {
  const eligible = getAnalysisEligibleSolves(records);
  const count = Math.max(1, Math.min(MAX_ANALYSIS_SOLVES, Math.floor(scope) || 1));
  const solves = eligible.slice(-count).map(toAnalysisSolve);
  if (solves.length === 0) return null;
  const latestSolve = solves[solves.length - 1];
  const previous = eligible.slice(0, -solves.length).slice(-MAX_ANALYSIS_SOLVES).map(toAnalysisSolve);
  return {
    analysisScope: solves.length,
    // 顶层始终是一把真实成绩；多把统计从完整样本计算，避免均值与局部动作混用。
    ...latestSolve,
    analysisSolves: solves,
    baseline: previous.length >= 3 ? buildAnalysisBaseline(previous) : undefined,
  };
}
