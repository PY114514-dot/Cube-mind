import type { AnalysisInput } from "../agent/types.ts";

const CSV_COLUMNS = [
  "completedAt", "totalDurationMs", "crossDurationMs", "f2lDurationMs", "ollDurationMs", "pllDurationMs",
  "crossMoves", "f2lMoves", "ollMoves", "pllMoves", "tps", "penalty", "qualityStatus", "scramble", "moves",
] as const;

function escapeCsv(value: string | number | undefined): string {
  const text = value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 导出可恢复的完整历史 JSON。 */
export function formatHistoryJson(records: AnalysisInput[]): string {
  return JSON.stringify(records, null, 2);
}

/** 导出兼容 Excel / Numbers 的成绩汇总 CSV。 */
export function formatHistoryCsv(records: AnalysisInput[]): string {
  const rows = records.map((record) => [
    record.completedAt,
    record.totalDuration,
    record.crossDuration,
    record.f2lDuration,
    record.ollDuration,
    record.pllDuration,
    record.crossMoves,
    record.f2lMoves,
    record.ollMoves,
    record.pllMoves,
    record.tps,
    record.penalty,
    record.qualityStatus,
    record.scramble,
    record.moves?.join(" "),
  ].map(escapeCsv).join(","));
  return `\uFEFF${CSV_COLUMNS.join(",")}\n${rows.join("\n")}`;
}
