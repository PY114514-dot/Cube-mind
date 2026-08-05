/**
 * scramble-controller.ts
 * 打乱生成与练习模式控制器
 */

import { scramble333 } from "../scramble/scramble-333.ts";
import { createScrambleProgress, applyScrambleMove, type ScrambleProgress } from "../core/scramble-tracker.ts";
import { solveCross, solveXCross, convertSolutionForWhiteDown } from "../core/cross-solver.ts";
import { getFormulaSetupMoves } from "../formula/setup-validation.ts";
import { selectPracticeFormula, type PracticeRecord } from "../core/practice-stats.ts";
import type { Formula, FormulaCategory } from "../formula/types.ts";
import { listByCategory } from "../formula/formula-library.ts";
import { isFormulaDevicePracticeSafe } from "../formula/setup-validation.ts";
import type { TimerDisplayController } from "./timer-display-controller.ts";
import type { CubeVisualizer } from "../ui/cube-visualizer.ts";
import type { FormulaLibraryController } from "./formula-library-controller.ts";
import { sendDiagnosticEvent, type DiagnosticMode } from "../core/diagnostics-client.ts";

export interface ScrambleControllerElements {
  scrambleText: HTMLDivElement;
  btnNextScramble: HTMLButtonElement;
  btnToggleScrambleSteps: HTMLButtonElement;
  btnToggleCrossSettings: HTMLButtonElement;
  crossTrainingSettings: HTMLDivElement;
  crossStepSelector: HTMLDivElement;
  btnSolveCross: HTMLButtonElement;
  btnSolveXCross: HTMLButtonElement;
  crossSolution: HTMLDivElement;
  xcrossSolution: HTMLDivElement;
  btnOpenPracticeMode: HTMLButtonElement;
  practiceModeModal: HTMLDivElement;
  btnClosePracticeMode: HTMLButtonElement;
  btnStartDailyPractice: HTMLButtonElement;
  formulaPracticeOrder: HTMLSelectElement;
  formulaPracticeDifficulty: HTMLSelectElement;
  formulaPracticeUnmastered: HTMLInputElement;
  practiceModal: HTMLDivElement;
  practiceFormulaName: HTMLElement;
  practiceCount: HTMLInputElement;
}

export interface ScrambleControllerOptions {
  elements: ScrambleControllerElements;
  getSettings: () => { crossMaxSteps: number };
  getPracticeRecords: () => PracticeRecord[];
  onStartPractice: (formula: Formula, target: number, candidates: Formula[], order: "random" | "sequential") => void;
  timerDisplay: TimerDisplayController;
  cubeVisualizer: CubeVisualizer;
  log: (msg: string, type?: "info" | "move" | "error") => void;
  escapeHtml: (s: string) => string;
}

export interface ScrambleState {
  currentScramble: string;
  scrambleProgress: ScrambleProgress;
  performedScrambleMoves: string[];
  scrambleStateVerified: boolean;
  selectedCrossSteps: number | null;
  showFullScramble: boolean;
  activeWorker: Worker | null;
  generationId: number;
}

export type PracticeSession = {
  formula: Formula;
  candidates: Formula[];
  order: "random" | "sequential";
  target: number;
  completed: number;
  startedAt: number;
  lastFeedback: string | null;
} | null;

