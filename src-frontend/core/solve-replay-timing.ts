/** 动作完成时间以计时起点为零；首项间隔也包含起手前的等待。 */
export function buildReplayTimestamps(moveCount: number, gaps: number[] | undefined): number[] | null {
  if (moveCount === 0 || !gaps || gaps.length !== moveCount) return null;
  const timestamps = [0];
  for (const gap of gaps) {
    if (!Number.isFinite(gap) || gap < 0) return null;
    const elapsed = timestamps[timestamps.length - 1] + gap;
    if (!Number.isFinite(elapsed)) return null;
    timestamps.push(elapsed);
  }
  return timestamps;
}
