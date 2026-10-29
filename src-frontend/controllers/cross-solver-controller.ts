import type { CaseAlgorithmReference } from "../../src-shared/analysis-types.ts";
import { buildCrossLesson, buildXCrossLesson, type CrossLesson, type PairSlot, type XCrossLesson } from "../core/cross-coach.ts";
import { formatMovesForWhiteBottom } from "../core/solve-notation.ts";
import { solveCross } from "../core/cross-solver.ts";
import { scramble333 } from "../scramble/scramble-333.ts";
import { CubeVisualizer } from "../ui/cube-visualizer.ts";
import { SolveReplayPlayer } from "../ui/solve-replay-player.ts";
import { getSlotReplayYaw } from "../ui/f2l-solution-panel.ts";
import { crossMoveText, renderCrossAnswer, renderCrossQuestion, renderXCrossLesson } from "../ui/cross-coach-markup.ts";

type CoachMode = "prediction" | "cross" | "xcross";

export interface CrossSolverElements {
  btnSolveCross: HTMLButtonElement;
  btnSolveXCross: HTMLButtonElement;
  btnPredictCross: HTMLButtonElement;
  crossCoachDialog: HTMLDialogElement;
}

export interface CrossSolverDependencies {
  getCurrentScramble: () => string | null;
  getF2lAlgorithms: () => CaseAlgorithmReference[];
  getCrossMaxSteps: () => number;
  startXCross: (scramble: string) => boolean;
  escapeHtml: (s: string) => string;
}

/** 观察题与演示只保留本轮统计；真实计时通过已有的专项入口保存。 */
export class CrossSolverController {
  private readonly dialog: HTMLDialogElement;
  private readonly content: HTMLElement;
  private readonly status: HTMLElement;
  private readonly title: HTMLElement;
  private player: SolveReplayPlayer | null = null;
  private mode: CoachMode = "prediction";
  private scramble = "";
  private revision = 0;
  private startedAt = 0;
  private attempts = 0;
  private correct = 0;
  private followsCurrent = true;
  private readonly revealedQuestions = new Set<string>();

  constructor(private readonly els: CrossSolverElements, private readonly deps: CrossSolverDependencies) {
    this.dialog = els.crossCoachDialog;
    this.content = this.dialog.querySelector<HTMLElement>("[data-coach-content]")!;
    this.status = this.dialog.querySelector<HTMLElement>("[data-coach-stats]")!;
    this.title = this.dialog.querySelector<HTMLElement>("[data-coach-title]")!;
  }

  open(mode: CoachMode = "prediction"): void {
    this.mode = mode;
    const current = this.deps.getCurrentScramble();
    this.followsCurrent = current !== null;
    this.scramble = current ?? scramble333(20);
    if (!this.dialog.open) this.dialog.showModal();
    this.load();
  }

  invalidate(): void {
    if (this.followsCurrent && this.dialog.open) this.dialog.close();
  }

  init(): void {
    this.els.btnSolveCross.onclick = () => this.open("cross");
    this.els.btnSolveXCross.onclick = () => this.open("xcross");
    this.els.btnPredictCross.onclick = () => this.open();
    this.dialog.querySelector<HTMLButtonElement>("[data-coach-close]")!.onclick = () => this.dialog.close();
    this.dialog.addEventListener("close", () => {
      if (this.dialog.open) return;
      this.revision++;
      this.clearPlayer();
      this.content.replaceChildren();
    });
    this.dialog.querySelector<HTMLButtonElement>("[data-coach-next]")!.onclick = () => {
      this.followsCurrent = false;
      this.scramble = scramble333(20);
      this.load();
    };
    this.dialog.querySelectorAll<HTMLButtonElement>("[data-coach-mode]").forEach((button) => {
      button.onclick = () => { this.mode = button.dataset.coachMode as CoachMode; this.load(); };
    });
  }

  private clearPlayer(): void {
    this.player?.destroy();
    this.player = null;
  }

  private mountReplay(moves: string[], start = 0, end = moves.length, slot?: PairSlot): void {
    this.clearPlayer();
    this.player = new SolveReplayPlayer(this.content.querySelector<HTMLElement>("[data-coach-replay]")!, { scramble: this.scramble, moves }, {
      title: slot ? `白底记谱 · 聚焦 ${slot} 槽` : "白底记谱 · 逐步演示", view: "yellow-top", segment: { startMoveIndex: start, endMoveIndex: end },
      initialRotationY: slot ? getSlotReplayYaw(slot) : undefined,
    });
  }

