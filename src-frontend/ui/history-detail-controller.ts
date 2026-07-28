import type { AnalysisInput } from "../agent/types.ts";
import { presentSolveQuality } from "../core/data-quality.ts";
import { formatWcaSolveTime } from "../core/wca-average.ts";
import { SolveReplayPlayer } from "./solve-replay-player.ts";

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
    const solution = showSolution
      ? (solve.moves?.join(" ") || "旧记录未保存解法序列")
      : "点击“查看解法”显示本次还原步骤。";
    const detailMetrics = this.isDetailedScoreMode()
      ? `<div><span>Cross</span><strong>${(solve.crossDuration / 1000).toFixed(2)}s</strong></div>
         <div><span>F2L</span><strong>${(solve.f2lDuration / 1000).toFixed(2)}s</strong></div>
         <div><span>OLL</span><strong>${(solve.ollDuration / 1000).toFixed(2)}s</strong></div>
         <div><span>PLL</span><strong>${(solve.pllDuration / 1000).toFixed(2)}s</strong></div>`
      : `<div><span>TPS</span><strong>${solve.tps?.toFixed(2) ?? "—"}</strong></div>`;
    const quality = presentSolveQuality(solve.qualityStatus, solve.qualityAnomalies);
    this.elements.detail.innerHTML = `
      <div class="history-detail-grid">
        <div><span>成绩</span><strong>${formatWcaSolveTime({ duration: solve.totalDuration, penalty: solve.penalty })}${solve.penalty === "dnf" ? "" : "s"}</strong></div>
        ${detailMetrics}
      </div>
      <div class="history-sequence"><span>数据可信度</span><strong>${escapeHtml(quality.label)}</strong><code>${escapeHtml(quality.description)}</code></div>
      <div class="history-sequence"><span>打乱</span><code>${escapeHtml(scramble)}</code></div>
      <div class="history-sequence"><span>解法</span><code>${escapeHtml(solution)}</code></div>
      ${showSolution && solve.scramble && solve.moves?.length ? '<div class="history-replay" data-history-replay></div>' : ""}
    `;
    const replayRoot = this.elements.detail.querySelector<HTMLElement>("[data-history-replay]");
    if (replayRoot && solve.moves) this.replayPlayer = new SolveReplayPlayer(replayRoot, solve.scramble ?? "", solve.moves);
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
