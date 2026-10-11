/**
 * 专项练习生命周期：开始、完成单次、结束整轮、反馈与统计。
 *
 * 从 main.ts 抽出，保持与 scramble 准备 / 计时器 / 历史存储的松耦合（通过回调注入）。
 */

import type { Formula } from "../formula/types.ts";
import type { AppState, FormulaPracticeOrder, FormulaPracticeSession } from "./app-state.ts";
import { selectPracticeFormula, type PracticeRecord } from "./practice-stats.ts";
import { compareFormulaPractice } from "./practice-effect.ts";

export interface PracticeControllerElements {
  practiceBanner: HTMLElement;
  practiceInfo: HTMLElement;
  btnRetryPractice: HTMLButtonElement;
  resultNextAction: HTMLElement;
  practiceModal: HTMLElement;
  libraryModal: HTMLElement;
}

export interface PracticeControllerCallbacks {
  log: (msg: string, type?: "info" | "move" | "error") => void;
  /** 准备下一把练习打乱（含 scramble state / timer / cubeVisualizer 等副作用）。 */
  onPrepareScramble: () => void;
  /** 关闭结果弹窗（CFOP / Agent modal）。 */
  onCloseResultModals: () => void;
  /** 固定 CASE 专项完成后记录训练时点，用于后续实战迁移验证。 */
  onFixedFormulaSessionComplete?: (session: FormulaPracticeSession, completedAt: number) => void;
}

export function createPracticeController(
  els: PracticeControllerElements, state: AppState, cb: PracticeControllerCallbacks,
) {
  function completeAttempt(): boolean {
    if (!state.practice.session) return false;
    state.practice.session.completed++;
    if (state.practice.session.completed >= state.practice.session.target) {
      if (state.practice.session.candidates.length === 1) {
        cb.onFixedFormulaSessionComplete?.(state.practice.session, Date.now());
      }
      cb.log(`专项练习完成：${state.practice.session.formula.id}，共 ${state.practice.session.target} 次`);
      finish(true);
      return true;
    }
    if (state.practice.session.order === "sequential") {
      state.practice.session.formula =
        state.practice.session.candidates[state.practice.session.completed % state.practice.session.candidates.length];
    } else {
      state.practice.session.formula =
        selectPracticeFormula(state.practice.session.candidates, getPracticeRecords(state))
        ?? state.practice.session.formula;
    }
    cb.log(`完成第 ${state.practice.session.completed} 次，准备下一次`);
    cb.onPrepareScramble();
    return true;
  }

  function finish(completed = false): void {
    if (completed && state.practice.session) renderCompletion(els, state, state.practice.session);
    state.practice.session = null;
    state.practice.caseVerified = false;
    els.practiceBanner.hidden = true;
    state.practice.awaitingNextScramble = false;
    state.practice.postSolveMoves = [];
    cb.log("专项练习已结束");
  }

  function handleRetry(): void {
    if (!state.practice.session) return;
    state.practice.needsRetry = false;
    cb.onPrepareScramble();
    cb.log(`重新开始专项练习：${state.practice.session.formula.id}`);
  }

  return {
    start: (formula: Formula, target: number, candidates: Formula[], order: FormulaPracticeOrder) => start(els, state, cb, formula, target, candidates, order),
    completeAttempt, finish, handleRetry,
    updateBanner: () => updateBanner(els, state),
    renderCompletion: (session: FormulaPracticeSession) => renderCompletion(els, state, session),
    getPracticeRecords: () => getPracticeRecords(state),
  };
}

function start(els: PracticeControllerElements, state: AppState, cb: PracticeControllerCallbacks, formula: Formula, target: number, candidates: Formula[], order: FormulaPracticeOrder): void {
  state.practice.session = {
    formula, candidates, order, target,
    completed: 0, startedAt: Date.now(),
  };
  state.practice.pendingFormula = null;
  state.practice.pendingCandidates = [];
  els.practiceModal.classList.remove("open");
  els.libraryModal.classList.remove("open");
  cb.onCloseResultModals();
  cb.onPrepareScramble();
  window.scrollTo({ top: 0, behavior: "smooth" });
  cb.log(`开始专项练习：${formula.id}，目标 ${target} 次`);
}

