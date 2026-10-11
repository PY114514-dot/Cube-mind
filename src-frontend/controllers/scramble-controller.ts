/**
 * 打乱生命周期控制器：打乱生成（WCA / Cross Worker / 专项练习）、进度跟踪、
 * 完成核验与观察期启动。
 *
 * 从 main.ts 抽出。控制器共享 AppState（打乱/练习状态），只依赖结构化接口；
 * main.ts 负责装配 DOM 引用与外部服务。
 */

import { scramble333 } from "../scramble/scramble-333.ts";
import { getFormulaSetupMoves } from "../formula/setup-validation.ts";
import { buildPracticeTransitionMoves } from "../core/practice-transition.ts";
import { applyScrambleMove, createScrambleProgress, shouldRegenerateScrambleAfterWrongMoves } from "../core/scramble-tracker.ts";
import { resolveScrambleReplayBaseline } from "../core/scramble-verification.ts";
import { isPhysicalStateInSync } from "../core/physical-state-sync.ts";
import { solveCross } from "../core/cross-solver.ts";
import { sendDiagnosticEvent, type DiagnosticMode } from "../core/diagnostics-client.ts";
import { SOLVED_FACELET } from "../utils/mathlib.ts";
import type { AppState } from "../core/app-state.ts";
import type { Timer } from "../core/timer.ts";

/** 打乱控制器所需 DOM 元素 */
export interface ScrambleControllerElements {
  scrambleText: HTMLElement;
  btnNextScramble: HTMLButtonElement;
  btnToggleScrambleSteps: HTMLButtonElement;
  crossStepSelector: HTMLElement;
  btnStart: HTMLButtonElement;
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
  /** 生成指定 Cross 打乱时检测到实体转动：放弃本次生成，等待用户复原后重试。 */
  cancelGeneration(): void;
  /** 历史记录重试：载入历史打乱并允许直接开始计时。 */
  retryHistoryScramble(scramble: string): void;
}

