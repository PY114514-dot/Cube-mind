import type { AnalysisInput } from "../../src-shared/analysis-types.ts";
import { SolveTrustState } from "./solve-validation.ts";

/**
 * 历史记录的当前数据 schema 版本。
 * 每次需要迁移旧格式时递增，并在 migrateHistoryRecord() 中添加对应升级逻辑。
 */
export const HISTORY_DATA_VERSION = 1;

/**
 * 将单条历史记录迁移到最新 schema。
 * 直接修改传入的对象（load 时 freshly parsed，无外部引用），返回同一对象。
 */
export function migrateHistoryRecord(record: AnalysisInput): AnalysisInput {
  const version = record.dataVersion ?? 0;

  // v0 → v1：为缺少 trustState 的旧记录从 physicalState/qualityStatus 推导
  if (version < 1) {
    if (!record.trustState) {
      if (record.physicalState === "confirmed-unsolved") {
        record.trustState = SolveTrustState.Rejected;
      } else if (record.physicalState === "confirmed-solved") {
        record.trustState = SolveTrustState.ScoreOnly;
      } else {
        // unavailable 或无 physicalState：根据 qualityStatus 判断
        const eligible = record.qualityStatus === "valid" || record.qualityStatus == null;
        record.trustState = eligible ? SolveTrustState.AnalysisReady : SolveTrustState.Rejected;
      }
    }
    record.dataVersion = 1;
  }

  // 未来迁移在此追加：
  // if (version < 2) { ... record.dataVersion = 2; }

  return record;
}
