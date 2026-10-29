/** 打乱生成、进度追踪、终态核验与观察期的共享生命周期。 */

import { scramble333 } from "../scramble/scramble-333.ts";
import { getFormulaSetupMoves } from "../formula/setup-validation.ts";
import { buildPracticeTransitionMoves, compactMoves } from "../core/practice-transition.ts";
import { applyScrambleMove, createScrambleProgress, shouldRegenerateScrambleAfterWrongMoves } from "../core/scramble-tracker.ts";
import { resolveScrambleReplayBaseline } from "../core/scramble-verification.ts";
import { createScramblePhysicalVerification } from "./scramble-physical-verification.ts";
import { solveCross } from "../core/cross-solver.ts";
import { sendDiagnosticEvent } from "../core/diagnostics-client.ts";
import { SOLVED_FACELET } from "../utils/mathlib.ts";
import type { AppState } from "../core/app-state.ts";
import type { Timer } from "../core/timer.ts";

/** 打乱控制器所需 DOM 元素 */
export interface ScrambleControllerElements {
  scrambleText: HTMLElement;
  btnNextScramble: HTMLButtonElement;
  btnToggleScrambleSteps: HTMLButtonElement;
  crossStepSelector: HTMLElement;
  btnStop: HTMLButtonElement;
}

/** 结构化依赖：只声明实际用到的方法，避免与具体控制器实现耦合。 */
export interface ScrambleControllerDependencies {
  timer: Timer;
  timerDisplay: {
    endInspection: () => void;
    stopDisplay: () => void;
    updateDisplay: () => void;
    beginInspection: () => void;
  };
  cubeVisualizer: {
    reset: () => void;
    getFacelets: () => string;
    loadFacelets: (facelets: string) => boolean;
  };
  ble: {
    requestCurrentFacelets: () => Promise<string | null>;
  };
  practice: {
    updateBanner: () => void;
  };
  /** 新一把打乱装载完成（含专项/公式/历史重试）时回调，用于复位派生 UI 状态。 */
  onNewScramble?: () => void;
  onReviewNext?: () => void;
  onLeaveReview?: () => void;
  escapeHtml: (s: string) => string;
  log: (msg: string, type?: "info" | "move" | "error") => void;
}

export interface ScrambleController {
  init(): void;
  newScramble(): Promise<void>;
  prepareBlockScramble(mode: "cross" | "f2l" | "cross-f2l"): void;
  preparePracticeScramble(): void;
  renderProgress(): void;
  updateOnMove(move: string): void;
  verifyCompleted(): void;
  verifyPhysicalAndBeginInspection(): Promise<void>;
  cancelPhysicalVerification(): void;
  /** 生成指定 Cross 打乱时检测到实体转动：放弃本次生成，等待用户复原后重试。 */
  cancelGeneration(): void;
  /** 按当前已追踪局面生成到原题的过渡打乱。 */
  retryHistoryScramble(scramble: string): void;
}

interface ScrambleContext {
  els: ScrambleControllerElements;
  state: AppState;
  deps: ScrambleControllerDependencies;
  physical: ReturnType<typeof createScramblePhysicalVerification>;
  crossScrambleWorker: Worker | null;
  crossScrambleRequestId: number;
  crossScramblePending: Map<number, { resolve: (scramble: string) => void; reject: (error: Error) => void }>;
}

export function createScrambleController(
  els: ScrambleControllerElements, state: AppState, deps: ScrambleControllerDependencies,
): ScrambleController {
  const context: ScrambleContext = {
    els, state, deps, physical: createScramblePhysicalVerification(state, deps),
    crossScrambleWorker: null, crossScrambleRequestId: 0, crossScramblePending: new Map(),
  };
  return {
    init: () => init(context), newScramble: () => newScramble(context),
    prepareBlockScramble: (mode) => prepareBlockScramble(context, mode),
    preparePracticeScramble: () => preparePracticeScramble(context),
    renderProgress: () => renderProgress(context), updateOnMove: (move) => updateOnMove(context, move),
    verifyCompleted: () => verifyCompleted(context),
    verifyPhysicalAndBeginInspection: context.physical.verify,
    cancelPhysicalVerification: context.physical.cancel,
    cancelGeneration: () => cancelGeneration(context),
    retryHistoryScramble: (scramble) => retryHistoryScramble(context, scramble),
  };
}

