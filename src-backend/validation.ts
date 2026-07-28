import type { AnalysisInput } from "../src-shared/analysis-types.ts";

const MAX_RECENT_STEP_REVIEWS = 12;
const MAX_PAUSES_PER_REVIEW = 5;
const MAX_TOTAL_RECENT_PAUSES = 40;

export interface SolveInput {
  totalDuration: number;
  crossDuration: number;
  f2lDuration: number;
  ollDuration: number;
  pllDuration: number;
  scramble: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isMoveCount(value: unknown): value is number {
  return isNonNegativeNumber(value) && Number.isInteger(value);
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.length <= maxLength ? value : undefined;
}

function parseRecentSolves(value: unknown): AnalysisInput["recentSolves"] | undefined {
  if (!Array.isArray(value) || value.length > 12) return undefined;
  const records = value.filter(isRecord).map((record) => ({
    totalDuration: record.totalDuration,
    crossDuration: record.crossDuration,
    f2lDuration: record.f2lDuration,
    ollDuration: record.ollDuration,
    pllDuration: record.pllDuration,
  }));
  if (records.length !== value.length || records.some((record) =>
    !isNonNegativeNumber(record.totalDuration) || !isNonNegativeNumber(record.crossDuration)
    || !isNonNegativeNumber(record.f2lDuration) || !isNonNegativeNumber(record.ollDuration)
    || !isNonNegativeNumber(record.pllDuration))) return undefined;
  return records as NonNullable<AnalysisInput["recentSolves"]>;
}

function parseRecentStepReviews(value: unknown): AnalysisInput["recentStepReviews"] | undefined {
  if (!Array.isArray(value) || value.length > MAX_RECENT_STEP_REVIEWS) return undefined;
  let pauseCount = 0;
  const reviews = value.map((review) => {
    if (!isRecord(review) || !Array.isArray(review.pauses) || review.pauses.length > MAX_PAUSES_PER_REVIEW || !isNonNegativeNumber(review.maxGap)) return null;
    pauseCount += review.pauses.length;
    if (pauseCount > MAX_TOTAL_RECENT_PAUSES) return null;
    const pauses = review.pauses.map((pause) => {
      if (!isRecord(pause) || !isNonNegativeNumber(pause.gap)
        || typeof pause.move !== "string" || pause.move.length > 10
        || typeof pause.stage !== "string" || pause.stage.length > 20) return null;
      return { move: pause.move, gap: pause.gap, stage: pause.stage };
    });
    return pauses.some((pause) => pause === null) ? null : { pauses: pauses as Array<{ move: string; gap: number; stage: string }>, maxGap: review.maxGap };
  });
  return reviews.some((review) => review === null) ? undefined : reviews as NonNullable<AnalysisInput["recentStepReviews"]>;
}

/** 将不可信请求体收窄为分析服务所需的安全输入。 */
export function parseAnalysisInput(value: unknown): AnalysisInput | null {
  if (!isRecord(value)) return null;
  const requiredDurations = ["totalDuration", "crossDuration", "f2lDuration", "ollDuration", "pllDuration"] as const;
  const requiredMoves = ["crossMoves", "f2lMoves", "ollMoves", "pllMoves"] as const;
  if (requiredDurations.some((field) => !isNonNegativeNumber(value[field]))
    || requiredMoves.some((field) => !isMoveCount(value[field]))) return null;

  const recentSolves = parseRecentSolves(value.recentSolves);
  const recentStepReviews = parseRecentStepReviews(value.recentStepReviews);
  if (value.recentSolves !== undefined && !recentSolves) return null;
  if (value.recentStepReviews !== undefined && !recentStepReviews) return null;
  return {
    totalDuration: value.totalDuration as number,
    crossDuration: value.crossDuration as number,
    f2lDuration: value.f2lDuration as number,
    ollDuration: value.ollDuration as number,
    pllDuration: value.pllDuration as number,
    crossMoves: value.crossMoves as number,
    f2lMoves: value.f2lMoves as number,
    ollMoves: value.ollMoves as number,
    pllMoves: value.pllMoves as number,
    analysisScope: isMoveCount(value.analysisScope) ? value.analysisScope : undefined,
    recentSolves,
    recentStepReviews,
  };
}

/** 只持久化成绩 API 明确允许的字段。 */
export function parseSolveInput(value: unknown): SolveInput | null {
  if (!isRecord(value)) return null;
  const input = parseAnalysisInput(value);
  const scramble = optionalString(value.scramble, 500);
  if (!input || scramble === undefined) return null;
  return {
    totalDuration: input.totalDuration,
    crossDuration: input.crossDuration,
    f2lDuration: input.f2lDuration,
    ollDuration: input.ollDuration,
    pllDuration: input.pllDuration,
    scramble,
  };
}
