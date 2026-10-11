/**
 * core/training-profile.ts
 * 纵向训练档案的核心纯函数：把公式练习记录聚合为「公式 × 日期」的按天桶。
 *
 * 为什么存在：sessionContext 是会话内的、assignmentProgress 是「自上次指派以来」
 * 的快照，都缺一条跨天时间线。档案把练习记录沉淀为按天聚合（不依赖历史记录
 * 保留期），让 AGENT 能判断「连续两周没提升」这类跨会话趋势。
 *
 * 本模块不接触 localStorage / DOM；持久化在 training-profile-store.ts。
 */

import type { PracticeRecord } from "./practice-stats.ts";
import type { TrainingProfileEntry } from "../../src-shared/training-plan-types.ts";

/** 档案最多保留的条目数（公式 × 日期）；超出淘汰最旧。 */
export const MAX_PROFILE_ENTRIES = 200;

/** 本地时区日期键（YYYY-MM-DD）。为什么用本地时区：训练习惯按当地自然日划分。 */
export function dateKeyOf(timestamp: number): string {
  const d = new Date(timestamp);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** 按公式 id 前缀推断阶段；无法识别返回 null（此类记录不进档案）。 */
export function stageFromFormulaId(formulaId: string): TrainingProfileEntry["stage"] | null {
  if (formulaId.startsWith("F2L-")) return "F2L";
  if (formulaId.startsWith("OLL-")) return "OLL";
  if (formulaId.startsWith("PLL-")) return "PLL";
  return null;
}

/**
 * 把练习记录聚合为按天桶：只统计公式练习（有 formulaId 与 completedAt 的记录）。
 * 同日同公式合并；平均执行用时只统计成功记录（失败记录只影响成功率）。
 * 结果按最近练习时间降序。
 */
export function bucketPracticeByDay(records: PracticeRecord[]): TrainingProfileEntry[] {
  const buckets = new Map<string, TrainingProfileEntry>();
  for (const record of records) {
    if (record.practiceKind !== "formula" || !record.formulaId || typeof record.completedAt !== "number") continue;
    const stage = stageFromFormulaId(record.formulaId);
    if (!stage) continue;
    const dateKey = dateKeyOf(record.completedAt);
    const key = `${record.formulaId}|${dateKey}`;
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        formulaId: record.formulaId,
        stage,
        dateKey,
        attempts: 1,
        successes: record.outcome === "success" ? 1 : 0,
        avgExecutionMs: record.outcome === "success"
          ? (typeof record.executionDuration === "number" ? record.executionDuration : record.duration)
          : null,
        lastPracticedAt: record.completedAt,
      });
      continue;
    }
    existing.attempts += 1;
    existing.lastPracticedAt = Math.max(existing.lastPracticedAt, record.completedAt);
    if (record.outcome !== "success") continue;
    existing.successes += 1;
    const executionMs = typeof record.executionDuration === "number" ? record.executionDuration : record.duration;
    if (existing.avgExecutionMs === null) {
      existing.avgExecutionMs = executionMs;
    } else {
      // 增量平均：保持 O(1) 更新，无需回放全部成功记录
      existing.avgExecutionMs = (existing.avgExecutionMs * (existing.successes - 1) + executionMs) / existing.successes;
    }
  }
  return [...buckets.values()].sort((left, right) => right.lastPracticedAt - left.lastPracticedAt);
}

/**
 * 合并新旧档案：同日同公式以新桶整体覆盖（新桶由完整练习记录重算，更权威），
 * 仅存在于旧档案的日期保留（历史记录可能已超出保留期，档案里仍有其聚合）。
 * 超出 MAX_PROFILE_ENTRIES 时按最近练习时间淘汰最旧。
 */
export function mergeTrainingProfile(
  current: TrainingProfileEntry[],
  incoming: TrainingProfileEntry[],
): TrainingProfileEntry[] {
  const byKey = new Map<string, TrainingProfileEntry>();
  for (const entry of current) byKey.set(`${entry.formulaId}|${entry.dateKey}`, entry);
  for (const entry of incoming) byKey.set(`${entry.formulaId}|${entry.dateKey}`, entry);
  return [...byKey.values()]
    .sort((left, right) => right.lastPracticedAt - left.lastPracticedAt)
    .slice(0, MAX_PROFILE_ENTRIES);
}
