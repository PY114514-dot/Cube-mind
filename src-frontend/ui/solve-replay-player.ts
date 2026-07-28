import { CubeVisualizer } from "./cube-visualizer.ts";

const SPEEDS = [0.5, 1, 2, 4] as const;

export interface SolveReplayPlayerOptions {
  title?: string;
  emptyMessage?: string;
  emphasizeChanges?: boolean;
  view?: "white-top" | "yellow-top";
}

/** 复盘默认固定为白底、黄面朝上的 CFOP 观察角度。 */
export function getReplayInitialRotationX(view: SolveReplayPlayerOptions["view"] = "yellow-top"): number {
  return view === "white-top" ? -28 : 28;
}

/** 历史解法播放器：进度以 move 为单位，跳转时始终从打乱状态确定性重建。 */
export class SolveReplayPlayer {
  private readonly root: HTMLElement;
  private readonly scrambleMoves: string[];
  private readonly solutionMoves: string[];
  private readonly visualizer: CubeVisualizer;
  private readonly range: HTMLInputElement;
  private readonly stepLabel: HTMLElement;
  private readonly playButton: HTMLButtonElement;
  private readonly speedButton: HTMLButtonElement;
  private index = 0;
  private speedIndex = 1;
  private isPlaying = false;
  private timerId: number | null = null;

  constructor(root: HTMLElement, scramble: string, solutionMoves: string[], options: SolveReplayPlayerOptions = {}) {
    this.root = root;
    this.scrambleMoves = splitMoves(scramble);
    this.solutionMoves = [...solutionMoves];
    const title = options.title ?? "3D 解法回放";
    const emptyMessage = options.emptyMessage ?? "暂无可回放动作";
    this.root.innerHTML = `
      <section class="solve-replay-player" aria-label="${title}">
        <div class="solve-replay-heading"><span>${title}</span><strong data-replay-move>${this.solutionMoves[0] ?? emptyMessage}</strong></div>
        <div class="solve-replay-cube" data-replay-cube></div>
        <div class="solve-replay-controls">
          <div class="solve-replay-toolbar">
            <button type="button" class="ghost" data-replay-action="back" aria-label="回退一步">‹</button>
            <button type="button" class="practice-btn" data-replay-action="play">播放</button>
            <button type="button" class="ghost" data-replay-action="forward" aria-label="前进一步">›</button>
            <button type="button" class="ghost" data-replay-action="speed">1×</button>
            <strong data-replay-step>第 0 / ${this.solutionMoves.length} 步</strong>
          </div>
          <input data-replay-progress type="range" min="0" max="${this.solutionMoves.length}" value="0" step="1" aria-label="按步数跳转解法进度">
        </div>
      </section>`;
    const cubeRoot = this.root.querySelector<HTMLElement>("[data-replay-cube]");
    const range = this.root.querySelector<HTMLInputElement>("[data-replay-progress]");
    const stepLabel = this.root.querySelector<HTMLElement>("[data-replay-step]");
    const playButton = this.root.querySelector<HTMLButtonElement>("[data-replay-action=play]");
    const speedButton = this.root.querySelector<HTMLButtonElement>("[data-replay-action=speed]");
    if (!cubeRoot || !range || !stepLabel || !playButton || !speedButton) throw new Error("[replay] 播放器元素未初始化");
    this.visualizer = new CubeVisualizer(cubeRoot, {
      emphasizeChanges: options.emphasizeChanges,
      initialRotationX: getReplayInitialRotationX(options.view),
    });
    this.range = range;
    this.stepLabel = stepLabel;
    this.playButton = playButton;
    this.speedButton = speedButton;
    this.visualizer.loadMoves(this.scrambleMoves);
    this.bindControls();
  }

  destroy(): void {
    this.pause();
    this.root.innerHTML = "";
  }

  private bindControls(): void {
    this.root.querySelector<HTMLButtonElement>("[data-replay-action=back]")?.addEventListener("click", () => this.seek(this.index - 1));
    this.root.querySelector<HTMLButtonElement>("[data-replay-action=forward]")?.addEventListener("click", () => this.seek(this.index + 1));
    this.playButton.addEventListener("click", () => this.isPlaying ? this.pause() : this.play());
    this.speedButton.addEventListener("click", () => {
      this.speedIndex = (this.speedIndex + 1) % SPEEDS.length;
      this.speedButton.textContent = `${SPEEDS[this.speedIndex]}×`;
    });
    this.range.addEventListener("input", () => this.seek(Number(this.range.value)));
  }

  private play(): void {
    if (this.index >= this.solutionMoves.length) this.seek(0);
    this.isPlaying = true;
    this.playButton.textContent = "暂停";
    this.playNext();
  }

  private pause(): void {
    this.isPlaying = false;
    if (this.timerId !== null) window.clearTimeout(this.timerId);
    this.timerId = null;
    this.playButton.textContent = "播放";
  }

  private playNext(): void {
    if (!this.isPlaying) return;
    if (this.index >= this.solutionMoves.length) {
      this.pause();
      return;
    }
    this.visualizer.applyMove(this.solutionMoves[this.index]);
    this.index++;
    this.renderProgress();
    this.timerId = window.setTimeout(() => this.playNext(), Math.max(80, 260 / SPEEDS[this.speedIndex]));
  }

  private seek(target: number): void {
    this.pause();
    this.index = Math.max(0, Math.min(this.solutionMoves.length, Math.floor(target)));
    this.visualizer.loadMoves([...this.scrambleMoves, ...this.solutionMoves.slice(0, this.index)]);
    this.renderProgress();
  }

  private renderProgress(): void {
    this.range.value = String(this.index);
    this.stepLabel.textContent = `第 ${this.index} / ${this.solutionMoves.length} 步`;
    const moveLabel = this.root.querySelector<HTMLElement>("[data-replay-move]");
    if (moveLabel) moveLabel.textContent = this.solutionMoves[this.index] ? `下一步 ${this.solutionMoves[this.index]}` : "已完成";
  }
}

function splitMoves(sequence: string): string[] {
  return sequence.trim().split(/\s+/).filter(Boolean);
}
