import type { AnalysisInput, F2lSolutionReview } from "../../src-shared/analysis-types.ts";
import { formatF2lSlotForWhiteBottom, formatMovesForWhiteBottom } from "../core/solve-notation.ts";
import { compactMoves } from "../core/practice-transition.ts";
import { SolveReplayPlayer } from "./solve-replay-player.ts";

type EscapeHtml = (value: string) => string;

export function getF2lReplayYaw(pair: Pick<F2lSolutionReview, "slots" | "targetFace">): number {
  const slot = formatF2lSlotForWhiteBottom(pair.slots[0], pair.targetFace);
  return getSlotReplayYaw(slot);
}

export function getSlotReplayYaw(slot: F2lSolutionReview["slots"][number]): number {
  return { FR: -35, FL: 35, BL: 145, BR: -145 }[slot];
}

/** 一次只装载一对的播放器，实录与候选共用真实起点和白底视角。 */
export class F2lSolutionPanel {
  private player: SolveReplayPlayer | null = null;

  constructor(private readonly root: HTMLElement, private readonly escapeHtml: EscapeHtml) {}

  render(solve: AnalysisInput): void {
    this.destroy();
    const pairs = solve.f2lSolutions ?? [];
    const crossSlots = (solve.f2lSlots ?? []).filter((slot) => slot.completedWithCross);
    this.root.hidden = pairs.length === 0 && crossSlots.length === 0;
    if (this.root.hidden) return;
    this.root.innerHTML = `<section class="f2l-coach" aria-label="逐对 F2L 解法对比">
      <div class="f2l-coach-heading"><h3>逐对 F2L</h3><span>同一起点 · 实录与候选</span></div>
      <p class="f2l-coach-note">步数按相邻同面合并后计，半转算 1 步。候选仅在当前公式库中选最短，已验证十字和已完成槽位。</p>
      ${crossSlots.length ? `<p class="f2l-coach-note">${crossSlots.length} 对已随十字完成，无独立 F2L 区间。</p>` : ""}
      <div class="f2l-pair-list">${pairs.map((pair, index) => this.renderPair(solve, pair, index)).join("")}</div>
      <div data-f2l-comparison hidden tabindex="-1"><div class="f2l-replay-tabs" role="group" aria-label="选择解法">
        <button type="button" data-f2l-mode="actual" aria-pressed="true">我的解法</button>
        <button type="button" class="ghost" data-f2l-mode="candidate" aria-pressed="false">候选解法</button>
      </div><p data-f2l-explanation class="f2l-coach-note"></p><div data-f2l-player></div></div>
      <p class="f2l-coach-note">局部方案会改变后续局面，请先在 3D 中观察；不能直接拼接到原整把解法。</p>
    </section>`;
    let selected = 0;
    const open = (mode: "actual" | "candidate"): void => this.play(solve, pairs[selected], mode);
    this.root.querySelectorAll<HTMLButtonElement>("[data-f2l-pair]").forEach((button) => {
      button.onclick = () => { selected = Number(button.dataset.f2lPair); open("actual"); };
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-f2l-mode]").forEach((button) => {
      button.onclick = () => open(button.dataset.f2lMode === "candidate" ? "candidate" : "actual");
    });
  }

  private renderPair(solve: AnalysisInput, pair: F2lSolutionReview, index: number): string {
    const names = pair.slots.map((slot) => formatF2lSlotForWhiteBottom(slot, pair.targetFace)).join(" / ");
    const actual = formatMovesForWhiteBottom(compactMoves(solve.moves!.slice(pair.startMoveIndex, pair.endMoveIndex)), pair.targetFace);
    const candidate = pair.candidate;
    const delta = candidate ? pair.actualStepCount - candidate.moves.length : null;
    const result = delta === null ? "暂缺可靠候选" : delta > 0 ? `候选少 ${delta} 步` : delta === 0 ? "步数相同，可比较手法" : "实录步数更少";
    return `<article class="f2l-pair"><div class="f2l-pair-heading"><strong>${this.escapeHtml(names)}${pair.slots.length > 1 ? " · 同步完成" : ""}</strong><span>${result}</span></div>
      <div class="f2l-alg-row"><span>实录 ${pair.actualStepCount} 步</span><code>${this.escapeHtml(actual.join(" "))}</code></div>
      ${candidate ? `<div class="f2l-alg-row"><span>候选 ${candidate.moves.length} 步</span><code>${this.escapeHtml(formatMovesForWhiteBottom(candidate.moves, pair.targetFace).join(" "))}</code></div>` : ""}
      <small>${this.escapeHtml(pair.note)}</small>
      <button type="button" class="ghost" data-f2l-pair="${index}">3D 对比${candidate ? "两种解法" : "实录"}</button></article>`;
  }

  private play(solve: AnalysisInput, pair: F2lSolutionReview, mode: "actual" | "candidate"): void {
    const panel = this.root.querySelector<HTMLElement>("[data-f2l-comparison]");
    const playerRoot = this.root.querySelector<HTMLElement>("[data-f2l-player]");
    const explanation = this.root.querySelector<HTMLElement>("[data-f2l-explanation]");
    if (!panel || !playerRoot || !explanation || (mode === "candidate" && !pair.candidate)) return;
    this.player?.destroy();
    panel.hidden = false;
    const candidate = mode === "candidate" ? pair.candidate : undefined;
    const replay = candidate ? { ...solve, scramble: `${solve.scramble} ${solve.moves!.slice(0, pair.startMoveIndex).join(" ")}`,
      moves: candidate.moves, moveGaps: undefined, f2lSlots: undefined } : solve;
    this.player = new SolveReplayPlayer(playerRoot, replay, {
      title: candidate ? `候选 · ${candidate.name}` : "我的解法 · 原始动作实录",
      view: pair.targetFace === "U" ? "yellow-top" : "white-top",
      initialRotationY: getF2lReplayYaw(pair),
      segment: candidate ? { startMoveIndex: 0, endMoveIndex: candidate.moves.length } : pair,
    });
    explanation.textContent = candidate ? `${pair.note} 候选为匀速演示，不预测执行时间。` : `第 ${pair.startMoveIndex + 1}–${pair.endMoveIndex} 条动作；从原题局面回放。`;
    this.root.querySelectorAll<HTMLButtonElement>("[data-f2l-mode]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.f2lMode === mode));
      button.disabled = button.dataset.f2lMode === "candidate" && !pair.candidate;
    });
    panel.focus({ preventScroll: true });
    panel.scrollIntoView({ block: "nearest" });
  }

  destroy(): void { this.player?.destroy(); this.player = null; }
}
