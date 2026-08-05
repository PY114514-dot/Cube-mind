import type { AnalysisInput, AnalysisResult, AnalysisIssue, AnalysisDrill } from "./analysis-types.ts";

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

const DRILL_TEMPLATES: Record<StageMetric["name"], AnalysisDrill> = {
  Cross: { title: "Cross 预观察专项", detail: "拿起魔方后不计时，用 15 秒观察并默念完整十字路线（含翻转和归位顺序），然后闭眼执行。", reps: "10 次 × 2 组" },
  F2L: { title: "F2L 慢拧连续观察", detail: "以正常速度的 50% 做 F2L，每插入一对后立即追踪下一对的角和棱位置，不允许停顿超过 0.5 秒。", reps: "8 次 × 3 组" },
  OLL: { title: "OLL 识别闪卡", detail: "用随机顶层生成器，3 秒内说出 case 编号并写出公式前两步。超时则标记为未掌握。", reps: "20 个 case" },
  PLL: { title: "PLL 无停顿执行", detail: "识别后 0.5 秒内必须开始转动，重点练习 AUF 预判（观察顶层侧面颜色对齐）。", reps: "12 次 × 2 组" },
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
    return { bottleneck: "数据不足", trainingAdvice: "再完成几把有效复原以积累数据。", encouragement: "坚持练习，下一把会更好。", source: "fallback", bottleneckStage: "" };
  }

  const bottleneck = stages.reduce((slowest, stage) => slowest.duration > stage.duration ? slowest : stage);
  const ratio = Math.round(bottleneck.duration / input.totalDuration * 100);
  const firstPause = input.stepReview?.pauses[0];
  const slowestSlot = (input.f2lSlots ?? [])
    .filter((slot) => !slot.completedWithCross && slot.duration !== undefined)
    .sort((left, right) => (right.duration ?? 0) - (left.duration ?? 0))[0];

  // 构建结构化 issues
  const issues: AnalysisIssue[] = [];
  if (slowestSlot) {
    issues.push({
      stage: "F2L",
      severity: (slowestSlot.duration ?? 0) / input.totalDuration > 0.35 || slowestSlot.maxGap > 2000 ? "high" : "medium",
      description: `F2L 第 ${slowestSlot.completionOrder ?? "—"} 对（${slowestSlot.slot}）耗时最长`,
      evidence: `${((slowestSlot.duration ?? 0) / 1000).toFixed(2)}s、${slowestSlot.moves ?? 0} 步、停顿 ${slowestSlot.pauseCount} 次、最长 ${(slowestSlot.maxGap / 1000).toFixed(2)}s`,
    });
  }
  issues.push({
    stage: bottleneck.name,
    severity: ratio > 35 ? "high" : ratio > 20 ? "medium" : "low",
    description: `${bottleneck.name} 占总用时 ${ratio}%，是当前最大时间消耗`,
    evidence: `${(bottleneck.duration / 1000).toFixed(2)}s / ${bottleneck.moves} 步`,
  });
  if (firstPause && firstPause.gap > 1000) {
    issues.push({
      stage: (firstPause.stage || "General") as AnalysisIssue["stage"],
      severity: firstPause.gap > 2000 ? "high" : "medium",
      description: `${firstPause.stage} 阶段在 ${firstPause.move} 前出现长停顿`,
      evidence: `停顿 ${(firstPause.gap / 1000).toFixed(2)}s`,
    });
  }

  // 构建 drills
  const drills: AnalysisDrill[] = [DRILL_TEMPLATES[bottleneck.name]];
  if (slowestSlot && bottleneck.name !== "F2L") {
    drills.push(DRILL_TEMPLATES.F2L);
  }

  const nextFocus = slowestSlot
    ? `插入 ${slowestSlot.slot} 对之前先观察下一对角棱位置，减少停顿`
    : `${bottleneck.name} 阶段保持连续转动，目标 TPS 提升 0.5`;

  // 文本字段（向后兼容）
  let bottleneckText: string;
  let adviceText: string;
  if (slowestSlot) {
    const pause = slowestSlot.maxGap >= 800 ? `，最长停顿 ${(slowestSlot.maxGap / 1000).toFixed(2)} 秒` : "";
    bottleneckText = `F2L 第 ${slowestSlot.completionOrder ?? "—"} 对 ${slowestSlot.slot} 最慢（${((slowestSlot.duration ?? 0) / 1000).toFixed(2)} 秒、${slowestSlot.moves ?? 0} 步${pause}）。`;
    adviceText = `问题：${slowestSlot.slot} 槽位耗时偏高。优化方向：插入本对前先观察下一对。下一把执行：针对 ${slowestSlot.slot} 做 10 次慢拧，${slowestSlot.maxGap >= 800 ? "优先消除最长停顿。" : "每次记录完成步数。"}`;
  } else {
    const pauseAdvice = firstPause
      ? ` 长停顿发生在 ${firstPause.move} 前（${firstPause.stage}，${(firstPause.gap / 1000).toFixed(2)} 秒），建议先完成识别再转动。`
      : "";
    bottleneckText = `${bottleneck.name} 是当前瓶颈（约占总用时 ${ratio}%）。`;
    adviceText = `${TRAINING_ADVICE[bottleneck.name]}${pauseAdvice}`;
  }

  return {
    bottleneck: bottleneckText,
    trainingAdvice: adviceText,
    encouragement: "保持节奏，稳定比盲目提速更重要。",
    source: "fallback",
    bottleneckStage: bottleneck.name,
    issues: issues.slice(0, 4),
    drills,
    nextFocus,
  };
}
