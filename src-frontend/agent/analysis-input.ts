import type { AnalysisInput, AnalysisResult } from "./types.ts";
import { isSolveEligible } from "../core/solve-validation.ts";

export function createHistoryAnalysisInput(records: AnalysisInput[], scope: number): AnalysisInput | null {
  const solves = records.filter((solve) => solve.analysisEligible ?? isSolveEligible(solve.qualityStatus)).slice(-scope);
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

/** 从分析结果中提取瓶颈阶段，优先使用结构化字段 */
export function extractBottleneck(text: string, result?: AnalysisResult): string {
  if (result?.bottleneckStage) return result.bottleneckStage;
  // 回退：按瓶颈文本中首次出现的阶段名判断
  const stages = ["Cross", "F2L", "OLL", "PLL"] as const;
  let earliest = -1;
  let found = "";
  for (const stage of stages) {
    const idx = text.indexOf(stage);
    if (idx !== -1 && (earliest === -1 || idx < earliest)) {
      earliest = idx;
      found = stage;
    }
  }
  if (found) return found;
  if (text.includes("cross") || text.includes("十字")) return "Cross";
  return "";
}