function setScrambleGenerationPending(context: ScrambleContext, pending: boolean): void {
  const { els, state } = context;
  state.scramble.isGenerationPending = pending;
  els.btnNextScramble.disabled = pending;
  els.btnNextScramble.textContent = pending ? "生成中…" : "新打乱";
  els.crossStepSelector.querySelectorAll<HTMLButtonElement>("[data-cross-steps]").forEach((button) => {
    button.disabled = pending;
  });
}

function getCrossScrambleWorker(context: ScrambleContext): Worker {
  const { state } = context;
  if (!context.crossScrambleWorker) {
    const worker = new Worker("./cross-scramble-worker.js");
    worker.onmessage = (event: MessageEvent<{ scramble?: string; error?: string; requestId?: number }>) => {
      const pending = context.crossScramblePending.get(event.data.requestId ?? -1);
      if (!pending) return; // 过期响应（用户已重新生成或取消）
      context.crossScramblePending.delete(event.data.requestId!);
      if (event.data.scramble) pending.resolve(event.data.scramble);
      else pending.reject(new Error(event.data.error ?? "Cross 打乱生成失败"));
    };
    worker.onerror = (event) => {
      for (const pending of context.crossScramblePending.values()) {
        pending.reject(new Error(event.message || "Cross 打乱 Worker 无法启动"));
      }
      context.crossScramblePending.clear();
      context.crossScrambleWorker?.terminate();
      context.crossScrambleWorker = null;
    };
    context.crossScrambleWorker = worker;
    state.scramble.activeCrossScrambleWorker = worker;
  }
  return context.crossScrambleWorker;
}

function generateCrossScrambleInWorker(context: ScrambleContext, targetSteps: number): Promise<string> {
  const requestId = ++context.crossScrambleRequestId;
  return new Promise((resolve, reject) => {
    context.crossScramblePending.set(requestId, { resolve, reject });
    getCrossScrambleWorker(context).postMessage({ targetFace: "U", targetSteps, requestId });
  });
}

function generatePreferredScramble(context: ScrambleContext): Promise<string> {
  const { state } = context;
  if (state.scramble.selectedCrossSteps === null) return Promise.resolve(scramble333(20));
  return generateCrossScrambleInWorker(context, state.scramble.selectedCrossSteps);
}

function getCurrentTransitionMoves(context: ScrambleContext): string[] {
  const { state } = context;
  const { timer, cubeVisualizer } = context.deps;
  if (cubeVisualizer.getFacelets() === SOLVED_FACELET) return [];
  return compactMoves([
    ...state.scramble.startingMoves,
    ...state.scramble.performedMoves,
    ...timer.getState().moves.map((move) => move.move),
    ...state.practice.postSolveMoves,
  ]);
}

function getTransitionScramble(context: ScrambleContext, targetMoves: string[]): string {
  const currentMoves = getCurrentTransitionMoves(context);
  context.state.scramble.startingMoves = currentMoves;
  return buildPracticeTransitionMoves(currentMoves, targetMoves).join(" ");
}

function loadGeneratedScramble(context: ScrambleContext, scramble: string): void {
  const { els, state } = context;
  const { timer, timerDisplay, onNewScramble, log } = context.deps;
  state.scramble.currentScramble = getTransitionScramble(context, scramble.trim().split(/\s+/).filter(Boolean));
  state.scramble.progress = createScrambleProgress(state.scramble.currentScramble);
  state.scramble.performedMoves = [];
  state.scramble.stateVerified = false;
  state.scramble.wrongMoveCount = 0;
  state.practice.awaitingNextScramble = false;
  state.practice.postSolveMoves = [];
  timer.reset();
  timerDisplay.endInspection();
  timerDisplay.stopDisplay();
  timerDisplay.updateDisplay();
  els.btnStop.disabled = true;
  renderProgress(context);
  void sendDiagnosticEvent({ kind: "scramble", occurredAt: Date.now(), scramble: state.scramble.currentScramble, mode: "normal" });
  log(`生成打乱: ${state.scramble.currentScramble.slice(0, 40)}${state.scramble.currentScramble.length > 40 ? "..." : ""}`);
  onNewScramble?.();
}

