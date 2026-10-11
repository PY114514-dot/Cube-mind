/**
 * core/assignment-progress.ts
 * 训练闭环的回流计算：公式指派 → 专项练习 → 下次分析时的效果评价。
 *
 * 纯函数模块：不接触 localStorage / DOM，输入指派历史与练习记录，
 * 输出「自上次指派以来」的练习表现，并给本次结果里的再指派条目回填闭环字段。
 */

import type { AnalysisResult, AssignmentProgressEntry } from "../../src-shared/analysis-types.ts";
import type { PracticeRecord } from "./practice-stats.ts";

/** 一次公式级指派的持久记录（本地存储的历史条目）。 */
export interface FormulaAssignment {
  formulaId: string;
  stage: "F2L" | "OLL" | "PLL";
  reason: string;
  assignedAt: number;
  /** 完成固定 CASE 专项训练的时间；缺失表示尚未开始训练。 */
  trainedAt?: number;
}

/**
 * 计算每个已指派公式自上次指派以来的练习成功率。
 * 缺失 completedAt 的练习记录视为指派之后完成（无法证明更早，宁可计入）。
 */
export function buildAssignmentProgress(
  assignments: FormulaAssignment[],
  records: PracticeRecord[],
): AssignmentProgressEntry[] {
  return assignments.map((assignment) => {
    const since = records.filter((record) =>
      record.practiceKind === "formula"
      && record.formulaId === assignment.formulaId
      && (record.completedAt ?? assignment.assignedAt) >= assignment.assignedAt);
    const successes = since.filter((record) => record.outcome === "success");
    return {
      formulaId: assignment.formulaId,
      stage: assignment.stage,
      lastAssignedAt: assignment.assignedAt,
      practiceAttempts: since.length,
      practiceSuccessRate: since.length === 0 ? null : successes.length / since.length,
    };
  });
}

/**
 * 给本次结果里被再指派的公式附上「上次指派时间 + 期间成功率」，
 * 供 UI 在指派卡片上直接展示闭环效果。无指派历史或阶段级条目不附加字段。
 * 纯函数：不修改原 result，无可回填内容时原样返回。
 */
export function enrichFocusFormulas(
  result: AnalysisResult,
  assignments: FormulaAssignment[],
  records: PracticeRecord[],
): AnalysisResult {
  const entries = result.focusFormulas;
  if (!entries || entries.length === 0) return result;
  const progress = new Map(
    buildAssignmentProgress(assignments, records).map((entry) => [entry.formulaId, entry]),
  );
  let changed = false;
  const enriched = entries.map((entry) => {
    if (!entry.formulaId) return entry;
    const previous = progress.get(entry.formulaId);
    if (!previous) return entry;
    changed = true;
    return {
      ...entry,
      lastAssignedAt: previous.lastAssignedAt,
      practiceSuccessRate: previous.practiceSuccessRate ?? undefined,
    };
  });
  return changed ? { ...result, focusFormulas: enriched } : result;
}
