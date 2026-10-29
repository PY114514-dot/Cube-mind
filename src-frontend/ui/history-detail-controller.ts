import type { AnalysisInput } from "../agent/types.ts";
import { presentSolveQuality } from "../core/data-quality.ts";
import { formatWcaSolveTime } from "../core/wca-average.ts";
import { SolveReplayPlayer } from "./solve-replay-player.ts";
import { formatMovesForWhiteBottom, getSolveTargetFace } from "../core/solve-notation.ts";
import { renderSolveTimeline } from "./solve-timeline.ts";
import { canReviewSolve } from "../core/solve-review-session.ts";
import { renderReviewComparison } from "./solve-review-markup.ts";
import { F2lSolutionPanel } from "./f2l-solution-panel.ts";
import type { F2lSolutionReview } from "../../src-shared/analysis-types.ts";
import { formatInspectionDuration } from "../core/solve-result-view.ts";

export interface HistoryDetailElements {
  detail: HTMLDivElement;
  retryButton: HTMLButtonElement;
  solutionButton: HTMLButtonElement;
}

/** 历史详情与 3D 回放的 UI 生命周期，避免主入口持有播放器状态。 */
export class HistoryDetailController {
  private replayPlayer: SolveReplayPlayer | null = null;
  private f2lPanel: F2lSolutionPanel | null = null;

  constructor(
    private readonly elements: HistoryDetailElements,
    private readonly getF2lSolutions?: (solve: AnalysisInput) => F2lSolutionReview[],
  ) {}

  render(solve: AnalysisInput, showSolution: boolean): void {
    this.close();
    const scramble = solve.scramble || "旧记录未保存打乱";
    const targetFace = getSolveTargetFace(solve.scramble, solve.moves);
    const solution = showSolution
      ? (solve.moves && targetFace ? formatMovesForWhiteBottom(solve.moves, targetFace).join(" ") : solve.moves?.join(" ")) || "未保存解法序列"
      : "点击\"查看解法\"显示本次还原步骤。";
    const showReplay = Boolean(showSolution && solve.scramble && solve.moves?.length);
    const quality = presentSolveQuality(solve.qualityStatus, solve.qualityAnomalies);
    if (solve.practiceKind === "review") quality.description = "原题复习单独保存，不计入常规 PB、AO 或 AI 实战基准。";
    this.elements.detail.innerHTML = `
      <div class="history-detail-grid">
        <div><span>成绩</span><strong>${formatWcaSolveTime({ duration: solve.totalDuration, penalty: solve.penalty })}${solve.penalty === "dnf" ? "" : "s"}</strong></div>
        <div><span>观察用时</span><strong>${formatInspectionDuration(solve.inspectionDuration)}</strong></div>
        <div><span>TPS</span><strong>${solve.tps?.toFixed(2) ?? "—"}</strong></div>
      </div>
      ${showReplay ? "" : '<div data-history-timeline></div>'}
      ${renderReviewComparison(solve, escapeHtml)}
      <div data-f2l-solutions></div>
      <div class="history-sequence"><span>数据可信度</span><strong>${escapeHtml(quality.label)}</strong><code>${escapeHtml(quality.description)}</code></div>
      <div class="history-sequence"><span>打乱</span><code>${escapeHtml(scramble)}</code></div>
      <div class="history-sequence"><span>解法${targetFace === "U" ? " · 白底记谱" : " · 原始记谱"}</span><code>${escapeHtml(solution)}</code></div>
      ${showReplay ? '<div class="history-replay" data-history-replay></div>' : ""}
    `;
    const timeline = this.elements.detail.querySelector<HTMLElement>("[data-history-timeline]");
    const f2lRoot = this.elements.detail.querySelector<HTMLElement>("[data-f2l-solutions]");
    if (f2lRoot) {
      this.f2lPanel = new F2lSolutionPanel(f2lRoot, escapeHtml);
      this.f2lPanel.render({ ...solve, f2lSolutions: this.getF2lSolutions?.(solve) ?? solve.f2lSolutions });
    }
    if (timeline) renderSolveTimeline(timeline, solve);
    const replayRoot = this.elements.detail.querySelector<HTMLElement>("[data-history-replay]");
    if (replayRoot && solve.moves) this.replayPlayer = new SolveReplayPlayer(replayRoot, solve);
    this.elements.retryButton.disabled = !canReviewSolve(solve);
    this.elements.retryButton.textContent = "重练原题";
    this.elements.solutionButton.disabled = !solve.moves || solve.moves.length === 0;
  }

  close(): void {
    this.f2lPanel?.destroy();
    this.f2lPanel = null;
    this.replayPlayer?.destroy();
    this.replayPlayer = null;
  }
}

function escapeHtml(value: string): string {
  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}
