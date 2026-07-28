import { formatWcaAverage } from "./wca-average.ts";

export type PracticeKind = "formula" | "cross" | "f2l" | "cross-f2l";

export interface PracticeRecord {
  practiceKind: PracticeKind;
  duration: number;
  outcome: "success" | "failed";
  formulaId?: string;
  recognitionDuration?: number;
  executionDuration?: number;
  completedAt?: number;
}

export interface FormulaMastery {
  formulaId: string;
  attempts: number;
  successes: number;
  successRate: number;
  averageDuration: number | null;
  averageRecognitionDuration: number | null;
  averageExecutionDuration: number | null;
  errorRate: number;
}

export interface PracticeSummary {
  attempts: number;
  successes: number;
  successRate: number;
  averageDuration: number | null;
  ao5: string;
  ao12: string;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 汇总某个公式的成功率和分段用时；失败记录只影响成功率。 */
export function getFormulaMastery(records: PracticeRecord[], formulaId: string): FormulaMastery {
  const attempts = records.filter((record) => record.practiceKind === "formula" && record.formulaId === formulaId);
  const successful = attempts.filter((record) => record.outcome === "success");
  const duration = successful.map((record) => record.duration);
  const recognition = successful.flatMap((record) =>
    typeof record.recognitionDuration === "number" ? [record.recognitionDuration] : []);
  const execution = successful.flatMap((record) =>
    typeof record.executionDuration === "number" ? [record.executionDuration] : []);
  return {
    formulaId,
    attempts: attempts.length,
    successes: successful.length,
    successRate: attempts.length === 0 ? 0 : successful.length / attempts.length,
    averageDuration: average(duration),
    averageRecognitionDuration: average(recognition),
    averageExecutionDuration: average(execution),
    errorRate: attempts.length === 0 ? 1 : 1 - successful.length / attempts.length,
  };
}

/** 分块练习仅使用对应模式的成功成绩，避免污染常规 AO。 */
export function getPracticeSummary(records: PracticeRecord[], kind: Exclude<PracticeKind, "formula">): PracticeSummary {
  const attempts = records.filter((record) => record.practiceKind === kind);
  const successful = attempts.filter((record) => record.outcome === "success");
  const durations = successful.map((record) => record.duration);
  return {
    attempts: attempts.length,
    successes: successful.length,
    successRate: attempts.length === 0 ? 0 : successful.length / attempts.length,
    averageDuration: average(durations),
    ao5: durations.length < 5 ? "—" : formatWcaAverage(durations.slice(-5).map((duration) => ({ duration }))),
    ao12: durations.length < 12 ? "—" : formatWcaAverage(durations.slice(-12).map((duration) => ({ duration }))),
  };
}

/** 优先回炉未掌握和高错误率公式；没有练习数据时保持均匀随机。 */
export function selectPracticeFormula<T extends { id: string; difficulty: number }>(
  formulas: T[], records: PracticeRecord[], random: () => number = Math.random,
): T | undefined {
  if (formulas.length === 0) return undefined;
  const weighted = formulas.map((formula) => {
    const mastery = getFormulaMastery(records, formula.id);
    const unpracticed = mastery.attempts === 0 ? 4 : 0;
    const weak = mastery.errorRate * 8;
    return { formula, weight: 1 + unpracticed + weak };
  });
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let point = random() * total;
  for (const item of weighted) {
    point -= item.weight;
    if (point <= 0) return item.formula;
  }
  return weighted[weighted.length - 1].formula;
}
