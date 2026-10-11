/**
 * 将成绩计分资格、PB 和 AO 反馈集中为纯计算，避免页面分别解释可信度状态。
 */

import type { AnalysisInput } from "../agent/types.ts";
import { resolvePersistedSolveTrust } from "./solve-validation.ts";
import { calculateWcaAverage, getWcaScore } from "./wca-average.ts";
import { canCompareFormulaPractice } from "./practice-effect.ts";

export interface SolveResultFeedback {
  label: string;
  detail: string;
  isPersonalBest: boolean;
}

/** 返回本把成绩的统一反馈；history 应是不包含 current 的同类历史。 */
export function buildSolveResultFeedback(current: AnalysisInput, history: AnalysisInput[]): SolveResultFeedback {
  if (!resolvePersistedSolveTrust(current).scoreEligible) {
    return { label: "本把不计入成绩", detail: "设备数据未通过校验，不参与 PB 和 AO 统计。", isPersonalBest: false };
  }
  if (current.physicalState === "confirmed-solved" && !resolvePersistedSolveTrust(current).analysisEligible) {
    return { label: "实体复原已确认", detail: "本把已计入 PB 和 AO；动作流不完整，已跳过 CFOP 与 AI 分析。", isPersonalBest: false };
  }
  if (current.physicalState === "unavailable" && !resolvePersistedSolveTrust(current).analysisEligible) {
    return { label: "连续动作已计分", detail: "GAN v4 未提供可验证实体局面；本把已计入 PB 和 AO，已跳过 CFOP 与 AI 分析。", isPersonalBest: false };
  }
  if (current.penalty === "dnf") {
    return { label: "DNF", detail: "观察超过 DNF 时限；本把保留在历史中，并按 WCA 规则参与 AO。", isPersonalBest: false };
  }

  const comparable = history.filter((solve) =>
    resolvePersistedSolveTrust(solve).scoreEligible && isPracticeSolve(solve) === isPracticeSolve(current)
      && (!isPracticeSolve(current) || solve.practiceKind === current.practiceKind)
      && (current.practiceKind !== "formula" || canCompareFormulaPractice(current, solve))
  );
  const currentScore = getScore(current);
  const isPersonalBest = comparable.every((solve) => currentScore < getScore(solve));
  const rank = comparable.filter((solve) => getScore(solve) < currentScore).length + 1;
  const ao5 = comparable.length >= 5
    ? calculateWcaAverage(comparable.slice(-5).map((solve) => ({ duration: solve.totalDuration, penalty: solve.penalty }))).value
    : null;
  if (isPersonalBest) {
    return { label: comparable.length === 0 ? "首个有效成绩" : "新的个人最佳", detail: `本组第 ${rank} 快`, isPersonalBest: comparable.length > 0 };
  }
  if (ao5 !== null) {
    const delta = currentScore - ao5;
    const direction = delta < 0 ? "快" : "慢";
    return { label: `较上一组 AO5 ${direction} ${Math.abs(delta / 1000).toFixed(2)}s`, detail: `本组第 ${rank} 快`, isPersonalBest: false };
  }
  return { label: `本组第 ${rank} 快`, detail: `再完成 ${Math.max(0, 4 - comparable.length)} 把解锁 AO5 对比`, isPersonalBest: false };
}

function getScore(solve: AnalysisInput): number {
  return getWcaScore({ duration: solve.totalDuration, penalty: solve.penalty });
}

function isPracticeSolve(solve: AnalysisInput): boolean {
  return Boolean(solve.practiceKind || solve.practiceMode || solve.practiceFormulaId);
}