export function createScrambleController(
  els: ScrambleControllerElements,
  state: AppState,
  deps: ScrambleControllerDependencies,
): ScrambleController {
  const { timer, timerDisplay, cubeVisualizer, ble, practice, onNewScramble, escapeHtml, log } = deps;

  function setScrambleGenerationPending(pending: boolean): void {
    state.scramble.isGenerationPending = pending;
    els.btnNextScramble.disabled = pending;
    els.btnNextScramble.textContent = pending ? "生成中…" : "新打乱";
    els.crossStepSelector.querySelectorAll<HTMLButtonElement>("[data-cross-steps]").forEach((button) => {
      button.disabled = pending;
    });
  }

  /** Worker 常驻复用：距离表按目标面缓存，连续多次生成无需重建。 */
  let crossScrambleWorker: Worker | null = null;
  let crossScrambleRequestId = 0;
  const crossScramblePending = new Map<number, { resolve: (scramble: string) => void; reject: (error: Error) => void }>();

  function getCrossScrambleWorker(): Worker {
    if (!crossScrambleWorker) {
      const worker = new Worker("./cross-scramble-worker.js");
      worker.onmessage = (event: MessageEvent<{ scramble?: string; error?: string; requestId?: number }>) => {
        const pending = crossScramblePending.get(event.data.requestId ?? -1);
        if (!pending) return; // 过期响应（用户已重新生成或取消）
        crossScramblePending.delete(event.data.requestId!);
        if (event.data.scramble) pending.resolve(event.data.scramble);
        else pending.reject(new Error(event.data.error ?? "Cross 打乱生成失败"));
      };
      worker.onerror = (event) => {
        for (const pending of crossScramblePending.values()) {
          pending.reject(new Error(event.message || "Cross 打乱 Worker 无法启动"));
        }
        crossScramblePending.clear();
        crossScrambleWorker?.terminate();
        crossScrambleWorker = null;
      };
      crossScrambleWorker = worker;
      state.scramble.activeCrossScrambleWorker = worker;
    }
    return crossScrambleWorker;
  }

  function generateCrossScrambleInWorker(targetSteps: number): Promise<string> {
    const requestId = ++crossScrambleRequestId;
    return new Promise((resolve, reject) => {
      crossScramblePending.set(requestId, { resolve, reject });
      getCrossScrambleWorker().postMessage({ targetFace: "U", targetSteps, requestId });
    });
  }

  function generatePreferredScramble(): Promise<string> {
    if (state.scramble.selectedCrossSteps === null) return Promise.resolve(scramble333(20));
    return generateCrossScrambleInWorker(state.scramble.selectedCrossSteps);
  }

  /**
   * 实体已复原时不必回放“旧打乱 + 旧解法”的逆序；直接执行目标 setup 即可。
   * 未复原时保留完整实际动作链，才能从当前实体局面准确过渡。
   */
  function getCurrentTransitionMoves(): string[] {
    if (cubeVisualizer.getFacelets() === SOLVED_FACELET) return [];
    return [
      ...state.scramble.performedMoves,
      ...timer.getState().moves.map((move) => move.move),
    ];
  }

  function getTransitionScramble(targetMoves: string[]): string {
    return buildPracticeTransitionMoves(getCurrentTransitionMoves(), targetMoves).join(" ");
  }

  function loadGeneratedScramble(scramble: string): void {
    state.scramble.currentScramble = getTransitionScramble(scramble.trim().split(/\s+/).filter(Boolean));
    state.scramble.progress = createScrambleProgress(state.scramble.currentScramble);
    state.scramble.performedMoves = [];
    state.scramble.stateVerified = false;
    state.scramble.wrongMoveCount = 0;
    state.practice.awaitingNextScramble = false;
    state.practice.postSolveMove = null;
    timer.reset();
    timerDisplay.endInspection();
    timerDisplay.stopDisplay();
    timerDisplay.updateDisplay();
    els.btnStart.disabled = true;
    els.btnStop.disabled = true;
    renderProgress();
    void sendDiagnosticEvent({ kind: "scramble", occurredAt: Date.now(), scramble: state.scramble.currentScramble, mode: "normal" });
    log(`生成打乱: ${state.scramble.currentScramble.slice(0, 40)}${state.scramble.currentScramble.length > 40 ? "..." : ""}`);
    onNewScramble?.();
  }

  async function newScramble(): Promise<void> {
    if (state.practice.session) {
      preparePracticeScramble();
      return;
    }
    const generationId = ++state.scramble.generationId;
    // 指定难度由 Worker 筛选，不能在结果返回前继续显示或执行上一条打乱。
    // Worker 常驻复用，旧请求的响应按 requestId 丢弃，无需终止重建。
    state.scramble.currentScramble = "";
    state.scramble.progress = createScrambleProgress("");
    renderProgress();
    setScrambleGenerationPending(true);
    try {
      const scramble = await generatePreferredScramble();
      if (generationId === state.scramble.generationId) loadGeneratedScramble(scramble);
    } catch (error) {
      console.error("[scramble] 指定 Cross 打乱失败:", error);
      if (generationId === state.scramble.generationId) {
        log("指定 Cross 暂时未生成，已回退为 WCA 随机打乱", "error");
        loadGeneratedScramble(scramble333(20));
      }
    } finally {
      if (generationId === state.scramble.generationId) setScrambleGenerationPending(false);
    }
  }

  function prepareBlockScramble(mode: "cross" | "f2l" | "cross-f2l"): void {
    state.practice.blockMode = mode;
    state.practice.blockCompleted = false;
    const baseScramble = scramble333(20);
    const setupMoves = mode === "f2l" ? solveCross(baseScramble, "U") : [];
    state.scramble.currentScramble = getTransitionScramble([...baseScramble.split(" "), ...setupMoves]);
    state.scramble.progress = createScrambleProgress(state.scramble.currentScramble);
    state.scramble.performedMoves = [];
    state.scramble.stateVerified = false;
    state.scramble.wrongMoveCount = 0;
    state.practice.awaitingNextScramble = false;
    state.practice.postSolveMove = null;
    timer.reset();
    timerDisplay.endInspection();
    timerDisplay.stopDisplay();
    timerDisplay.updateDisplay();
    els.btnStart.disabled = true;
    els.btnStop.disabled = true;
    renderProgress();
    void sendDiagnosticEvent({ kind: "scramble", occurredAt: Date.now(), scramble: state.scramble.currentScramble, mode });
    log(mode === "cross" ? "已生成白面朝下 Cross 专项练习" : mode === "f2l" ? "已生成白色十字完成的 F2L 练习" : "已生成 Cross + F2L 练习");
    onNewScramble?.();
  }

  function preparePracticeScramble(): void {
    if (!state.practice.session) return;
    const targetSetupMoves = getFormulaSetupMoves(state.practice.session.formula);
    state.scramble.currentScramble = getTransitionScramble(targetSetupMoves);
    state.scramble.progress = createScrambleProgress(state.scramble.currentScramble);
    state.scramble.performedMoves = [];
    state.scramble.stateVerified = false;
    state.scramble.wrongMoveCount = 0;
    state.practice.awaitingNextScramble = false;
    state.practice.postSolveMove = null;
    timer.reset();
    timerDisplay.endInspection();
    timerDisplay.stopDisplay();
    timerDisplay.updateDisplay();
    els.btnStart.disabled = true;
    els.btnStop.disabled = true;
    state.practice.needsRetry = false;
    state.practice.caseVerified = false;
    renderProgress();
    void sendDiagnosticEvent({ kind: "scramble", occurredAt: Date.now(), scramble: state.scramble.currentScramble, mode: "formula", formulaId: state.practice.session.formula.id });
    practice.updateBanner();
    onNewScramble?.();
  }

  function renderProgress(): void {
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

  function updateOnMove(move: string): void {
    if (timer.getState().isRunning || state.scramble.progress.remaining.length === 0) return;

    const expected = state.scramble.progress.remaining[0];
    state.scramble.progress = applyScrambleMove(state.scramble.progress, move);
    renderProgress();

    if (state.scramble.progress.lastMoveCorrect === false) {
      state.scramble.wrongMoveCount++;
      log(`打乱转错：期望 ${expected}，已加入纠错步`, "error");
      if (shouldRegenerateScrambleAfterWrongMoves(state.scramble.wrongMoveCount)) {
        log("本次打乱累计错 6 步，已放弃当前纠错队列并生成新的打乱。", "error");
        void newScramble();
      }
    }
  }

  function verifyCompleted(): void {
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

  /** 打乱完成后以实体局面复核起点；不能把错误基线带入计时和 CFOP 回放。 */
  async function verifyPhysicalAndBeginInspection(): Promise<void> {
    if (state.scramble.isVerifyingPhysical || state.scramble.progress.remaining.length > 0 || timer.getState().isRunning) return;
    state.scramble.isVerifyingPhysical = true;
    try {
      const expectedFacelets = cubeVisualizer.getFacelets();
      const physicalFacelets = await ble.requestCurrentFacelets();
      if (state.scramble.progress.remaining.length > 0 || timer.getState().isRunning) return;
      const inSync = isPhysicalStateInSync(expectedFacelets, physicalFacelets);
      if (inSync === false) {
        const loaded = cubeVisualizer.loadFacelets(physicalFacelets ?? "");
        if (!loaded) {
          log("实体局面格式无效，无法建立本把基线。请重新连接智能魔方后再试。", "error");
          return;
        }
        state.scramble.stateVerified = false;
        log("实体局面与页面打乱终态不一致，已按实体局面重建 3D 起点。本把可计成绩；为避免错误 CFOP/AI，将仅保留计分。", "error");
      }
      if (inSync === null) {
        log("未提供可验证的实体打乱终态；已保留页面打乱与动作流基线。", "error");
      }
      if (!state.scramble.stateVerified) log("打乱动作序列回放存在差异，但实体局面已通过本次校验。", "error");
      timerDisplay.beginInspection();
    } finally {
      state.scramble.isVerifyingPhysical = false;
    }
  }

  function cancelGeneration(): void {
    state.scramble.generationId++;
    // 用户已开始转动魔方：放弃本次生成并释放 Worker，等待复原后重试。
    if (crossScrambleWorker) {
      crossScrambleWorker.terminate();
      crossScrambleWorker = null;
      state.scramble.activeCrossScrambleWorker = null;
    }
    for (const pending of crossScramblePending.values()) {
      pending.reject(new Error("已取消"));
    }
    crossScramblePending.clear();
    setScrambleGenerationPending(false);
  }

  function retryHistoryScramble(scramble: string): void {
    state.scramble.currentScramble = scramble;
    state.scramble.progress = createScrambleProgress(state.scramble.currentScramble);
    state.scramble.performedMoves = [];
    state.scramble.stateVerified = false;
    state.scramble.wrongMoveCount = 0;
    state.practice.awaitingNextScramble = false;
    state.practice.postSolveMove = null;
    timer.reset();
    timerDisplay.stopDisplay();
    timerDisplay.updateDisplay();
    els.btnStart.disabled = false;
    els.btnStop.disabled = true;
    cubeVisualizer.reset();
    renderProgress();
    window.scrollTo({ top: 0, behavior: "smooth" });
    log("重试历史打乱");
    onNewScramble?.();
  }

  function init(): void {
    els.crossStepSelector.querySelectorAll<HTMLButtonElement>("[data-cross-steps]").forEach((button) => {
      button.onclick = () => {
        const rawValue = button.dataset.crossSteps;
        state.scramble.selectedCrossSteps = rawValue && rawValue !== "random" ? Number(rawValue) : null;
        els.crossStepSelector.querySelectorAll<HTMLButtonElement>("[data-cross-steps]").forEach((item) => {
          item.classList.toggle("active", item === button);
        });
        log(state.scramble.selectedCrossSteps === null ? "已选择随机 Cross 打乱" : `已选择白色 Cross ${state.scramble.selectedCrossSteps} 步打乱`);
        void newScramble();
      };
    });
    els.btnNextScramble.onclick = () => { void newScramble(); };
    els.btnToggleScrambleSteps.onclick = () => {
      state.scramble.showFullScramble = !state.scramble.showFullScramble;
      els.btnToggleScrambleSteps.textContent = state.scramble.showFullScramble ? "仅看剩余" : "显示完整";
      renderProgress();
    };
  }

  return {
    init,
    newScramble,
    prepareBlockScramble,
    preparePracticeScramble,
    renderProgress,
    updateOnMove,
    verifyCompleted,
    verifyPhysicalAndBeginInspection,
    cancelGeneration,
    retryHistoryScramble,
  };
}
