import type { AnalysisInput } from "./types.ts";
import { isSolveEligible } from "../core/solve-validation.ts";

export function createHistoryAnalysisInput(records: AnalysisInput[], scope: number): AnalysisInput | null {
  const solves = records.filter((solve) => isSolveEligible(solve.qualityStatus)).slice(-scope);
  if (solves.length === 0) return null;
  const latestSolve = solves[solves.length - 1];
  const average = (field: keyof AnalysisInput): number =>
    solves.reduce((total, solve) => total + (typeof solve[field] === "number" ? solve[field] as number : 0), 0) / solves.length;
  return {
    analysisScope: solves.length,
    // 趋势数据取所选成绩的均值；3D 回放则固定展示最近一把，避免把多把动作混成不存在的解法。
    scramble: latestSolve.scramble,
    moves: latestSolve.moves,
    f2lSlots: latestSolve.f2lSlots,
    totalDuration: average("totalDuration"),
    crossDuration: average("crossDuration"),
    f2lDuration: average("f2lDuration"),
    ollDuration: average("ollDuration"),
    pllDuration: average("pllDuration"),
    crossMoves: Math.round(average("crossMoves")),
    f2lMoves: Math.round(average("f2lMoves")),
    ollMoves: Math.round(average("ollMoves")),
    pllMoves: Math.round(average("pllMoves")),
    recentSolves: solves.map((solve) => ({
      totalDuration: solve.totalDuration,
      crossDuration: solve.crossDuration,
      f2lDuration: solve.f2lDuration,
      ollDuration: solve.ollDuration,
      pllDuration: solve.pllDuration,
    })),
    recentStepReviews: solves
      .filter((solve) => solve.stepReview)
      .map((solve) => ({
        pauses: solve.stepReview?.pauses.map((pause) => ({
          move: pause.move,
          gap: pause.gap,
          stage: pause.stage,
        })) ?? [],
        maxGap: solve.stepReview?.maxGap ?? 0,
      })),
  };
}

export function extractBottleneck(text: string): string {
  if (text.includes("F2L")) return "F2L";
  if (text.includes("OLL")) return "OLL";
  if (text.includes("PLL")) return "PLL";
  if (text.includes("Cross") || text.includes("cross")) return "Cross";
  return "";
}
