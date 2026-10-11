/**
 * 固定 CASE 专项的训练前后对比。
 * 只比较同一公式的成功率和成功样本执行时间，避免把不同 CASE 混成虚假的进步。
 */

import { getFormulaMastery, type FormulaMastery, type PracticeRecord } from "./practice-stats.ts";

export interface FormulaPracticeEffect {
  baseline: FormulaMastery | null;
  session: FormulaMastery;
  successRateDelta: number | null;
  executionDurationDelta: number | null;
}

/**
 * 用本轮开始时间切分同一公式的历史和本轮记录。
 * 缺少时间戳的旧记录只可作为历史基线，不能误计入本轮。
 */
export function compareFormulaPractice(
  records: PracticeRecord[],
  formulaId: string,
  sessionStartedAt: number,
): FormulaPracticeEffect {
  const formulaRecords = records.filter((record) => record.practiceKind === "formula" && record.formulaId === formulaId);
  const sessionRecords = formulaRecords.filter((record) => typeof record.completedAt === "number" && record.completedAt >= sessionStartedAt);
  const baselineRecords = formulaRecords.filter((record) => record.completedAt === undefined || record.completedAt < sessionStartedAt);
  const session = getFormulaMastery(sessionRecords, formulaId);
  const baselineMastery = getFormulaMastery(baselineRecords, formulaId);
  const baseline = baselineMastery.attempts > 0 ? baselineMastery : null;
  return {
    baseline,
    session,
    successRateDelta: baseline ? session.successRate - baseline.successRate : null,
    executionDurationDelta: baseline !== null && baseline.averageExecutionDuration !== null && session.averageExecutionDuration !== null
      ? session.averageExecutionDuration - baseline.averageExecutionDuration
      : null,
  };
}
