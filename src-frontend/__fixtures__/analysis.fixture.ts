import type { AnalysisInput } from "../../src-shared/analysis-types.ts";

export function createAnalysisSolve(overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    totalDuration: 20000, crossDuration: 2000, f2lDuration: 12000, ollDuration: 3000, pllDuration: 3000,
    crossMoves: 7, f2lMoves: 28, ollMoves: 10, pllMoves: 12,
    qualityStatus: "valid", analysisEligible: true,
    scramble: "R U F2", moves: ["F2", "U'", "R'"], moveCount: 3,
    ...overrides,
  };
}
