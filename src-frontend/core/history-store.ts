import type { AnalysisInput } from "../agent/types.ts";
import { resolvePersistedSolveTrust } from "./solve-validation.ts";
import { migrateHistoryRecord, HISTORY_DATA_VERSION } from "./data-migration.ts";

export const HISTORY_STORAGE_KEY = "cubemind:history";

export class HistoryStore {
  private records: AnalysisInput[];

  constructor(private readonly onWriteError: (message: string) => void, initial: AnalysisInput[] = []) {
    this.records = initial;
  }
  get all(): AnalysisInput[] { return this.records; }
  get eligible(): AnalysisInput[] { return this.records.filter((solve) => resolvePersistedSolveTrust(solve).scoreEligible); }

  add(record: AnalysisInput): boolean {
    if (!record.dataVersion) record.dataVersion = HISTORY_DATA_VERSION;
    this.records = [...this.records, record].slice(-500);
    return this.persist(this.records);
  }

  remove(index: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= this.records.length) return false;
    const next = this.records.slice();
    next.splice(index, 1);
    if (!this.persist(next)) return false;
    this.records = next;
    return true;
  }

  save(): boolean { return this.persist(this.records); }

  private persist(records: AnalysisInput[]): boolean {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(records));
      return true;
    } catch (error) {
      // 存储失败不能靠删除用户历史来掩盖；页面内的新成绩仍可导出。
      console.error("[history-store] 历史记录写入失败:", error);
      this.onWriteError("历史记录未能写入浏览器存储，原有已保存记录未被覆盖。请先导出 JSON 备份，再刷新或关闭页面。");
      return false;
    }
  }

  static load(onWriteError: (message: string) => void): HistoryStore {
    const saved = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!saved) return new HistoryStore(onWriteError);
    try {
      const parsed: unknown = JSON.parse(saved);
      if (!Array.isArray(parsed)) throw new Error("历史记录不是数组");
      const records = parsed.filter((item): item is AnalysisInput =>
        typeof item === "object" && item !== null && typeof (item as { totalDuration?: unknown }).totalDuration === "number"
      );
      // 逐条迁移到最新 schema（ freshly parsed，无外部引用，可原地修改）
      for (const record of records) migrateHistoryRecord(record);
      return new HistoryStore(onWriteError, records);
    } catch (error) {
      console.error("[history-store] 无法加载历史记录:", error);
      localStorage.removeItem(HISTORY_STORAGE_KEY);
      return new HistoryStore(onWriteError);
    }
  }
}