async function newScramble(context: ScrambleContext): Promise<void> {
  const { state } = context;
  const { log } = context.deps;
  context.physical.cancel();
  if (state.review) {
    context.deps.onReviewNext?.();
    return;
  }
  if (state.practice.session) {
    preparePracticeScramble(context);
    return;
  }
  const generationId = ++state.scramble.generationId;
  state.scramble.startingMoves = getCurrentTransitionMoves(context);
  state.scramble.performedMoves = [];
  state.practice.postSolveMoves = [];
  context.deps.timer.reset();
  // 指定难度由 Worker 筛选，不能在结果返回前继续显示或执行上一条打乱。
  // Worker 常驻复用，旧请求的响应按 requestId 丢弃，无需终止重建。
  state.scramble.currentScramble = "";
  state.scramble.progress = createScrambleProgress("");
  renderProgress(context);
  setScrambleGenerationPending(context, true);
  try {
    const scramble = await generatePreferredScramble(context);
    if (generationId === state.scramble.generationId) loadGeneratedScramble(context, scramble);
  } catch (error) {
    console.error("[scramble] 指定 Cross 打乱失败:", error);
    if (generationId === state.scramble.generationId) {
      log("指定 Cross 暂时未生成，已回退为 WCA 随机打乱", "error");
      loadGeneratedScramble(context, scramble333(20));
    }
  } finally {
    if (generationId === state.scramble.generationId) setScrambleGenerationPending(context, false);
  }
}

function prepareBlockScramble(context: ScrambleContext, mode: "cross" | "f2l" | "cross-f2l"): void {
  context.deps.onLeaveReview?.();
  cancelGeneration(context);
  const { els, state } = context;
  const { timer, timerDisplay, onNewScramble, log } = context.deps;
  context.physical.cancel();
  state.practice.blockMode = mode;
  state.practice.blockCompleted = false;
  const baseScramble = scramble333(20);
  const setupMoves = mode === "f2l" ? solveCross(baseScramble, "U") : [];
  state.scramble.currentScramble = getTransitionScramble(context, [...baseScramble.split(" "), ...setupMoves]);
  state.scramble.progress = createScrambleProgress(state.scramble.currentScramble);
  state.scramble.performedMoves = [];
  state.scramble.stateVerified = false;
  state.scramble.wrongMoveCount = 0;
  state.practice.awaitingNextScramble = false;
  state.practice.postSolveMoves = [];
  timer.reset();
  timerDisplay.endInspection();
  timerDisplay.stopDisplay();
  timerDisplay.updateDisplay();
  els.btnStop.disabled = true;
  renderProgress(context);
  void sendDiagnosticEvent({ kind: "scramble", occurredAt: Date.now(), scramble: state.scramble.currentScramble, mode });
  log(mode === "cross" ? "已生成白面朝下 Cross 专项练习" : mode === "f2l" ? "已生成白色十字完成的 F2L 练习" : "已生成 Cross + F2L 练习");
  onNewScramble?.();
}

function preparePracticeScramble(context: ScrambleContext): void {
  context.deps.onLeaveReview?.();
  cancelGeneration(context);
  const { els, state } = context;
  const { timer, timerDisplay, practice, onNewScramble } = context.deps;
  context.physical.cancel();
  if (!state.practice.session) return;
  const targetSetupMoves = getFormulaSetupMoves(state.practice.session.formula);
  state.scramble.currentScramble = getTransitionScramble(context, targetSetupMoves);
  state.scramble.progress = createScrambleProgress(state.scramble.currentScramble);
  state.scramble.performedMoves = [];
  state.scramble.stateVerified = false;
  state.scramble.wrongMoveCount = 0;
  state.practice.awaitingNextScramble = false;
  state.practice.postSolveMoves = [];
  timer.reset();
  timerDisplay.endInspection();
  timerDisplay.stopDisplay();
  timerDisplay.updateDisplay();
  els.btnStop.disabled = true;
  state.practice.needsRetry = false;
  state.practice.caseVerified = false;
  renderProgress(context);
  void sendDiagnosticEvent({ kind: "scramble", occurredAt: Date.now(), scramble: state.scramble.currentScramble, mode: "formula", formulaId: state.practice.session.formula.id });
  practice.updateBanner();
  onNewScramble?.();
}

