/**
 * 练习入口控制器：每日智能训练、分类练习筛选与练习弹窗按钮。
 *
 * 从 main.ts 抽出。控制器共享 AppState（practice 状态），通过依赖注入
 * 调用 PracticeController / FormulaLibraryController / ScrambleController，
 * 不直接依赖具体控制器实现。
 */

import { listByCategory } from "../formula/formula-library.ts";
import type { Formula, FormulaCategory } from "../formula/types.ts";
import { isFormulaDevicePracticeSafe } from "../formula/setup-validation.ts";
import { selectPracticeFormula, type PracticeRecord } from "../core/practice-stats.ts";
import type { AppState, FormulaPracticeOrder } from "../core/app-state.ts";
import type { BlockPracticeMode } from "../../src-shared/analysis-types.ts";

/** 练习入口所需 DOM 元素 */
export interface PracticeEntryElements {
  practiceModeModal: HTMLElement;
  formulaPracticeDifficulty: HTMLSelectElement;
  formulaPracticeUnmastered: HTMLInputElement;
  formulaPracticeOrder: HTMLSelectElement;
  practiceFormulaName: HTMLElement;
  practiceModal: HTMLElement;
  practiceCount: HTMLInputElement;
  btnOpenPracticeMode: HTMLButtonElement;
  btnClosePracticeMode: HTMLButtonElement;
  btnStartDailyPractice: HTMLButtonElement;
  btnCancelPractice: HTMLButtonElement;
  btnClosePractice: HTMLButtonElement;
  btnStartPractice: HTMLButtonElement;
  btnEndPractice: HTMLButtonElement;
  btnRetryPractice: HTMLButtonElement;
}

/** 结构化依赖：只声明实际用到的方法，避免与具体控制器实现耦合。 */
export interface PracticeEntryDependencies {
  practice: {
    start: (formula: Formula, target: number, candidates: Formula[], order: FormulaPracticeOrder) => void;
    getPracticeRecords: () => PracticeRecord[];
    finish: () => void;
    handleRetry: () => void;
  };
  formulaLibrary: {
    resolvePracticeFormula: (formula: Formula) => Formula;
    isMastered: (id: string) => boolean;
    hasPendingPractice: () => boolean;
    cancelPractice: () => void;
    confirmPractice: () => void;
  };
  scramble: {
    prepareBlockScramble: (mode: BlockPracticeMode) => void;
    endBlockPractice: () => void;
  };
  openPrediction: () => void;
  isRunning: () => boolean;
  log: (msg: string, type?: "info" | "move" | "error") => void;
}

export interface PracticeEntryController {
  init(): void;
}

function openCategoryPractice(
  els: PracticeEntryElements, state: AppState, deps: PracticeEntryDependencies, category: "OLL" | "PLL" | "OLL-PLL",
): void {
  const { practice, formulaLibrary, log } = deps;
  const allFormulas = category === "OLL-PLL"
    ? [...listByCategory("OLL"), ...listByCategory("PLL")]
    : listByCategory(category);
  const maxDifficulty = Number(els.formulaPracticeDifficulty.value);
  const onlyUnmastered = els.formulaPracticeUnmastered.checked;
  const formulas = allFormulas.filter((formula) =>
    formula.difficulty <= maxDifficulty
    && (!onlyUnmastered || !formulaLibrary.isMastered(formula.id))
    && isFormulaDevicePracticeSafe(formula));
  const order = els.formulaPracticeOrder.value as FormulaPracticeOrder;
  const sorted = [...formulas].sort((a, b) => a.id.localeCompare(b.id));
  const formula = order === "sequential" ? sorted[0] : selectPracticeFormula(sorted, practice.getPracticeRecords());
  if (formulas.length === 0) {
    log("没有符合当前筛选且适合智能魔方记录的公式", "error");
    return;
  }
  if (!formula) return;
  state.practice.pendingFormula = formula;
  state.practice.pendingCandidates = sorted;
  state.practice.pendingOrder = order;
  els.practiceModeModal.classList.remove("open");
  els.practiceFormulaName.textContent = `${formula.id}（${order === "random" ? "智能随机" : "顺序"}，${sorted.length} 个公式）`;
  els.practiceModal.classList.add("open");
  log(`准备${category === "OLL-PLL" ? "OLL + PLL" : category} 练习：${formula.id}`);
}

