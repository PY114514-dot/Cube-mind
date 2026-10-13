import type { AnalysisInput } from "../agent/types.ts";
import { presentSolveQuality } from "../core/data-quality.ts";
import { formatWcaSolveTime } from "../core/wca-average.ts";
import { SolveReplayPlayer } from "./solve-replay-player.ts";
import { formatMovesForWhiteBottom, getSolveTargetFace } from "../core/solve-notation.ts";
import { renderSolveTimeline } from "./solve-timeline.ts";

export interface HistoryDetailElements {
  detail: HTMLDivElement;
  retryButton: HTMLButtonElement;
  solutionButton: HTMLButtonElement;
}

/** 历史详情与 3D 回放的 UI 生命周期，避免主入口持有播放器状态。 */
export class HistoryDetailController {
  private replayPlayer: SolveReplayPlayer | null = null;

  constructor(
    private readonly elements: HistoryDetailElements,
    private readonly isDetailedScoreMode: () => boolean,
  ) {}

  render(solve: AnalysisInput, showSolution: boolean): void {
    this.close();
    const scramble = solve.scramble || "旧记录未保存打乱";
    const targetFace = getSolveTargetFace(solve.scramble, solve.moves);
    const solution = showSolution
      ? (solve.moves && targetFace ? formatMovesForWhiteBottom(solve.moves, targetFace).join(" ") : solve.moves?.join(" ")) || "未保存解法序列"
      : "点击\"查看解法\"显示本次还原步骤。";
    const inspectionValue = solve.inspectionDuration ? `${(solve.inspectionDuration / 1000).toFixed(2)}s` : "—";
    const inspectionMetric = this.isDetailedScoreMode()
      ? `<div><span>观察</span><strong>${inspectionValue}</strong></div>` : "";
    const showReplay = Boolean(showSolution && solve.scramble && solve.moves?.length);
    const quality = presentSolveQuality(solve.qualityStatus, solve.qualityAnomalies);
    this.elements.detail.innerHTML = `
      <div class="history-detail-grid">
        <div><span>成绩</span><strong>${formatWcaSolveTime({ duration: solve.totalDuration, penalty: solve.penalty })}${solve.penalty === "dnf" ? "" : "s"}</strong></div>
        ${inspectionMetric}
        <div><span>TPS</span><strong>${solve.tps?.toFixed(2) ?? "—"}</strong></div>
      </div>
      ${showReplay ? "" : '<div data-history-timeline></div>'}
      <div class="history-sequence"><span>数据可信度</span><strong>${escapeHtml(quality.label)}</strong><code>${escapeHtml(quality.description)}</code></div>
      <div class="history-sequence"><span>打乱</span><code>${escapeHtml(scramble)}</code></div>
      <div class="history-sequence"><span>解法${targetFace === "U" ? " · 白底记谱" : " · 原始记谱"}</span><code>${escapeHtml(solution)}</code></div>
      ${showReplay ? '<div class="history-replay" data-history-replay></div>' : ""}
    `;
    const timeline = this.elements.detail.querySelector<HTMLElement>("[data-history-timeline]");
    if (timeline) renderSolveTimeline(timeline, solve);
    const replayRoot = this.elements.detail.querySelector<HTMLElement>("[data-history-replay]");
    if (replayRoot && solve.moves) this.replayPlayer = new SolveReplayPlayer(replayRoot, solve);
    this.elements.retryButton.disabled = !solve.scramble;
    this.elements.solutionButton.disabled = !solve.moves || solve.moves.length === 0;
  }

  close(): void {
    this.replayPlayer?.destroy();
    this.replayPlayer = null;
  }
}

function escapeHtml(value: string): string {
  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}