function renderProgress(context: ScrambleContext): void {
  const { els, state } = context;
  const { escapeHtml } = context.deps;
  if (state.scramble.showFullScramble) {
    const completedCount = state.scramble.progress.completed.length;
    const allMoves = state.scramble.progress.completed.concat(state.scramble.progress.remaining);
    els.scrambleText.innerHTML = allMoves.map((move, index) => {
      const isCompleted = index < completedCount;
      const isNext = !isCompleted && index === completedCount;
      return `<span class="scramble-move ${isCompleted ? "completed" : ""} ${isNext ? "next" : ""}">${escapeHtml(move)}</span>`;
    }).join(" ");
    return;
  }

  // 默认视图：完整打乱原位标注进度（已完成灰化、下一手高亮），学 csTimer；
  // 切换后只展示尚待执行的一组步骤，紧凑但看不到已执行进度。
  els.scrambleText.innerHTML = state.scramble.progress.remaining.map(
    (move, index) => `<span class="scramble-move ${index === 0 ? "next" : ""}">${escapeHtml(move)}</span>`
  ).join(" ");
}

function updateOnMove(context: ScrambleContext, move: string): void {
  const { state } = context;
  const { timer, log } = context.deps;
  if (timer.getState().isRunning || state.scramble.progress.remaining.length === 0) return;

  const expected = state.scramble.progress.remaining[0];
  state.scramble.progress = applyScrambleMove(state.scramble.progress, move);
  renderProgress(context);

  if (state.scramble.progress.lastMoveCorrect === false) {
    state.scramble.wrongMoveCount++;
    log(`打乱转错：期望 ${expected}，已加入纠错步`, "error");
    if (shouldRegenerateScrambleAfterWrongMoves(state.scramble.wrongMoveCount)) {
      log("本次打乱累计错 6 步，已放弃当前纠错队列并生成新的打乱。", "error");
      void newScramble(context);
    }
  }
}

function verifyCompleted(context: ScrambleContext): void {
  const { state } = context;
  const { log } = context.deps;
  const baseline = resolveScrambleReplayBaseline(state.scramble.progress.completed, state.scramble.performedMoves);
  state.scramble.stateVerified = baseline.matchesPlannedScramble;
  if (state.scramble.stateVerified) {
    log("打乱状态已核验，可转动第一步开始计时");
    return;
  }
  // 3D 与实体魔方已经按照实际动作同步；回放也必须用同一基线，不能仍使用已偏离的页面提示。
  state.scramble.progress = { ...state.scramble.progress, completed: baseline.moves };
  state.scramble.currentScramble = baseline.moves.join(" ");
  log("实际打乱与页面提示不同，已改用实体执行的连续动作作为本把回放基线。", "error");
}

function cancelGeneration(context: ScrambleContext): void {
  const { state } = context;
  state.scramble.generationId++;
  // 用户已开始转动魔方：放弃本次生成并释放 Worker，等待复原后重试。
  if (context.crossScrambleWorker) {
    context.crossScrambleWorker.terminate();
    context.crossScrambleWorker = null;
    state.scramble.activeCrossScrambleWorker = null;
  }
  for (const pending of context.crossScramblePending.values()) {
    pending.reject(new Error("已取消"));
  }
  context.crossScramblePending.clear();
  setScrambleGenerationPending(context, false);
}

function retryHistoryScramble(context: ScrambleContext, scramble: string): void {
  context.physical.cancel();
  cancelGeneration(context);
  loadGeneratedScramble(context, scramble);
  context.deps.log("已从当前局面生成原题过渡打乱，无需断开魔方");
}

function init(context: ScrambleContext): void {
  const { els, state } = context;
  const { log } = context.deps;
  els.crossStepSelector.querySelectorAll<HTMLButtonElement>("[data-cross-steps]").forEach((button) => {
    button.onclick = () => {
      const rawValue = button.dataset.crossSteps;
      state.scramble.selectedCrossSteps = rawValue && rawValue !== "random" ? Number(rawValue) : null;
      els.crossStepSelector.querySelectorAll<HTMLButtonElement>("[data-cross-steps]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      log(state.scramble.selectedCrossSteps === null ? "已选择随机 Cross 打乱" : `已选择白色 Cross ${state.scramble.selectedCrossSteps} 步打乱`);
      void newScramble(context);
    };
  });
  els.btnNextScramble.onclick = () => { void newScramble(context); };
  els.btnToggleScrambleSteps.onclick = () => {
    state.scramble.showFullScramble = !state.scramble.showFullScramble;
    els.btnToggleScrambleSteps.textContent = state.scramble.showFullScramble ? "仅看剩余" : "显示完整";
    renderProgress(context);
  };
}