export function createPracticeEntryController(
  els: PracticeEntryElements, state: AppState, deps: PracticeEntryDependencies,
): PracticeEntryController {
  const { practice, formulaLibrary, scramble, log } = deps;

  function startDailyPractice(): void {
    const candidates = (["F2L", "OLL", "PLL"] as FormulaCategory[])
      .flatMap((category) => listByCategory(category))
      .map((formula) => formulaLibrary.resolvePracticeFormula(formula))
      .filter(isFormulaDevicePracticeSafe)
      .sort((a, b) => a.id.localeCompare(b.id));
    const formula = selectPracticeFormula(candidates, practice.getPracticeRecords());
    if (!formula) {
      log("今日训练没有可用于智能魔方的公式", "error");
      return;
    }
    els.practiceModeModal.classList.remove("open");
    practice.start(formula, 10, candidates, "random");
    log(`开始今日智能训练：${formula.id}，共 10 个 CASE`);
  }

  function cancelPracticeSelection(): void {
    if (formulaLibrary.hasPendingPractice()) {
      formulaLibrary.cancelPractice();
      return;
    }
    state.practice.pendingFormula = null;
    state.practice.pendingCandidates = [];
    els.practiceModal.classList.remove("open");
  }

  function startSelectedPractice(): void {
    if (formulaLibrary.hasPendingPractice()) {
      formulaLibrary.confirmPractice();
      return;
    }
    if (!state.practice.pendingFormula) return;
    const target = Math.max(1, Math.min(100, Math.floor(Number(els.practiceCount.value) || 1)));
    practice.start(
      state.practice.pendingFormula,
      target,
      state.practice.pendingCandidates.length > 0 ? state.practice.pendingCandidates : [state.practice.pendingFormula],
      state.practice.pendingOrder,
    );
  }

  function endPracticeSession(): void {
    if (state.practice.blockMode) { scramble.endBlockPractice(); return; }
    if (!state.practice.session) return;
    log(`已终止专项练习：${state.practice.session.formula.id}`);
    practice.finish();
  }

  function init(): void {
    els.btnOpenPracticeMode.onclick = () => {
      if (deps.isRunning()) { log("请先完成或停止当前计时，再选择专项", "error"); return; }
      els.practiceModeModal.classList.add("open");
    };
    els.btnClosePracticeMode.onclick = () => els.practiceModeModal.classList.remove("open");
    els.btnStartDailyPractice.onclick = startDailyPractice;
    els.practiceModeModal.querySelectorAll<HTMLButtonElement>("[data-practice-mode]").forEach((button) => {
      button.onclick = () => openCategoryPractice(els, state, deps, button.dataset.practiceMode as "OLL" | "PLL" | "OLL-PLL");
    });
    els.practiceModeModal.querySelectorAll<HTMLButtonElement>("[data-block-practice-mode]").forEach((button) => {
      button.onclick = () => {
        const mode = button.dataset.blockPracticeMode as BlockPracticeMode | undefined;
        if (!mode) return;
        if (deps.isRunning()) { log("请先完成或停止当前计时", "error"); return; }
        els.practiceModeModal.classList.remove("open");
        scramble.prepareBlockScramble(mode);
      };
    });
    els.practiceModeModal.querySelector<HTMLButtonElement>("[data-open-prediction]")!.onclick = () => {
      els.practiceModeModal.classList.remove("open");
      deps.openPrediction();
    };
    els.btnCancelPractice.onclick = cancelPracticeSelection;
    els.btnClosePractice.onclick = cancelPracticeSelection;
    els.btnStartPractice.onclick = startSelectedPractice;
    els.btnEndPractice.onclick = endPracticeSession;
    els.btnRetryPractice.onclick = () => {
      practice.handleRetry();
    };
  }

  return { init };
}
