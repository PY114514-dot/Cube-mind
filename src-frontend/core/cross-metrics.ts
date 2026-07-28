import { PAUSE_THRESHOLD } from "./timer.ts";

export interface CrossMoveMetric {
  gapFromPrev: number;
}

export interface CrossMetrics {
  steps: number;
  pauses: number;
  pauseDuration: number;
  longestPause: number;
  tps: number;
}

/** Cross 专项以实际设备 move 流计算步数、思考停顿和 TPS。 */
export function calculateCrossMetrics(moves: CrossMoveMetric[], duration: number): CrossMetrics {
  const gaps = moves.slice(1).map((move) => move.gapFromPrev).filter((gap) => gap > PAUSE_THRESHOLD);
  return {
    steps: moves.length,
    pauses: gaps.length,
    pauseDuration: gaps.reduce((sum, gap) => sum + gap, 0),
    longestPause: gaps.length === 0 ? 0 : Math.max(...gaps),
    tps: duration > 0 ? moves.length / (duration / 1000) : 0,
  };
}
