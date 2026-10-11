/**
 * training-controller.ts
 * 训练计划渲染与更新控制器
 *
 * 职责：
 *   - 渲染训练计划卡片（含公式练习跳转入口）
 *   - 分析完成后更新训练计划（追加快照 → 更新/生成计划 → 保存 → 重渲染）
 */

import { loadPlan, savePlan, appendAnalysisSnapshot, loadAnalysisHistory, snapshotsToResults } from "../core/training-plan-store.ts";
import { aggregateIssues, generatePlan, updatePlanProgress, getTodayTask, isFormulaTrainingStage } from "../core/training-plan-engine.ts";
import { pickPlanFormulas, formatPickLabel } from "../core/plan-formula-picker.ts";
import { pickNextCaseTraining } from "../core/case-coach.ts";
import { buildCaseTransferProgress } from "../core/case-transfer.ts";
import { loadAssignments } from "../core/assignment-store.ts";
import { formatCaseTransferFeedback } from "../ui/case-transfer-feedback.ts";
import { loadTrainingProfile } from "../core/training-profile-store.ts";
import { getFormulaById, listByCategory } from "../formula/formula-library.ts";
import { isFormulaDevicePracticeSafe } from "../formula/setup-validation.ts";
import type { PracticeRecord } from "../core/practice-stats.ts";
import type { AnalysisInput } from "../agent/types.ts";
import type { AnalysisResult } from "../agent/types.ts";
import type { FormulaLibraryController } from "./formula-library-controller.ts";

export interface TrainingControllerElements {
  trainingPlanContainer: HTMLDivElement;
  trainingDashboard: HTMLDivElement;
}

export interface TrainingControllerOptions {
  elements: TrainingControllerElements;
  formulaLibrary: FormulaLibraryController;
  log: (msg: string, type?: "info" | "error") => void;
  escapeHtml: (s: string) => string;
  /** 当前会话练习记录（今日公式推荐的掌握度来源，composition 注入）。 */
  getPracticeRecords: () => PracticeRecord[];
  /** 常规复原历史：自动教练只消费已可信的 caseEvents。 */
  getSolves: () => AnalysisInput[];
}

function bindFormulaButtons(container: HTMLElement, options: TrainingControllerOptions): void {
  const { formulaLibrary, log } = options;
  container.querySelectorAll<HTMLButtonElement>("[data-training-formula]").forEach((button) => {
    button.addEventListener("click", () => {
      const formulaId = button.dataset.trainingFormula;
      if (!formulaId) return;
      formulaLibrary.openFormulaPractice(formulaId);
      log(`开始专项练习：${formulaId}`);
    });
  });
}

function renderPlanFormulas(stage: "F2L" | "OLL" | "PLL" | null, options: TrainingControllerOptions): string {
  const { formulaLibrary, getPracticeRecords, escapeHtml } = options;
  if (!stage) return "";
  const picks = pickPlanFormulas({
    stage,
    formulas: listByCategory(stage).filter(isFormulaDevicePracticeSafe).map((formula) => ({ id: formula.id, difficulty: formula.difficulty })),
    records: getPracticeRecords(),
    profile: loadTrainingProfile().entries,
    isMastered: (id) => formulaLibrary.isMastered(id),
  });
  if (picks.length === 0) return "";
  return `<div class="plan-formulas"><div class="plan-formulas-label">今日公式练习</div><ul class="plan-formula-list">${picks.map((pick) => `<li><button class="plan-formula-btn" type="button" data-training-formula="${escapeHtml(pick.formulaId)}"><strong>${escapeHtml(pick.formulaId)}</strong><small>${escapeHtml(formatPickLabel(pick))}</small></button></li>`).join("")}</ul></div>`;
}

