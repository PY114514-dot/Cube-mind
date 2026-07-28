import type { AnalysisInput } from "../agent/types.ts";
import { isSolveEligible } from "./solve-validation.ts";

export const HISTORY_STORAGE_KEY = "cubemind:history";

export class HistoryStore {
  private records: AnalysisInput[];

  constructor(initial: AnalysisInput[] = []) { this.records = initial; }
  get all(): AnalysisInput[] { return this.records; }
  get eligible(): AnalysisInput[] { return this.records.filter((solve) => isSolveEligible(solve.qualityStatus)); }

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
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(records));
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
