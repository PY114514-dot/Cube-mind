/**
 * training-controller.ts
 * 训练计划与 AI 分析结果处理控制器
 */

import { loadPlan, savePlan, appendAnalysisSnapshot, loadAnalysisHistory, snapshotsToResults } from "../core/training-plan-store.ts";
import { aggregateIssues, generatePlan, updatePlanProgress, getTodayTask } from "../core/training-plan-engine.ts";
import type { AnalysisResult } from "../agent/types.ts";

export interface TrainingControllerElements {
  trainingPlanContainer: HTMLDivElement;
  agentOutput: HTMLDivElement;
}

export interface TrainingControllerOptions {
  elements: TrainingControllerElements;
  getAnalysisHistory: () => AnalysisResult[];
  log: (msg: string, type?: "info" | "error") => void;
  escapeHtml: (s: string) => string;
}

export function createTrainingController(options: TrainingControllerOptions) {
  const { elements, getAnalysisHistory, log, escapeHtml } = options;

  /** 渲染训练计划卡片 */
  function renderTrainingPlan(): void {
    const plan = loadPlan();
    if (!plan) {
      elements.trainingPlanContainer.innerHTML = "";
      return;
    }
    const totalDays = plan.days.length;
    const progress = plan.status === "graduated" ? 100 : Math.round((plan.completedDays / totalDays) * 100);
    const today = getTodayTask(plan);
    const statusText = plan.status === "graduated" ? "已完成" : `第 ${plan.completedDays + 1}/${totalDays} 天`;

    const drillsHtml = today
      ? `<ul class="plan-drills">${today.drills.map((d) => `<li>${escapeHtml(d)}</li>`).join("")}</ul>`
      : "";
    const targetHtml = today ? `<div class="plan-target">目标：${escapeHtml(today.targetMetric)}</div>` : "";
    const todayLabel = plan.status === "graduated" ? "计划已完成，瓶颈已改善" : "今日训练";

    elements.trainingPlanContainer.innerHTML = `
      <div class="plan-card ${plan.status === "graduated" ? "graduated" : ""}">
        <div class="plan-header">
          <span class="plan-title">${plan.status === "graduated" ? "训练计划（已毕业）" : "训练计划"}</span>
          <span class="plan-stage-tag">${escapeHtml(plan.targetStage)} · ${statusText}</span>
        </div>
        <div class="plan-progress-bar"><div class="plan-progress-fill" style="width:${progress}%"></div></div>
        <div class="plan-today">
          <div class="plan-today-label">${todayLabel}</div>
          ${drillsHtml}
          ${targetHtml}
        </div>
      </div>`;
  }

  /** 分析完成后更新训练计划 */
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
    renderTrainingPlan();
  }

  return {
    renderTrainingPlan,
    handlePlanAfterAnalysis,
  };
}