function updateBanner(els: PracticeControllerElements, state: AppState): void {
  if (!state.practice.session) {
    els.practiceBanner.hidden = true;
    return;
  }
  els.practiceBanner.hidden = false;
  const next = state.practice.session.completed + 1;
  els.practiceInfo.textContent = state.practice.needsRetry
    ? `专项练习 ${state.practice.session.formula.id}：本 CASE 未还原，请重新开始`
    : `专项练习 ${state.practice.session.formula.id} · ${state.practice.session.formula.name}：第 ${next} 个 CASE · 共 ${state.practice.session.target} 个 CASE`;
  els.btnRetryPractice.hidden = !state.practice.needsRetry;
}

function formatTime(value: number | null): string {
  return value === null ? "—" : `${(value / 1000).toFixed(2)}s`;
}

function getPracticeRecords(state: AppState): PracticeRecord[] {
  return state.recentSolves.flatMap((solve) => {
    if (!solve.practiceKind || !solve.practiceOutcome) return [];
    return [{
      practiceKind: solve.practiceKind,
      formulaId: solve.practiceFormulaId,
      referenceAlgorithm: solve.practiceReferenceAlgorithm,
      duration: solve.totalDuration,
      outcome: solve.practiceOutcome,
      recognitionDuration: solve.recognitionDuration,
      executionDuration: solve.executionDuration,
      completedAt: solve.completedAt,
    }];
  });
}

function renderCompletion(els: PracticeControllerElements, state: AppState, session: FormulaPracticeSession): void {
  const records = state.recentSolves.filter(
    (solve) => solve.practiceKind === "formula" && (solve.completedAt ?? 0) >= session.startedAt,
  );
  const successes = records.filter((solve) => solve.practiceOutcome === "success");
  const average = successes.length === 0
    ? null
    : successes.reduce((sum, solve) => sum + solve.totalDuration, 0) / successes.length;
  const successRate = records.length === 0 ? 0 : successes.length / records.length;
  const fixedFormulaId = session.candidates.length === 1 ? session.candidates[0]?.id : undefined;
  const effect = fixedFormulaId
    ? compareFormulaPractice(getPracticeRecords(state), fixedFormulaId, session.startedAt)
    : null;
  const effectHtml = effect ? renderFormulaEffect(effect) : "";
  els.resultNextAction.innerHTML = `
    <div class="result-action-card practice-complete-card" aria-live="polite">
      <span>本轮训练完成</span>
      <strong>${session.target} 个 CASE 已完成</strong>
      <p>成功 ${successes.length}/${records.length} · 成功率 ${(successRate * 100).toFixed(0)}% · 平均用时 ${formatTime(average)}</p>
      ${effectHtml}
    </div>
  `;
}

function renderFormulaEffect(effect: ReturnType<typeof compareFormulaPractice>): string {
  const sessionExecution = formatTime(effect.session.averageExecutionDuration);
  if (!effect.baseline) {
    return `<div class="practice-effect"><strong>本 CASE 成效</strong><span>本轮执行均值 ${sessionExecution}；再完成一轮后即可开始比较进步。</span></div>`;
  }
  const successDelta = effect.successRateDelta === null ? "" : `成功率 ${formatPercentDelta(effect.successRateDelta)}`;
  const executionDelta = effect.executionDurationDelta === null ? "" : `执行 ${formatDurationDelta(effect.executionDurationDelta)}`;
  const executionNote = effect.executionComparable ? "" : "解法不同或缺少快照，暂不比较执行速度";
  const changes = [successDelta, executionDelta, executionNote].filter(Boolean).join(" · ") || "样本执行时间不足，暂只累计成功率";
  return `<div class="practice-effect"><strong>本 CASE 成效</strong><span>训练前 ${effect.baseline.attempts} 次 · ${(effect.baseline.successRate * 100).toFixed(0)}% · 执行 ${formatTime(effect.baseline.averageExecutionDuration)}</span><span>本轮 ${effect.session.attempts} 次 · ${(effect.session.successRate * 100).toFixed(0)}% · 执行 ${sessionExecution}</span><em>${changes}</em></div>`;
}

function formatPercentDelta(value: number): string {
  const points = Math.round(value * 100);
  return `${points >= 0 ? "+" : ""}${points}pp`;
}

function formatDurationDelta(value: number): string {
  const seconds = Math.abs(value) / 1000;
  return `${value <= 0 ? "快" : "慢"} ${seconds.toFixed(2)}s`;
}
