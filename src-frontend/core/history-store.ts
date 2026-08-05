import type { AnalysisInput } from "../agent/types.ts";
import { isScoreEligible } from "./solve-validation.ts";

export const HISTORY_STORAGE_KEY = "cubemind:history";

export class HistoryStore {
  private records: AnalysisInput[];

  constructor(initial: AnalysisInput[] = []) { this.records = initial; }
  get all(): AnalysisInput[] { return this.records; }
  get eligible(): AnalysisInput[] { return this.records.filter((solve) => isScoreEligible(solve.physicalState, solve.qualityStatus)); }

  add(record: AnalysisInput): void {
    const next = [...this.records, record].slice(-500);
    this.persist(next);
    this.records = next;
  }

  remove(index: number): void {
    if (index < 0 || index >= this.records.length) return;
    const next = this.records.slice();
    next.splice(index, 1);
    this.persist(next);
    this.records = next;
  }

  save(): void { this.persist(this.records); }

  private persist(records: AnalysisInput[]): void {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(records));
    } catch (error) {
      // QuotaExceededError：裁剪最旧 20% 后重试一次
      console.warn("[history-store] 存储写入失败，尝试裁剪旧记录:", error);
      const trimmed = records.slice(Math.ceil(records.length * 0.2));
      try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(trimmed));
        this.records = trimmed;
      } catch {
        console.error("[history-store] 裁剪后仍无法写入，本次持久化跳过");
      }
    }
  }

  static load(): HistoryStore {
    const saved = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!saved) return new HistoryStore();
    try {
      const parsed: unknown = JSON.parse(saved);
      if (!Array.isArray(parsed)) throw new Error("历史记录不是数组");
      const records = parsed.filter((item): item is AnalysisInput =>
        typeof item === "object" && item !== null && typeof (item as { totalDuration?: unknown }).totalDuration === "number"
      );
      return new HistoryStore(records);
    } catch (error) {
      console.error("[history-store] 无法加载历史记录:", error);
      localStorage.removeItem(HISTORY_STORAGE_KEY);
      return new HistoryStore();
    }
  }
}