  private reveal(lesson: CrossLesson, answered: boolean): void {
    const corner = this.content.querySelector<HTMLSelectElement>("#coach-corner")?.value;
    const edge = this.content.querySelector<HTMLSelectElement>("#coach-edge")?.value;
    const seconds = ((performance.now() - this.startedAt) / 1000).toFixed(1);
    const success = corner === lesson.corner && edge === lesson.edge;
    const scored = answered && !this.revealedQuestions.has(this.scramble);
    if (scored) { this.attempts++; if (success) this.correct++; }
    this.revealedQuestions.add(this.scramble);
    this.status.textContent = `本轮预判 ${this.correct} / ${this.attempts} 题正确`;
    const feedback = scored ? `${success ? "两块位置都正确" : "再跟着十字追踪一次"} · 本题观察 ${seconds} 秒` : "已揭晓 · 本题不计正确率";
    this.content.innerHTML = renderCrossAnswer(lesson, feedback, this.deps.escapeHtml);
    const moves = [...lesson.crossMoves, ...(lesson.pairMoves ?? [])];
    this.mountReplay(moves, 0, lesson.crossMoves.length, lesson.slot);
    this.content.querySelectorAll<HTMLButtonElement>("[data-coach-segment]").forEach((button) => {
      button.onclick = () => this.mountReplay(moves, button.dataset.coachSegment === "pair" ? lesson.crossMoves.length : 0,
        button.dataset.coachSegment === "pair" ? moves.length : lesson.crossMoves.length, lesson.slot);
    });
  }

  private renderQuestion(lesson: CrossLesson): void {
    this.content.innerHTML = renderCrossQuestion(lesson, this.deps.escapeHtml);
    const cube = new CubeVisualizer(this.content.querySelector<HTMLElement>("[data-coach-cube]")!, { role: "editor", initialRotationX: 152 });
    cube.loadMoves(this.scramble.split(/\s+/).filter(Boolean));
    this.startedAt = performance.now();
    this.content.querySelector<HTMLFormElement>("[data-coach-answer]")!.onsubmit = (event) => { event.preventDefault(); this.reveal(lesson, true); };
    this.content.querySelector<HTMLButtonElement>("[data-coach-reveal]")!.onclick = () => this.reveal(lesson, false);
    this.content.querySelector<HTMLFormElement>("[data-coach-plan]")!.onsubmit = (event) => {
      event.preventDefault();
      const input = this.content.querySelector<HTMLInputElement>("[name=plan]")!.value.trim().split(/\s+/).filter(Boolean);
      try { this.renderQuestion(buildCrossLesson(this.scramble, this.deps.getF2lAlgorithms(), formatMovesForWhiteBottom(input, "U"))); }
      catch (error) { this.content.querySelector<HTMLElement>("[data-coach-feedback]")!.textContent = error instanceof Error ? error.message : String(error); }
    };
  }

  private selectXCross(lesson: XCrossLesson, index: number): void {
    const candidate = lesson.candidates[index];
    if (!candidate) return;
    this.content.querySelector<HTMLElement>("[data-coach-xc-label]")!.textContent = `${candidate.slot} 槽 · ${candidate.moves.length} 步`;
    this.content.querySelector<HTMLElement>("[data-coach-xc-moves]")!.textContent = crossMoveText(candidate.moves);
    this.content.querySelectorAll<HTMLButtonElement>("[data-coach-candidate]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.coachCandidate) === index)));
    this.mountReplay(candidate.moves, 0, candidate.moves.length, candidate.slot);
  }

  private renderXCross(lesson: XCrossLesson): void {
    this.revealedQuestions.add(this.scramble);
    this.content.innerHTML = renderXCrossLesson(lesson);
    if (lesson.candidates.length) this.selectXCross(lesson, 0);
    else this.mountReplay([]);
    this.content.querySelectorAll<HTMLButtonElement>("[data-coach-candidate]").forEach((button) => {
      button.onclick = () => this.selectXCross(lesson, Number(button.dataset.coachCandidate));
    });
    this.content.querySelector<HTMLButtonElement>("[data-coach-train]")!.onclick = () => {
      if (this.deps.startXCross(this.scramble)) this.dialog.close();
      else this.content.querySelector<HTMLElement>("[data-coach-feedback]")!.textContent = "请先完成或停止当前计时，再进入 XC 专项。";
    };
  }

  private load(): void {
    const request = ++this.revision;
    this.clearPlayer();
    this.title.textContent = this.mode === "prediction" ? "十字与第一对预判" : this.mode === "xcross" ? "XC 解法与专项" : "十字 3D 演示";
    this.dialog.querySelectorAll<HTMLButtonElement>("[data-coach-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.coachMode === this.mode)));
    this.content.textContent = "正在校验局面与解法…";
    this.dialog.querySelector<HTMLElement>("[data-coach-origin]")!.textContent = this.followsCurrent ? "当前训练台打乱" : "独立观察题，不改变训练台打乱";
    window.setTimeout(() => {
      if (request !== this.revision || !this.dialog.open) return;
      try {
        if (this.mode === "xcross") this.renderXCross(buildXCrossLesson(this.scramble));
        else {
          const planned = this.mode === "cross" ? solveCross(this.scramble, "U", this.deps.getCrossMaxSteps()) : undefined;
          const lesson = buildCrossLesson(this.scramble, this.deps.getF2lAlgorithms(), planned);
          if (this.mode === "prediction") this.renderQuestion(lesson);
          else this.reveal(lesson, false);
        }
      } catch (error) {
        console.error("[cross-coach] 无法准备训练:", error);
        this.content.textContent = `无法准备本题：${error instanceof Error ? error.message : String(error)}。可点击下一题重试。`;
      }
    }, 0);
  }
}
