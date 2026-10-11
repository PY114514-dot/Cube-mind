import type { CaseTransferProgress } from "../../src-shared/analysis-types.ts";

function seconds(value: number | null): string {
  return value === null ? "—" : `${(value / 1000).toFixed(2)}s`;
}

/** 实战效果先展示样本数，命中不足时不把单次波动写成训练进步。 */
export function formatCaseTransferFeedback(progress: CaseTransferProgress): string {
  const { formulaId, before, after } = progress;
  const samples = `已记录 ${progress.normalSolveCount}/${progress.targetSolveCount} 把常规复原`;
  const windowFull = progress.normalSolveCount >= progress.targetSolveCount;
  if (after.caseHits === 0) return `${formulaId} · ${samples}，${windowFull ? "本轮观察未遇到这个 CASE，暂不判断变化" : "尚未再次遇到这个 CASE"}。`;
  const hits = `训练前 ${before.caseHits} 次、训练后 ${after.caseHits} 次命中`;
  if (!progress.readyForComparison) return `${formulaId} · ${hits}。${windowFull ? "观察窗已满，命中不足，暂不判断变化" : "前后各至少 3 次命中后展示变化"}。`;
  const recognition = `${seconds(before.averageRecognitionPauseMs)} → ${seconds(after.averageRecognitionPauseMs)}`;
  const moves = before.averageMoveDelta !== null && after.averageMoveDelta !== null
    ? `步数偏差 ${before.averageMoveDelta.toFixed(1)} → ${after.averageMoveDelta.toFixed(1)} 步`
    : "解法参照不一致或记录不足，暂不比较步数差";
  return `${formulaId} · ${hits} · 起手前停顿 ${recognition} · ${moves}`;
}
