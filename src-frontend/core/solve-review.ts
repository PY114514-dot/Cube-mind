import type { Stage, StageSegment } from "./cfop-parser.ts";

export interface StepReviewItem {
  index: number;
  move: string;
  gap: number;
  stage: Stage | "unknown";
  reason: "long-pause";
}

export interface SolveReview {
  pauseThreshold: number;
  pauses: StepReviewItem[];
  averageGap: number;
  maxGap: number;
}

function stageAt(index: number, segments: StageSegment[]): Stage | "unknown" {
  const segment = segments.find((item) => index >= item.startIdx && index < item.endIdx);
  return segment?.stage ?? "unknown";
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

export function analyzeSolveSteps(
  moves: string[],
  gaps: number[],
  segments: StageSegment[],
): SolveReview {
  const usableGaps = gaps.filter((gap) => Number.isFinite(gap) && gap > 0);
  const averageGap = usableGaps.length > 0
    ? usableGaps.reduce((sum, gap) => sum + gap, 0) / usableGaps.length
    : 0;
  const pauseThreshold = Math.max(300, percentile(usableGaps, 0.75) * 2.2);
  const pauses = gaps
    .map((gap, index) => ({
      index,
      move: moves[index] ?? "?",
      gap,
      stage: stageAt(index, segments),
      reason: "long-pause" as const,
    }))
    .filter((item) => item.gap >= pauseThreshold)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 5);

  return {
    pauseThreshold,
    pauses,
    averageGap,
    maxGap: usableGaps.length > 0 ? Math.max(...usableGaps) : 0,
  };
}
