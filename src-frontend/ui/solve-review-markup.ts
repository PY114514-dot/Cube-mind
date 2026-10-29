import type { AnalysisInput, SolveReviewTarget } from "../../src-shared/analysis-types.ts";
import { compareReviewSolve } from "../core/solve-review-session.ts";

type EscapeHtml = (value: string) => string;

export function formatReviewMetric(target: SolveReviewTarget, value: number): string {
  return target.goal.kind === "moves" ? `${value} 步` : `${(value / 1000).toFixed(2)}s`;
}

export function renderReviewComparison(solve: AnalysisInput, escapeHtml: EscapeHtml): string {
  if (!solve.review) return "";
  const result = compareReviewSolve(solve);
  const target = solve.review;
  const label = target.goal.kind === "case-pause" ? `${target.goal.caseId} 起手间隔`
    : target.goal.kind === "duration" ? "复原用时" : target.goal.kind === "pause" ? "最长停顿" : "总步数";
  const change = result.delta === null ? "暂不比较" : result.delta === 0 ? "与原题持平"
    : `${result.delta < 0 ? "减少" : "增加"} ${formatReviewMetric(target, Math.abs(result.delta))}`;
  return `<div class="review-comparison">
    <span>${escapeHtml(label)}</span><strong>${escapeHtml(change)}</strong>
    <p>原题 ${formatReviewMetric(target, target.goal.baseline)} → 本次 ${result.current === null ? "—" : formatReviewMetric(target, result.current)}</p>
    <small>${escapeHtml(result.note)}</small>
  </div>`;
}

export function renderReviewCandidates(targets: SolveReviewTarget[], escapeHtml: EscapeHtml): string {
  if (!targets.length) return '<p class="review-hint">昨天没有可重建的可信常规复原。完成今天的训练，明天会自动选题；也可从历史详情手选原题。</p>';
  return targets.map((target, index) => `<article class="review-entry">
    <span class="review-rank">${index + 1}</span>
    <span class="review-time">${(target.totalDuration / 1000).toFixed(2)}<i>s</i></span>
    <span class="review-tps">${target.moveCount} 步</span>
    <div class="review-insight"><strong>${escapeHtml(target.goal.reason)}</strong>
      <small>${target.completedAt ? escapeHtml(new Date(target.completedAt).toLocaleString()) : "原题实录"}</small></div>
    <button type="button" class="ghost" data-review-start="${index}">重练原题</button>
  </article>`).join("");
}