export function createScrambleController(options: ScrambleControllerOptions) {
  const { elements, getSettings, getPracticeRecords, onStartPractice, timerDisplay, cubeVisualizer, log, escapeHtml } = options;

  let state: ScrambleState = {
    currentScramble: "",
    scrambleProgress: createScrambleProgress(""),
    performedScrambleMoves: [],
    scrambleStateVerified: false,
    selectedCrossSteps: null,
    showFullScramble: false,
    activeWorker: null,
    generationId: 0,
  };

  let practiceSession: PracticeSession = null;
  let practiceNeedsRetry = false;
  let practiceCaseVerified = false;

  // ====== 打乱生成 ======
  function setScrambleGenerationPending(pending: boolean): void {
    elements.btnNextScramble.disabled = pending;
    elements.btnNextScramble.textContent = pending ? "生成中…" : "新打乱";
    elements.crossStepSelector.querySelectorAll<HTMLButtonElement>("[data-cross-steps]").forEach((button) => {
      button.disabled = pending;
    });
  }

  function generateCrossScrambleInWorker(targetSteps: number): Promise<string> {
    state.activeWorker?.terminate();
    const worker = new Worker("./cross-scramble-worker.js");
    state.activeWorker = worker;
    return new Promise((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<{ scramble?: string; error?: string }>) => {
        worker.terminate();
        if (state.activeWorker === worker) state.activeWorker = null;
        if (event.data.scramble) resolve(event.data.scramble);
        else reject(new Error(event.data.error ?? "Cross 打乱生成失败"));
      };
      worker.onerror = (event) => {
        worker.terminate();
        if (state.activeWorker === worker) state.activeWorker = null;
        reject(new Error(event.message || "Cross 打乱 Worker 无法启动"));
      };
      worker.postMessage({ targetFace: "U", targetSteps });
    });
  }

  function generatePreferredScramble(): Promise<string> {
    if (state.selectedCrossSteps === null) return Promise.resolve(scramble333(20));
    return generateCrossScrambleInWorker(state.selectedCrossSteps);
  }

  function loadGeneratedScramble(scramble: string): void {
    state.currentScramble = scramble.trim();
    state.scrambleProgress = createScrambleProgress(state.currentScramble);
    state.performedScrambleMoves = [];
    state.scrambleStateVerified = false;
    timerDisplay.endInspection();
    timerDisplay.stopDisplay();
    timerDisplay.updateDisplay();
    cubeVisualizer.reset();
    renderScrambleProgress();
    void sendDiagnosticEvent({ kind: "scramble", occurredAt: Date.now(), scramble: state.currentScramble, mode: "normal" });
    log(`生成打乱: ${state.currentScramble.slice(0, 40)}${state.currentScramble.length > 40 ? "..." : ""}`);
  }

  async function newScramble(): Promise<void> {
    if (practiceSession) {
      preparePracticeScramble();
      return;
    }
    const generationId = ++state.generationId;
    state.activeWorker?.terminate();
    state.activeWorker = null;
    setScrambleGenerationPending(state.selectedCrossSteps !== null);
    try {
      const scramble = await generatePreferredScramble();
      if (generationId === state.generationId) loadGeneratedScramble(scramble);
    } catch (error) {
      console.error("[scramble] 指定 Cross 打乱失败:", error);
      if (generationId === state.generationId) {
        log("指定 Cross 暂时未生成，已回退为 WCA 随机打乱", "error");
        loadGeneratedScramble(scramble333(20));
      }
    } finally {
      if (generationId === state.generationId) setScrambleGenerationPending(false);
    }
  }

  // ====== 打乱进度渲染 ======
  function renderScrambleProgress(): void {
    if (state.showFullScramble) {
      const completedCount = state.scrambleProgress.completed.length;
      const allMoves = state.scrambleProgress.completed.concat(state.scrambleProgress.remaining);
      elements.scrambleText.innerHTML = allMoves.map((move, index) => {
        const isCompleted = index < completedCount;
        const isNext = !isCompleted && index === completedCount;
        return `<span class="scramble-move ${isCompleted ? "completed" : ""} ${isNext ? "next" : ""}">${escapeHtml(move)}</span>`;
      }).join(" ");
      return;
    }
    elements.scrambleText.innerHTML = state.scrambleProgress.remaining.map(
      (move, index) => `<span class="scramble-move ${index === 0 ? "next" : ""}">${escapeHtml(move)}</span>`
    ).join(" ");
  }

  function updateScrambleProgress(move: string): ScrambleProgress {
    if (state.scrambleProgress.remaining.length === 0) return state.scrambleProgress;
    state.scrambleProgress = applyScrambleProgress(state.scrambleProgress, move);
    renderScrambleProgress();
    return state.scrambleProgress;
  }

  function applyScrambleProgress(progress: ScrambleProgress, move: string): ScrambleProgress {
    return applyScrambleMove(progress, move);
  }

  function verifyCompletedScramble(isVerified: boolean): void {
    state.scrambleStateVerified = isVerified;
  }

  function getScrambleState() {
    return state;
  }

  function getPracticeSession() {
    return practiceSession;
  }

  function setPracticeSession(session: PracticeSession) {
    practiceSession = session;
  }

  function getPracticeNeedsRetry() {
    return practiceNeedsRetry;
  }

  function setPracticeNeedsRetry(needsRetry: boolean) {
    practiceNeedsRetry = needsRetry;
  }

  function getPracticeCaseVerified() {
    return practiceCaseVerified;
  }

  function setPracticeCaseVerified(verified: boolean) {
    practiceCaseVerified = verified;
  }

  // ====== Cross 求解 ======
  function handleSolveCross(): void {
    if (!state.currentScramble) {
      elements.crossSolution.hidden = false;
      elements.crossSolution.textContent = "请先生成打乱。";
      return;
    }
    elements.btnSolveCross.disabled = true;
    elements.crossSolution.hidden = false;
    elements.crossSolution.textContent = "正在计算十字解法…";
    window.setTimeout(() => {
      try {
        const targetFace = "U";
        const solution = solveCross(state.currentScramble, targetFace, getSettings().crossMaxSteps);
        const displaySolution = convertSolutionForWhiteDown(solution, "F");
        const difficulty = solution.length <= 4 ? "简单" : solution.length <= 6 ? "中等" : "困难";
        elements.crossSolution.innerHTML = solution.length > 0
          ? `白色 Cross（绿面前）：<code>${escapeHtml(displaySolution.join(" "))}</code>（${solution.length} 步，${difficulty}）`
          : `未在 ${getSettings().crossMaxSteps} 步搜索范围内找到十字解法。`;
      } catch (error) {
        console.error("[cross-solver] 求解失败:", error);
        elements.crossSolution.textContent = "十字求解失败，请重新生成打乱。";
      } finally {
        elements.btnSolveCross.disabled = false;
      }
    }, 0);
  }

  function handleSolveXCross(): void {
    if (!state.currentScramble) {
      elements.xcrossSolution.hidden = false;
      elements.xcrossSolution.textContent = "请先生成打乱。";
      return;
    }
    const targetFace = "U";
    elements.btnSolveXCross.disabled = true;
    elements.xcrossSolution.hidden = false;
    elements.xcrossSolution.innerHTML = "正在比较四个 X-Cross 槽位…";
    window.setTimeout(() => {
      try {
        const colorNames: Record<string, string> = { U: "白", R: "红", F: "绿", D: "黄", L: "橙", B: "蓝" };
        const slotNames: Record<string, Record<string, string>> = {
          D: { F: "绿-红", R: "红-蓝", B: "蓝-橙", L: "橙-绿" },
          U: { F: "绿-橙", R: "红-绿", B: "蓝-红", L: "橙-蓝" },
        };
        const frontOrder = ["R", "B", "L", "F"];
        const holdOrder = ["F", "R", "B", "L"];
        const holdNames: Record<string, string> = {
          F: "白底绿前", R: "白底红前", B: "白底蓝前", L: "白底橙前",
        };
        const candidates = frontOrder.map((frontFace) => ({
          frontFace,
          solution: solveXCross(state.currentScramble, targetFace, frontFace),
        }));
        const best = [...candidates].filter((item) => item.solution.length > 0)
          .sort((a, b) => a.solution.length - b.solution.length)[0];
        const bestPair = best ? (slotNames[targetFace]?.[best.frontFace] ?? `${colorNames[targetFace]}-${colorNames[best.frontFace]}`) : "未找到";
        const heading = best
          ? `<div class="xcross-recommendation"><strong>推荐：${bestPair} X-Cross</strong><span>${best.solution.length} 步，优先做${bestPair}槽</span></div>`
          : `<div class="xcross-recommendation"><strong>暂未找到 X-Cross</strong><span>可尝试更短的打乱或普通 Cross</span></div>`;
        const candidateSummary = candidates.map(({ frontFace, solution }) => {
          const slotName = slotNames[targetFace]?.[frontFace] ?? `${colorNames[targetFace]}-${colorNames[frontFace]}`;
          return `${slotName}${solution.length > 0 ? ` ${solution.length}步` : " 未找到"}`;
        }).join(" · ");
        const rows = best
          ? holdOrder.map((holdFace) => {
            const formula = convertSolutionForWhiteDown(best.solution, holdFace).join(" ");
            return `<div class="xcross-row"><strong>${holdNames[holdFace]}</strong><code>${formula}</code><span>${best.solution.length} 步</span></div>`;
          })
          : [];
        elements.xcrossSolution.innerHTML = heading
          + (rows.length > 0 ? `<div class="xcross-directions">${rows.join("")}</div>` : "")
          + `<div class="xcross-meta">后台比较：${candidateSummary}</div>`;
      } catch (error) {
        console.error("[cross-solver] X-Cross 求解失败:", error);
        elements.xcrossSolution.textContent = "X-Cross 求解失败，请重新生成打乱。";
      } finally {
        elements.btnSolveXCross.disabled = false;
      }
    }, 0);
  }

  // ====== 练习模式 ======
  function preparePracticeScramble(): void {
    if (!practiceSession) return;
    state.currentScramble = getFormulaSetupMoves(practiceSession.formula).join(" ");
    state.scrambleProgress = createScrambleProgress(state.currentScramble);
    state.performedScrambleMoves = [];
    state.scrambleStateVerified = false;
    timerDisplay.endInspection();
    timerDisplay.stopDisplay();
    timerDisplay.updateDisplay();
    cubeVisualizer.reset();
    practiceNeedsRetry = false;
    practiceCaseVerified = false;
    renderScrambleProgress();
    void sendDiagnosticEvent({ kind: "scramble", occurredAt: Date.now(), scramble: state.currentScramble, mode: "formula", formulaId: practiceSession.formula.id });
  }

  function startDailyPractice(): void {
    const candidates = (["F2L", "OLL", "PLL"] as FormulaCategory[])
      .flatMap((category) => listByCategory(category))
      .filter(isFormulaDevicePracticeSafe)
      .sort((a, b) => a.id.localeCompare(b.id));
    const formula = selectPracticeFormula(candidates, getPracticeRecords());
    if (!formula) {
      log("今日训练没有可用于智能魔方的公式", "error");
      return;
    }
    elements.practiceModeModal.classList.remove("open");
    onStartPractice(formula, 10, candidates, "random");
    log(`开始今日智能训练：${formula.id}，共 10 题`);
  }

  function openCategoryPractice(category: "OLL" | "PLL" | "OLL-PLL"): void {
    const allFormulas = category === "OLL-PLL"
      ? [...listByCategory("OLL"), ...listByCategory("PLL")]
      : listByCategory(category);
    const maxDifficulty = Number(elements.formulaPracticeDifficulty.value);
    const onlyUnmastered = elements.formulaPracticeUnmastered.checked;
    const formulas = allFormulas.filter((formula) =>
      formula.difficulty <= maxDifficulty && !onlyUnmastered && isFormulaDevicePracticeSafe(formula));
    const order = elements.formulaPracticeOrder.value as "random" | "sequential";
    const sorted = [...formulas].sort((a, b) => a.id.localeCompare(b.id));
    const formula = order === "sequential" ? sorted[0] : selectPracticeFormula(sorted, getPracticeRecords());
    if (formulas.length === 0) {
      log("没有符合当前筛选且适合智能魔方记录的公式", "error");
      return;
    }
    if (!formula) return;
    elements.practiceModeModal.classList.remove("open");
    elements.practiceFormulaName.textContent = `${formula.id} · ${formula.name}（${order === "random" ? "智能随机" : "顺序"}，${sorted.length} 个公式）`;
    elements.practiceModal.classList.add("open");
  }

  // ====== 绑定事件 ======
  function bindEvents() {
    elements.crossStepSelector.querySelectorAll<HTMLButtonElement>("[data-cross-steps]").forEach((button) => {
      button.onclick = () => {
        const rawValue = button.dataset.crossSteps;
        state.selectedCrossSteps = rawValue && rawValue !== "random" ? Number(rawValue) : null;
        elements.crossStepSelector.querySelectorAll<HTMLButtonElement>("[data-cross-steps]").forEach((item) => {
          item.classList.toggle("active", item === button);
        });
        log(state.selectedCrossSteps === null ? "已选择随机 Cross 打乱" : `已选择白色 Cross ${state.selectedCrossSteps} 步打乱`);
        newScramble();
      };
    });

    elements.btnNextScramble.onclick = () => newScramble();
    elements.btnToggleScrambleSteps.onclick = () => {
      state.showFullScramble = !state.showFullScramble;
      elements.btnToggleScrambleSteps.textContent = state.showFullScramble ? "仅看剩余" : "显示完整";
      renderScrambleProgress();
    };
    elements.btnToggleCrossSettings.onclick = () => {
      const isExpanded = elements.btnToggleCrossSettings.getAttribute("aria-expanded") === "true";
      elements.btnToggleCrossSettings.setAttribute("aria-expanded", String(!isExpanded));
      elements.btnToggleCrossSettings.textContent = isExpanded ? "＋" : "−";
      elements.crossTrainingSettings.hidden = isExpanded;
    };
    elements.btnSolveCross.onclick = handleSolveCross;
    elements.btnSolveXCross.onclick = handleSolveXCross;
    elements.btnOpenPracticeMode.onclick = () => elements.practiceModeModal.classList.add("open");
    elements.btnClosePracticeMode.onclick = () => elements.practiceModeModal.classList.remove("open");
    elements.btnStartDailyPractice.onclick = startDailyPractice;
    elements.practiceModeModal.querySelectorAll<HTMLButtonElement>("[data-practice-mode]").forEach((button) => {
      button.onclick = () => openCategoryPractice(button.dataset.practiceMode as "OLL" | "PLL" | "OLL-PLL");
    });
  }

  // 初始化时加载第一把打乱
  function init() {
    bindEvents();
    newScramble();
  }

  return {
    init,
    newScramble,
    getScrambleState,
    getPracticeSession,
    setPracticeSession,
    getPracticeNeedsRetry,
    setPracticeNeedsRetry,
    getPracticeCaseVerified,
    setPracticeCaseVerified,
    preparePracticeScramble,
    renderScrambleProgress,
    updateScrambleProgress,
    verifyCompletedScramble,
  };
}
