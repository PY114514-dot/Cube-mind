import { CubeVisualizer } from "./cube-visualizer.ts";
import type { AnalysisInput } from "../../src-shared/analysis-types.ts";
import { buildReplayTimestamps } from "../core/solve-replay-timing.ts";
import { renderSolveTimeline } from "./solve-timeline.ts";

const SPEEDS = [0.5, 1, 2, 4] as const;

export interface SolveReplayPlayerOptions {
  title?: string;
  emptyMessage?: string;
  emphasizeChanges?: boolean;
  view?: "white-top" | "yellow-top";
  onPlay?: () => void;
  /** 零基半开区间；回放从起点之前的完整局面开始，到区间终点自动停止。 */
  segment?: { startMoveIndex: number; endMoveIndex: number };
}

/** 复盘默认固定为白底、黄面朝上的 CFOP 观察角度。 */
export function getReplayInitialRotationX(view: SolveReplayPlayerOptions["view"] = "yellow-top"): number {
  return view === "white-top" ? -28 : 152;
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
  private readonly modeButton: HTMLButtonElement;
  private readonly timeLabel: HTMLElement;
  private readonly timestamps: number[] | null;
  private readonly onPlay: (() => void) | undefined;
  private timelineCursor: HTMLElement | null = null;
  private recordedMode: boolean;
  private elapsed = 0;
  private lastTick = 0;
  private index = 0;
  private speedIndex = 1;
  private isPlaying = false;
  private timerId: number | null = null;
  private readonly startIndex: number;
  private readonly endIndex: number;

  constructor(root: HTMLElement, solve: AnalysisInput, options: SolveReplayPlayerOptions = {}) {
    this.root = root;
    this.scrambleMoves = splitMoves(solve.scramble ?? "");
    this.solutionMoves = (solve.moves ?? []).slice();
    this.timestamps = buildReplayTimestamps(this.solutionMoves.length, solve.moveGaps);
    this.recordedMode = this.timestamps !== null;
    this.onPlay = options.onPlay;
    this.startIndex = options.segment?.startMoveIndex ?? 0;
    this.endIndex = options.segment?.endMoveIndex ?? this.solutionMoves.length;
    if (!Number.isInteger(this.startIndex) || !Number.isInteger(this.endIndex) || this.startIndex < 0
      || this.endIndex < this.startIndex || this.endIndex > this.solutionMoves.length) {
      throw new Error("[solve-replay] 动作片段范围无效");
    }
    const title = options.title ?? "3D 解法回放";
    const emptyMessage = options.emptyMessage ?? "暂无可回放动作";
    this.root.innerHTML = `
      <section class="solve-replay-player" aria-label="3D 解法回放">
        <div class="solve-replay-heading"><span data-replay-title></span><strong data-replay-move></strong></div>
        <div class="solve-replay-cube" data-replay-cube></div>
        <div class="solve-replay-controls">
          <div class="solve-replay-toolbar">
            <button type="button" class="ghost" data-replay-action="back" aria-label="回退一步">‹</button>
            <button type="button" class="practice-btn" data-replay-action="play">播放</button>
            <button type="button" class="ghost" data-replay-action="forward" aria-label="前进一步">›</button>
            <button type="button" class="ghost" data-replay-action="speed">1×</button>
            <strong data-replay-step>第 0 步 · 共 ${this.solutionMoves.length} 步</strong>
          </div>
          <input data-replay-progress type="range" min="${this.startIndex}" max="${this.endIndex}" value="${this.startIndex}" step="1" aria-label="按步数跳转解法进度">
          <div class="solve-replay-timing"><button type="button" class="ghost" data-replay-action="mode" aria-label="切换实速或匀速回放" ${this.timestamps ? "" : "disabled"}></button><span data-replay-time></span></div>
        </div>
        ${options.segment ? "" : '<div data-replay-timeline></div>'}
      </section>`;
    const cubeRoot = this.root.querySelector<HTMLElement>("[data-replay-cube]");
    const range = this.root.querySelector<HTMLInputElement>("[data-replay-progress]");
    const stepLabel = this.root.querySelector<HTMLElement>("[data-replay-step]");
    const playButton = this.root.querySelector<HTMLButtonElement>("[data-replay-action=play]");
    const speedButton = this.root.querySelector<HTMLButtonElement>("[data-replay-action=speed]");
    const modeButton = this.root.querySelector<HTMLButtonElement>("[data-replay-action=mode]");
    const timeLabel = this.root.querySelector<HTMLElement>("[data-replay-time]");
    if (!cubeRoot || !range || !stepLabel || !playButton || !speedButton || !modeButton || !timeLabel) throw new Error("[replay] 播放器元素未初始化");
    this.visualizer = new CubeVisualizer(cubeRoot, {
      role: "replay",
      emphasizeChanges: options.emphasizeChanges,
      initialRotationX: getReplayInitialRotationX(options.view),
    });
    this.range = range;
    this.stepLabel = stepLabel;
    this.playButton = playButton;
    this.speedButton = speedButton;
    this.modeButton = modeButton;
    this.timeLabel = timeLabel;
    const titleLabel = this.root.querySelector<HTMLElement>("[data-replay-title]");
    if (titleLabel) titleLabel.textContent = title;
    const timeline = this.root.querySelector<HTMLElement>("[data-replay-timeline]");
    if (timeline) {
      renderSolveTimeline(timeline, solve, { onSeek: (index) => {
        this.seek(index);
        cubeRoot.scrollIntoView({ block: "start" });
      } });
      this.timelineCursor = timeline.querySelector<HTMLElement>("[data-timeline-cursor]");
    }
    this.seek(this.startIndex);
    if (this.solutionMoves.length === 0) {
      const moveLabel = this.root.querySelector<HTMLElement>("[data-replay-move]");
      if (moveLabel) moveLabel.textContent = emptyMessage;
    }
    this.bindControls();
  }

  destroy(): void {
    this.pause();
    this.visualizer.reset();
    this.root.innerHTML = "";
  }

  private bindControls(): void {
    this.root.querySelector<HTMLButtonElement>("[data-replay-action=back]")?.addEventListener("click", () => this.seek(this.index - 1));
    this.root.querySelector<HTMLButtonElement>("[data-replay-action=forward]")?.addEventListener("click", () => this.seek(this.index + 1));
    this.playButton.addEventListener("click", () => this.isPlaying ? this.pause() : this.play());
    this.speedButton.addEventListener("click", () => {
      this.advanceClock();
      this.speedIndex = (this.speedIndex + 1) % SPEEDS.length;
      this.speedButton.textContent = `${SPEEDS[this.speedIndex]}×`;
    });
    this.modeButton.addEventListener("click", () => {
      if (!this.timestamps) return;
      const playing = this.isPlaying;
      this.pause();
      this.recordedMode = !this.recordedMode;
      this.seek(this.index);
      if (playing) this.play();
    });
    this.range.addEventListener("input", () => this.seek(Number(this.range.value)));
  }

  private play(): void {
    this.onPlay?.();
    if (this.index >= this.endIndex) this.seek(this.startIndex);
    this.isPlaying = true;
    this.lastTick = performance.now();
    this.playButton.textContent = "暂停";
    this.playTick();
  }

  pause(): void {
    this.advanceClock();
    this.isPlaying = false;
    if (this.timerId !== null) window.clearTimeout(this.timerId);
    this.timerId = null;
    this.playButton.textContent = "播放";
    this.renderProgress();
  }

  private advanceClock(): void {
    if (!this.isPlaying) return;
    const now = performance.now();
    this.elapsed = Math.min(this.moveTime(this.endIndex), this.elapsed + (now - this.lastTick) * SPEEDS[this.speedIndex]);
    this.lastTick = now;
  }

  private moveTime(index: number): number {
    return this.recordedMode && this.timestamps ? this.timestamps[index] : index * 260;
  }

  private playTick(): void {
    if (!this.isPlaying) return;
    // 所有容器复用同一检查：关闭弹窗、折叠解法或替换输出后，旧播放器不能继续推进。
    if (!this.root.isConnected || this.root.getClientRects().length === 0 || document.hidden
      || window.getComputedStyle(this.root).visibility !== "visible") {
      this.lastTick = performance.now();
      this.pause();
      this.visualizer.loadMoves([...this.scrambleMoves, ...this.solutionMoves.slice(0, this.index)]);
      return;
    }
    this.advanceClock();
    while (this.index < this.endIndex && this.elapsed >= this.moveTime(this.index + 1)) {
      const nextGap = this.index + 1 < this.endIndex ? this.moveTime(this.index + 2) - this.moveTime(this.index + 1) : 120;
      this.visualizer.applyMove(this.solutionMoves[this.index], Math.max(0, nextGap / SPEEDS[this.speedIndex] - 16));
      this.index++;
    }
    this.renderProgress();
    if (this.index >= this.endIndex) {
      this.pause();
      return;
    }
    const remaining = (this.moveTime(this.index + 1) - this.elapsed) / SPEEDS[this.speedIndex];
    this.timerId = window.setTimeout(() => this.playTick(), Math.min(50, Math.max(1, remaining)));
  }

  seek(target: number): void {
    if (!Number.isFinite(target)) return;
    this.pause();
    this.index = Math.max(this.startIndex, Math.min(this.endIndex, Math.floor(target)));
    this.elapsed = this.moveTime(this.index);
    this.visualizer.loadMoves([...this.scrambleMoves, ...this.solutionMoves.slice(0, this.index)]);
    this.renderProgress();
  }

  private renderProgress(): void {
    this.range.value = String(this.index);
    this.stepLabel.textContent = `第 ${this.index} 步 · ${this.startIndex > 0 || this.endIndex < this.solutionMoves.length
      ? `片段 ${this.startIndex + 1}–${this.endIndex} 步` : `共 ${this.solutionMoves.length} 步`}`;
    const moveLabel = this.root.querySelector<HTMLElement>("[data-replay-move]");
    if (moveLabel) moveLabel.textContent = this.index < this.endIndex ? `下一步 ${this.solutionMoves[this.index]}`
      : this.endIndex < this.solutionMoves.length ? "片段结束" : "已完成";
    this.modeButton.textContent = this.recordedMode ? "实速回放" : "匀速演示";
    this.modeButton.setAttribute("aria-pressed", String(this.recordedMode));
    const time = this.recordedMode ? this.elapsed : this.timestamps?.[this.index];
    const waiting = this.isPlaying && this.recordedMode && this.index < this.endIndex
      && (this.timestamps?.[this.index + 1] ?? 0) - (this.timestamps?.[this.index] ?? 0) > 300;
    this.timeLabel.textContent = time === undefined ? "缺少完整动作时间" : `${waiting ? "等待下一步 · " : "动作时间 "}${(time / 1000).toFixed(2)}s`;
    if (this.timelineCursor && this.timestamps) {
      const progress = (this.recordedMode ? this.elapsed : this.timestamps[this.index]) / Math.max(1, Number(this.timelineCursor.dataset.duration));
      this.timelineCursor.style.left = `${Math.min(100, progress * 100)}%`;
    }
  }
}

function splitMoves(sequence: string): string[] {
  return sequence.trim().split(/\s+/).filter(Boolean);
}
