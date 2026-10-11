/**
 * core/assignment-store.ts
 * 公式指派历史的 localStorage 持久化（键 cubemind:formula-assignments）。
 *
 * 每次 AI 复盘完成后记录本次的公式级指派；下次分析输入据此回流
 * 「上次指派时间 + 期间练习成功率」，让 AGENT 能评价指派效果。
 */

import type { AnalysisResult } from "../../src-shared/analysis-types.ts";
import type { FormulaAssignment } from "./assignment-progress.ts";

/** 本次分析结果的公式指派条目（记录时只取 stage/formulaId/reason）。 */
type FocusFormulaAssignment = NonNullable<AnalysisResult["focusFormulas"]>[number];

const STORAGE_KEY = "cubemind:formula-assignments";
const MAX_ASSIGNMENTS = 20;
const VALID_STAGES = new Set(["F2L", "OLL", "PLL"]);

function isAssignment(value: unknown): value is FormulaAssignment {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<FormulaAssignment>;
  return typeof item.formulaId === "string"
    && typeof item.stage === "string"
    && VALID_STAGES.has(item.stage)
    && typeof item.assignedAt === "number"
    && (item.trainedAt === undefined || typeof item.trainedAt === "number");
}

/** 读取指派历史（按指派时间降序）；损坏数据安全降级为空列表。 */
export function loadAssignments(): FormulaAssignment[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isAssignment);
  } catch (error) {
    console.error("[assignment-store] 读取失败:", error);
    return [];
  }
}

/** 记录本次分析的公式级指派：同公式去重只留最新，超出上限淘汰最旧。 */
export function recordAssignments(entries: FocusFormulaAssignment[], assignedAt: number): void {
  const assignments = loadAssignments();
  for (const entry of entries) {
    if (!entry.formulaId) continue;
    const existing = assignments.findIndex((item) => item.formulaId === entry.formulaId);
    const trainedAt = existing >= 0 ? assignments[existing].trainedAt : undefined;
    if (existing >= 0) assignments.splice(existing, 1);
    assignments.unshift({
      formulaId: entry.formulaId,
      stage: entry.stage,
      reason: entry.reason,
      assignedAt,
      trainedAt,
    });
  }
  persist(assignments.slice(0, MAX_ASSIGNMENTS));
}

/** 固定 CASE 专项完成后标记训练时间，后续实战解法才能从此处开始统计迁移效果。 */
export function markAssignmentPracticed(completed: FormulaAssignment, trainedAt: number): void {
  const assignments = loadAssignments();
  const existing = assignments.find((item) => item.formulaId === completed.formulaId);
  // 自主专项与自动教练共用完成入口，不能依赖此前做过 AI 指派。
  const assignment = { ...(existing ?? completed), trainedAt };
  persist([assignment, ...assignments.filter((item) => item.formulaId !== completed.formulaId)].slice(0, MAX_ASSIGNMENTS));
}

/** 清空指派历史（手动重置训练闭环用）。 */
export function clearAssignments(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    // 移除失败不阻断主流程，但错误必须可见（4.4）
    console.error("[assignment-store] 清空失败:", error);
  }
}

function persist(assignments: FormulaAssignment[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(assignments));
  } catch (error) {
    // QuotaExceeded 时放弃写入，但错误必须可见（4.4）
    console.error("[assignment-store] 持久化失败:", error);
  }
}
