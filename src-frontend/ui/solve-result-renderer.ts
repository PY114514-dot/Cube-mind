/** 成绩结果区 DOM 渲染：只消费核心层提供的展示模型，不重新判断成绩资格。 */

import type { AnalysisInput } from "../agent/types.ts";
import { buildSolveResultView, buildStepReviewPresentation } from "../core/solve-result-view.ts";
import { canCompareFormulaPractice } from "../core/practice-effect.ts";
import type { SolveReview } from "../core/solve-review.ts";
import type { FormulaPracticeCategory } from "./solve-timeline.ts";

export interface SolveResultRenderElements {
  summary: HtmlTarget;
  nextAction: HtmlTarget;
  agentOutput: HtmlTarget;
}

interface HtmlTarget {
  innerHTML: string;
}

export function renderSolveSummary(
  elements: SolveResultRenderElements,
  current: AnalysisInput,
  previous: AnalysisInput | undefined,
  history: AnalysisInput[],
  practiceCategory?: FormulaPracticeCategory,
): void {
  const view = buildSolveResultView(current, previous, history);
  const metrics = practiceCategory ? buildPracticeMetrics(current, previous, practiceCategory) : view.metrics;
  const metricMarkup = metrics.map((metric) =>
    `<div><span>${metric.label}</span><strong>${metric.value}</strong><em>${metric.delta}</em></div>`
  ).join("");
  elements.summary.innerHTML = `
    <section class="solve-result-hero${view.feedback.isPersonalBest ? " is-personal-best" : ""}" aria-live="polite">
      <span>本把成绩</span>
      <strong><span class="solve-result-time">${view.time}</span>${view.showSecondsUnit ? "<small>s</small>" : ""}</strong>
      <p><b>${view.feedback.label}</b>${view.feedback.detail ? ` · ${view.feedback.detail}` : ""}</p>
    </section>
    <div class="solve-stage-metrics">${metricMarkup}</div>
  `;
  elements.nextAction.innerHTML = view.action ? `
    <div class="result-action-card">
      <span>${escapeHtml(view.action.label)}</span>
      <strong>${escapeHtml(view.action.title)}</strong>
      <p>${escapeHtml(view.action.detail)}</p>
    </div>
  ` : "";
}

function buildPracticeMetrics(
  current: AnalysisInput,
  previous: AnalysisInput | undefined,
  category: FormulaPracticeCategory,
): { label: string; value: string; delta: string }[] {
  previous = canCompareFormulaPractice(current, previous) ? previous : undefined;
  const stageDuration = category === "F2L" ? current.f2lDuration : category === "OLL" ? current.ollDuration : current.pllDuration;
  const previousStageDuration = category === "F2L" ? previous?.f2lDuration : category === "OLL" ? previous?.ollDuration : previous?.pllDuration;
  return [
    practiceMetric("识别", current.recognitionDuration ?? 0, previous?.recognitionDuration),
    practiceMetric("执行", current.executionDuration ?? stageDuration, previous?.executionDuration ?? previousStageDuration),
    practiceMetric(category, stageDuration, previousStageDuration),
  ];
}

function practiceMetric(label: string, value: number, previous: number | undefined): { label: string; value: string; delta: string } {
  const delta = previous === undefined ? "" : `(${((value - previous) / 1000 >= 0 ? "+" : "")}${((value - previous) / 1000).toFixed(2)}s)`;
  return { label, value: `${(value / 1000).toFixed(2)}s`, delta };
}

export function renderStepReview(elements: SolveResultRenderElements, review: SolveReview | undefined, practiceCategory?: FormulaPracticeCategory): void {
  if (!review) {
    elements.agentOutput.innerHTML = '<p class="placeholder">实体已确认复原；动作流不完整，本把仅保留成绩和 BLE 诊断，不生成复盘建议。</p>';
    return;
  }
  const scopedReview = practiceCategory
    ? { ...review, pauses: review.pauses.filter((pause) => pause.stage === practiceCategory.toLowerCase()) }
    : review;
  const presentation = buildStepReviewPresentation(scopedReview);
  if (!presentation) {
    elements.agentOutput.innerHTML = '<p class="placeholder">本次没有发现明显长停顿，继续保持节奏。</p>';
    return;
  }
  const pauses = presentation.pauses.map((pause) =>
    `<li><strong>#${pause.index} ${escapeHtml(pause.move)}</strong> · ${escapeHtml(pause.stage)} · 间隔 ${pause.gap}</li>`
  ).join("");
  elements.agentOutput.innerHTML = `
    <div class="analysis-card">
      <div class="analysis-item bottleneck">
        <div class="label">逐步复盘：长停顿</div>
        <div class="value">平均间隔 ${presentation.averageGap}，最长 ${presentation.maxGap}</div>
      </div>
      <div class="analysis-item advice"><ul>${pauses}</ul></div>
      <p class="placeholder">点击右下角 AI，可基于这些停顿和最近历史生成训练建议。</p>
    </div>
  `;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;");
}
