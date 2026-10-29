/**
 * 历史面板的视图级纯函数：复盘洞察、设备统计、趋势图 SVG 与转义工具。
 * 独立成模块让控制器专注状态与事件绑定。
 */
import type { AnalysisInput } from "../agent/types.ts";
import { formatWcaSolveTime, getWcaScore } from "../core/wca-average.ts";
import { resolvePersistedSolveTrust } from "../core/solve-validation.ts";

export function isPracticeSolve(solve: AnalysisInput): boolean {
  return Boolean(solve.practiceKind || solve.practiceMode || solve.practiceFormulaId);
}

export function formatSolveTimeLocal(solve: AnalysisInput): string {
  return formatWcaSolveTime({ duration: solve.totalDuration, penalty: solve.penalty });
}

/** 设备成绩统计：按 deviceId/名称分组，输出平均、最佳与最近日期。 */
export function renderDeviceHistoryHtml(solves: AnalysisInput[]): string {
  const groups = new Map<string, AnalysisInput[]>();
  for (const solve of solves) {
    if (solve.practiceKind === "review" || !resolvePersistedSolveTrust(solve).scoreEligible) continue;
    const key = solve.deviceId?.trim() || solve.deviceName?.trim() || "未标识魔方";
    const records = groups.get(key) ?? [];
    records.push(solve);
    groups.set(key, records);
  }
  const stats = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  return stats.length === 0
    ? "暂无设备成绩"
    : stats.map(([, records]) => {
      const name = records[0].deviceName?.trim() || "未标识魔方";
      const scores = records.map((solve) => getWcaScore({ duration: solve.totalDuration, penalty: solve.penalty })).filter(Number.isFinite);
      const average = scores.reduce((sum, value) => sum + value, 0) / scores.length;
      const best = Math.min(...scores);
      const latest = Math.max(...records.map((record) => record.completedAt ?? 0));
      const latestLabel = latest > 0 ? new Date(latest).toLocaleDateString() : "—";
      return `<div class="device-history-entry">
        <strong>${escapeHtml(name)}</strong>
        <span>${records.length} 把</span>
        <span>平均 ${scores.length ? `${(average / 1000).toFixed(2)}s` : "DNF"}</span>
        <span>最佳 ${scores.length ? `${(best / 1000).toFixed(2)}s` : "DNF"}</span>
        <em>最近 ${latestLabel}</em>
      </div>`;
    }).join("");
}

/** 最近 30 把成绩趋势：均值、标准差与 SVG（空数据返回占位文案）。 */
export function renderPerformanceChartSvg(durations: number[]): { mean: string; std: string; svg: string } {
  if (durations.length === 0) {
    return {
      mean: "—",
      std: "—",
      svg: '<text x="300" y="92" text-anchor="middle" fill="var(--warm-gray)" font-size="14">完成一把后显示成绩趋势</text>',
    };
  }

  const values = durations.slice(-30).map((duration) => duration / 1000);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(0.5, max - min);
  const points = values.map((value, index) => {
    const x = values.length === 1 ? 300 : 36 + (index * 528) / (values.length - 1);
    const y = 150 - ((value - min) / range) * 112;
    return { x, y, value };
  });
  const line = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const dots = points.map((point) => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4" fill="var(--accent)"><title>${point.value.toFixed(2)}s</title></circle>`).join("");
  const meanY = 150 - ((mean - min) / range) * 112;
  return {
    mean: `${mean.toFixed(2)}s`,
    std: `${Math.sqrt(variance).toFixed(2)}s`,
    svg: `
      <line x1="36" y1="150" x2="564" y2="150" stroke="var(--rule)" />
      <line x1="36" y1="38" x2="36" y2="150" stroke="var(--rule)" />
      <line x1="36" y1="${meanY.toFixed(1)}" x2="564" y2="${meanY.toFixed(1)}" stroke="var(--accent-hover)" stroke-dasharray="5 5" />
      <polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      ${dots}
      <text x="8" y="42" fill="var(--warm-gray)" font-size="11">${max.toFixed(2)}s</text>
      <text x="8" y="152" fill="var(--warm-gray)" font-size="11">${min.toFixed(2)}s</text>
    `,
  };
}

export function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
