/** 将一把成绩转换为结果区可渲染的纯展示模型。 */

import type { AnalysisInput } from "../agent/types.ts";
import { presentSolveQuality } from "./data-quality.ts";
import { buildSolveResultFeedback } from "./solve-result-feedback.ts";
import { resolvePersistedSolveTrust } from "./solve-validation.ts";
import type { SolveReview } from "./solve-review.ts";
import { formatWcaSolveTime } from "./wca-average.ts";

export interface SolveResultMetric {
  label: string;
  value: string;
  delta: string;
}

export interface SolveResultAction {
  kind: "practice" | "rejected" | "score-only";
  label: string;
  title: string;
  detail: string;
}

export interface SolveResultView {
  time: string;
  showSecondsUnit: boolean;
  feedback: ReturnType<typeof buildSolveResultFeedback>;
  metrics: SolveResultMetric[];
  action?: SolveResultAction;
}

export interface StepReviewPresentation {
  averageGap: string;
  maxGap: string;
  pauses: Array<{ index: number; move: string; stage: string; gap: string }>;
}

/** 统一呈现可信度、成绩反馈、指标差值与专项结果，DOM 层无需再判断状态。 */
export function buildSolveResultView(current: AnalysisInput, previous: AnalysisInput | undefined, history: AnalysisInput[]): SolveResultView {
  const trust = resolvePersistedSolveTrust(current);
  const metrics = buildMetrics(current, previous, trust.analysisEligible);
  return {
    time: formatWcaSolveTime({ duration: current.totalDuration, penalty: current.penalty }),
    showSecondsUnit: current.penalty !== "dnf",
    feedback: buildSolveResultFeedback(current, history),
    metrics,
    action: buildAction(current, trust.scoreEligible, trust.analysisEligible),
  };
}

export function buildStepReviewPresentation(review: SolveReview): StepReviewPresentation | null {
  if (review.pauses.length === 0) return null;
  return {
    averageGap: formatSeconds(review.averageGap),
    maxGap: formatSeconds(review.maxGap),
    pauses: review.pauses.map((pause) => ({
      index: pause.index + 1,
      move: pause.move,
      stage: pause.stage,
      gap: formatSeconds(pause.gap),
    })),
  };
}

function buildMetrics(current: AnalysisInput, previous: AnalysisInput | undefined, analysisEligible: boolean): SolveResultMetric[] {
  const base = [
    metric("观察", current.inspectionDuration ?? 0, previous?.inspectionDuration, "s", current.inspectionDuration ? formatSeconds(current.inspectionDuration) : "—"),
    metric("TPS", current.tps ?? 0, previous?.tps, "", (current.tps ?? 0).toFixed(2)),
  ];
  if (!analysisEligible) return base;
  return base.concat([
    metric("Cross", current.crossDuration, previous?.crossDuration, "s", formatSeconds(current.crossDuration)),
    metric("F2L", current.f2lDuration, previous?.f2lDuration, "s", formatSeconds(current.f2lDuration)),
    metric("OLL", current.ollDuration, previous?.ollDuration, "s", formatSeconds(current.ollDuration)),
    metric("PLL", current.pllDuration, previous?.pllDuration, "s", formatSeconds(current.pllDuration)),
  ]);
}

function metric(label: string, current: number, previous: number | undefined, unit: "s" | "", value: string): SolveResultMetric {
  return { label, value, delta: previous === undefined ? "" : formatDelta(current, previous, unit) };
}

function buildAction(current: AnalysisInput, scoreEligible: boolean, analysisEligible: boolean): SolveResultAction | undefined {
  const practiceAction = getPracticeAction(current);
  if (practiceAction) return practiceAction;
  if (!scoreEligible) {
    const quality = presentSolveQuality(current.qualityStatus, current.qualityAnomalies);
    return { kind: "rejected", label: "本把不计入成绩", title: quality.label, detail: `${quality.description} 请重新生成打乱并从提示的第一步开始执行。` };
  }
  if (!analysisEligible) {
    const detail = current.physicalState === "unavailable"
      ? "GAN v4 未提供可验证实体局面；连续动作已保留为成绩，但不会进入 CFOP 或 AI 训练样本。"
      : "实体复原已确认；为避免错误建议，本把不拆分 CFOP，也不会进入 AI 训练样本。";
    return { kind: "score-only", label: "本把已计分", title: "等待 BLE 动作流诊断", detail };
  }
  return undefined;
}

function getPracticeAction(current: AnalysisInput): SolveResultAction | undefined {
  if (!current.practiceKind) return undefined;
  const success = current.practiceOutcome === "success";
  const detail = current.practiceKind === "formula"
    ? `识别 ${formatSeconds(current.recognitionDuration ?? 0)} · 执行 ${formatSeconds(current.executionDuration ?? 0)}`
    : `本次用时 ${formatSeconds(current.totalDuration)}`;
  return {
    kind: "practice",
    label: `专项练习${current.practiceFormulaId ? ` · ${current.practiceFormulaId}` : ""}`,
    title: success ? "本 CASE 完成" : "本 CASE 需要重做",
    detail: `${detail}。${success ? "下一个 CASE 已准备好，完成打乱后转动第一步开始。" : "使用「重新开始本次」保持同一 CASE，先确认识别再执行。"}`,
  };
}

function formatDelta(current: number, previous: number, unit: "s" | ""): string {
  const delta = (current - previous) / (unit === "s" ? 1000 : 1);
  return `(${delta >= 0 ? "+" : ""}${delta.toFixed(2)}${unit})`;
}

function formatSeconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(2)}s`;
}