export function createTrainingController(options: TrainingControllerOptions) {
  const { elements, formulaLibrary, log, escapeHtml, getSolves } = options;

  function renderDashboard(): void {
    const solves = getSolves();
    const recommendation = pickNextCaseTraining(solves);
    const formula = recommendation ? getFormulaById(recommendation.formulaId) : undefined;
    const coachHtml = recommendation && formula && isFormulaDevicePracticeSafe(formula)
      ? `<div class="case-coach-card"><span>根据最近实战推荐</span><strong>${escapeHtml(formula.id)} · ${escapeHtml(formula.name)}</strong><p>${escapeHtml(recommendation.reason)}</p><button class="practice-btn" type="button" data-training-formula="${escapeHtml(formula.id)}">开始 10 次专项</button></div>`
      : `<div class="case-coach-card"><span>训练准备</span><strong>先记录几把复原</strong><p>重复遇到同一 CASE 后，根据识别停顿和步数推荐专项。也可以从公式库选择练习。</p><button class="ghost" type="button" data-open-training-library>选择公式练习</button></div>`;
    const transfers = buildCaseTransferProgress(loadAssignments(), solves).slice(0, 3);
    const transferHtml = transfers.length === 0 ? ""
      : `<div class="case-transfer"><strong>练习后的实战表现</strong>${transfers.map((progress) => `<p>${escapeHtml(formatCaseTransferFeedback(progress))}</p>`).join("")}</div>`;
    elements.trainingDashboard.innerHTML = coachHtml + transferHtml;
    bindFormulaButtons(elements.trainingDashboard, options);
    elements.trainingDashboard.querySelector<HTMLButtonElement>("[data-open-training-library]")?.addEventListener("click", () => formulaLibrary.openCategory("F2L"));
  }

  /** 主页面反馈随成绩刷新；多日计划仍在 AI 教练中展示。 */
  function renderPlan(): void {
    renderDashboard();
    const plan = loadPlan();
    if (!plan) {
      elements.trainingPlanContainer.innerHTML = "";
      return;
    }
    const progress = plan.status === "graduated" ? 100 : Math.round((plan.completedDays / plan.days.length) * 100);
    const today = getTodayTask(plan);
    const statusText = plan.status === "graduated" ? "已完成" : `第 ${plan.completedDays + 1}/${plan.days.length} 天`;
    const formulaStage = isFormulaTrainingStage(today?.focus) ? today.focus : null;
    const drillsHtml = today ? `<ul class="plan-drills">${today.drills.map((drill) => `<li>${escapeHtml(drill)}</li>`).join("")}</ul>` : "";
    const targetHtml = today ? `<div class="plan-target">目标：${escapeHtml(today.targetMetric)}</div>` : "";
    const practiceLink = formulaStage ? `<button id="btn-plan-formula-practice" class="practice-btn" type="button">练习 ${formulaStage} 公式</button>` : "";
    elements.trainingPlanContainer.innerHTML = `
      <div class="plan-card ${plan.status === "graduated" ? "graduated" : ""}">
        <div class="plan-header"><span class="plan-title">${plan.status === "graduated" ? "训练计划（已完成）" : "训练计划"}</span><span class="plan-stage-tag">${escapeHtml(plan.targetStage)} · ${statusText}</span></div>
        <div class="plan-progress-bar"><div class="plan-progress-fill" style="width:${progress}%"></div></div>
        <div class="plan-today"><div class="plan-today-label">${plan.status === "graduated" ? "计划已完成" : "今日训练"}</div>${drillsHtml}${targetHtml}${renderPlanFormulas(formulaStage, options)}${practiceLink}</div>
      </div>`;
    bindFormulaButtons(elements.trainingPlanContainer, options);
    if (formulaStage) {
      elements.trainingPlanContainer.querySelector<HTMLButtonElement>("#btn-plan-formula-practice")?.addEventListener("click", () => {
        formulaLibrary.openForBottleneck(formulaStage, 0, 0);
        log(`训练计划跳转到 ${formulaStage} 公式练习`);
      });
    }
  }

  /** 分析完成后更新训练计划（追加快照 → 更新/生成计划 → 保存 → 重渲染） */
  function handlePlanAfterAnalysis(result: AnalysisResult): void {
    appendAnalysisSnapshot(result);
    let plan = loadPlan();
    if (plan && plan.status === "active") {
      plan = updatePlanProgress(plan, result);
      savePlan(plan);
    } else if (!plan) {
      // 没有活跃计划时，积累足够样本后自动生成
      const history = loadAnalysisHistory();
      if (history.length >= 3) {
        const agg = aggregateIssues(snapshotsToResults(history));
        const latestDrills = result.drills;
        plan = generatePlan(agg, latestDrills);
        savePlan(plan);
      }
    }
    renderPlan();
  }

  return {
    renderPlan,
    handlePlanAfterAnalysis,
  };
}
