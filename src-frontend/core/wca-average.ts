/** WCA 风格平均成绩计算。时间单位统一为毫秒。 */

export const SolvePenalty = {
  None: "none",
  PlusTwo: "plus2",
  Dnf: "dnf",
} as const;

export type SolvePenalty = typeof SolvePenalty[keyof typeof SolvePenalty];

export interface WcaSolve {
  duration: number;
  penalty?: SolvePenalty;
  eligible?: boolean;
}

export interface WcaAverage {
  value: number | null;
  isDnf: boolean;
  removed: number;
  counted: number;
}

export function getWcaScore(solve: WcaSolve): number {
  if (solve.penalty === SolvePenalty.Dnf) return Number.POSITIVE_INFINITY;
  return solve.duration + (solve.penalty === SolvePenalty.PlusTwo ? 2000 : 0);
}

/** 单把成绩的 WCA 展示值；+2 以尾随加号标注，DNF 不显示伪造用时。 */
export function formatWcaSolveTime(solve: WcaSolve): string {
  if (solve.penalty === SolvePenalty.Dnf) return "DNF";
  const suffix = solve.penalty === SolvePenalty.PlusTwo ? "+" : "";
  return `${(getWcaScore(solve) / 1000).toFixed(2)}${suffix}`;
}

/** 计算最近 n 把的平均：去掉最快和最慢的 5%（每侧至少 1 把）。 */
export function calculateWcaAverage(solves: WcaSolve[]): WcaAverage {
  const valid = solves.filter((solve) => solve.eligible !== false);
  if (valid.length < 3) return { value: null, isDnf: false, removed: 0, counted: 0 };

  const ranked = valid.map((solve, index) => ({ value: getWcaScore(solve), index }));
  ranked.sort((a, b) => a.value - b.value || a.index - b.index);
  const removeEachSide = Math.max(1, Math.ceil(valid.length * 0.05));
  const kept = ranked.slice(removeEachSide, ranked.length - removeEachSide);
  const hasDnf = kept.some((item) => !Number.isFinite(item.value));
  if (hasDnf) {
    return { value: null, isDnf: true, removed: valid.length - kept.length, counted: kept.length };
  }

  const total = kept.reduce((sum, item) => sum + item.value, 0);
  return {
    value: total / kept.length,
    isDnf: false,
    removed: valid.length - kept.length,
    counted: kept.length,
  };
}

export function formatWcaAverage(solves: WcaSolve[]): string {
  const average = calculateWcaAverage(solves);
  if (average.isDnf) return "DNF";
  if (average.value === null) return "—";
  return `${(average.value / 1000).toFixed(2)}s`;
}
