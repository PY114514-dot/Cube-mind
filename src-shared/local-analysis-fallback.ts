import type { AnalysisInput, AnalysisResult } from "./analysis-types.ts";

interface StageMetric {
  name: "Cross" | "F2L" | "OLL" | "PLL";
  duration: number;
  moves: number;
}

const TRAINING_ADVICE: Record<StageMetric["name"], string> = {
  Cross: "练习预观察和 20 把 Cross 专项，尽量在计时前规划完整十字。",
  F2L: "进行慢拧 F2L 专项，优先练习基础对位和连续观察。",
  OLL: "复习 2-look OLL，并用随机顶层练习提升识别速度。",
  PLL: "复习高频 PLL 的识别与无停顿执行，重点检查 AUF。",
};

/** 网络或模型不可用时，前后端共用的确定性本地训练建议。 */
export function localAnalysisFallback(input: AnalysisInput): AnalysisResult {
  const allStages: StageMetric[] = [
    { name: "Cross", duration: input.crossDuration, moves: input.crossMoves },
    { name: "F2L", duration: input.f2lDuration, moves: input.f2lMoves },
    { name: "OLL", duration: input.ollDuration, moves: input.ollMoves },
    { name: "PLL", duration: input.pllDuration, moves: input.pllMoves },
  ];
  const stages = allStages.filter((stage) => stage.moves > 0);
  if (stages.length === 0 || input.totalDuration <= 0) {
    return { bottleneck: "数据不足", trainingAdvice: "再完成几把有效复原以积累数据。", encouragement: "坚持练习，下一把会更好。" };
  }
  const bottleneck = stages.reduce((slowest, stage) => slowest.duration > stage.duration ? slowest : stage);
  const ratio = Math.round(bottleneck.duration / input.totalDuration * 100);
  const firstPause = input.stepReview?.pauses[0];
  const slowestSlot = (input.f2lSlots ?? [])
    .filter((slot) => !slot.completedWithCross && slot.duration !== undefined)
    .sort((left, right) => (right.duration ?? 0) - (left.duration ?? 0))[0];
  if (slowestSlot) {
    const pause = slowestSlot.maxGap >= 800 ? `，最长停顿 ${(slowestSlot.maxGap / 1000).toFixed(2)} 秒` : "";
    return {
      bottleneck: `F2L 第 ${slowestSlot.completionOrder ?? "—"} 对 ${slowestSlot.slot} 最慢（${((slowestSlot.duration ?? 0) / 1000).toFixed(2)} 秒、${slowestSlot.moves ?? 0} 步${pause}）。`,
      trainingAdvice: `问题：${slowestSlot.slot} 槽位耗时偏高。优化方向：插入本对前先观察下一对。下一把执行：针对 ${slowestSlot.slot} 做 10 次慢拧，${slowestSlot.maxGap >= 800 ? "优先消除最长停顿。" : "每次记录完成步数。"}`,
      encouragement: "你已经能定位到具体槽位，针对性修正会比泛练 F2L 更快见效。",
    };
  }
  const pauseAdvice = firstPause
    ? ` 长停顿发生在 ${firstPause.move} 前（${firstPause.stage}，${(firstPause.gap / 1000).toFixed(2)} 秒），建议先完成识别再转动。`
    : "";
  return {
    bottleneck: `${bottleneck.name} 是当前瓶颈（约占总用时 ${ratio}%）。`,
    trainingAdvice: `${TRAINING_ADVICE[bottleneck.name]}${pauseAdvice}`,
    encouragement: "保持节奏，稳定比盲目提速更重要。",
  };
}
