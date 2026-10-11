/**
 * core/training-profile-store.ts
 * 纵向训练档案的 localStorage 持久化（键 cubemind:training-profile）。
 *
 * 为什么单独存一份而非每次从练习记录现算：历史记录有保留上限（500 把），
 * 档案把聚合沉淀下来后不随记录轮转丢失；AGENT 每次分析只需读这一份小 JSON。
 */

import type { PracticeRecord } from "./practice-stats.ts";
import type { TrainingProfile, TrainingProfileEntry } from "../../src-shared/training-plan-types.ts";
import { bucketPracticeByDay, mergeTrainingProfile } from "./training-profile.ts";

const STORAGE_KEY = "cubemind:training-profile";

const VALID_STAGES = new Set(["F2L", "OLL", "PLL"]);
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 逐条校验档案条目形状；损坏条目丢弃，保证读到内存里的数据结构完整。 */
function isProfileEntry(value: unknown): value is TrainingProfileEntry {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<TrainingProfileEntry>;
  return typeof item.formulaId === "string"
    && typeof item.stage === "string"
    && VALID_STAGES.has(item.stage)
    && typeof item.dateKey === "string"
    && DATE_KEY_PATTERN.test(item.dateKey)
    && typeof item.attempts === "number"
    && typeof item.successes === "number"
    && (typeof item.avgExecutionMs === "number" || item.avgExecutionMs === null)
    && typeof item.lastPracticedAt === "number";
}

/** 读取训练档案；缺失或损坏时安全降级为空档案。 */
export function loadTrainingProfile(): TrainingProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { entries: [] };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { entries?: unknown }).entries)) {
      return { entries: [] };
    }
    return { entries: (parsed as { entries: unknown[] }).entries.filter(isProfileEntry) };
  } catch (error) {
    console.error("[training-profile-store] 读取失败:", error);
    return { entries: [] };
  }
}

/**
 * 用当前练习记录同步档案：重算的当日桶覆盖旧值、旧档案中已轮转出历史的日期保留。
 * 无有效练习记录时不写存储（避免空同步覆盖已有档案）。
 */
export function syncTrainingProfile(records: PracticeRecord[]): void {
  const incoming = bucketPracticeByDay(records);
  if (incoming.length === 0) return;
  const merged = mergeTrainingProfile(loadTrainingProfile().entries, incoming);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries: merged }));
  } catch (error) {
    // QuotaExceeded 时放弃写入，但错误必须可见（4.4）
    console.error("[training-profile-store] 持久化失败:", error);
  }
}

/** 清空训练档案（手动重置训练闭环用）。 */
export function clearTrainingProfile(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    // 移除失败不阻断主流程，但错误必须可见（4.4）
    console.error("[training-profile-store] 清空失败:", error);
  }
}
