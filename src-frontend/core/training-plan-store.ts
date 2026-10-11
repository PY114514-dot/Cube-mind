/**
 * 训练计划 localStorage 持久化
 * 存储键：cubemind:training-plan
 * 同时保存最近 10 次分析结果摘要，用于聚合生成新计划
 */

import type { TrainingPlan } from "../../src-shared/training-plan-types.ts";
import type { AnalysisResult } from "../../src-shared/analysis-types.ts";
import { isPlanExpired } from "./training-plan-engine.ts";

const PLAN_KEY = "cubemind:training-plan";
const HISTORY_KEY = "cubemind:analysis-history";
const MAX_HISTORY = 10;

/** 分析历史摘要（只保留生成计划所需的字段） */
export interface AnalysisSnapshot {
  completedAt: number;
  bottleneckStage: string;
  issues: Array<{ stage: string; severity: string; description: string }>;
  drills?: Array<{ title: string; detail: string; reps: string }>;
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error("[training-plan-store] JSON 解析失败:", error);
    return null;
  }
}

/** 读取当前训练计划（过期则返回 null） */
export function loadPlan(): TrainingPlan | null {
  const plan = safeParse<TrainingPlan>(localStorage.getItem(PLAN_KEY));
  if (!plan) return null;
  if (isPlanExpired(plan)) {
    localStorage.removeItem(PLAN_KEY);
    return null;
  }
  return plan;
}

/** 保存训练计划 */
export function savePlan(plan: TrainingPlan): void {
  try {
    localStorage.setItem(PLAN_KEY, JSON.stringify(plan));
  } catch (err) {
    console.error("[training-plan-store] 保存计划失败:", err);
  }
}

/** 清除当前计划 */
export function clearPlan(): void {
  localStorage.removeItem(PLAN_KEY);
}

/** 读取分析历史摘要 */
export function loadAnalysisHistory(): AnalysisSnapshot[] {
  return safeParse<AnalysisSnapshot[]>(localStorage.getItem(HISTORY_KEY)) ?? [];
}

/** 追加一条分析摘要（保留最近 MAX_HISTORY 条） */
export function appendAnalysisSnapshot(result: AnalysisResult): void {
  const history = loadAnalysisHistory();
  const snapshot: AnalysisSnapshot = {
    completedAt: Date.now(),
    bottleneckStage: result.bottleneckStage ?? "",
    issues: (result.issues ?? []).map((i) => ({ stage: i.stage, severity: i.severity, description: i.description })),
    drills: result.drills?.map((d) => ({ title: d.title, detail: d.detail, reps: d.reps })),
  };
  history.push(snapshot);
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (err) {
    console.error("[training-plan-store] 保存分析历史失败:", err);
  }
}

/** 将 AnalysisSnapshot[] 转换为 AnalysisResult[]（供 aggregateIssues 使用） */
export function snapshotsToResults(snapshots: AnalysisSnapshot[]): AnalysisResult[] {
  return snapshots.map((s) => ({
    bottleneck: "",
    trainingAdvice: "",
    encouragement: "",
    source: "ai" as const,
    bottleneckStage: (s.bottleneckStage || undefined) as AnalysisResult["bottleneckStage"],
    issues: s.issues.map((i) => ({
      stage: i.stage as "Cross" | "F2L" | "OLL" | "PLL" | "General",
      severity: i.severity as "high" | "medium" | "low",
      description: i.description,
      evidence: "",
    })),
    drills: s.drills,
  }));
}
