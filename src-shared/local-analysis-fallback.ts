import type { AnalysisInput, AnalysisResult, AnalysisDrill, AnalysisStage } from "./analysis-types.ts";
import { buildCoachingEvidence, getStageMetrics } from "./analysis-coaching.ts";
import type { CoachingEvidence } from "./analysis-coaching.ts";

const DRILLS: Record<AnalysisStage, AnalysisDrill> = {
  Cross: { title: "Cross 预观察对照", detail: "在观察阶段规划十字路线，再执行并核对实际动作；记录计划与实际在哪里分开。", reps: "10 把" },
  F2L: { title: "F2L 慢拧连续观察", detail: "放慢转动，在插入当前对时追踪下一对角棱。每把只记录一处停顿，并确认当时是在找块、想公式还是调整动作。", reps: "10 把" },
  OLL: { title: "OLL 识别与执行分开练", detail: "从公式库选一个弱项，先识别再执行，分别记录起手前用时与执行用时。熟练后回到常规复原观察。", reps: "10 次专项＋常规复原" },
  PLL: { title: "PLL 起手与 AUF 对照", detail: "识别局面后先确认握法和 AUF，再执行；对照回放区分公式中停顿与调整顶层的动作。", reps: "10 次专项＋常规复原" },
};

function pickFocusFormulas(input: AnalysisInput, stage: AnalysisStage, evidence: CoachingEvidence[]): AnalysisResult["focusFormulas"] {
  const weakPractice = (input.practiceSummary ?? [])
    .filter((entry) => entry.category === stage && entry.attempts >= 3 && entry.successRate < 0.8)
    .sort((a, b) => a.successRate - b.successRate || b.attempts - a.attempts)
    .map((entry) => ({ stage: entry.category, formulaId: entry.formulaId,
      reason: `已练习 ${entry.attempts} 次，成功率 ${Math.round(entry.successRate * 100)}%，先巩固正确执行。` }));
  const observed = evidence.filter((entry) => entry.caseId && entry.stage === stage
    && !(input.practiceSummary ?? []).some((practice) => practice.formulaId === entry.caseId && practice.successRate >= 0.8))
    .map((entry) => ({ stage: entry.stage as "F2L" | "OLL" | "PLL", formulaId: entry.caseId,
      reason: `${entry.description}；先核对回放，再做针对性专项。` }));
  const unique = [...observed, ...weakPractice].filter((entry, index, entries) =>
    entries.findIndex((other) => other.formulaId === entry.formulaId) === index).slice(0, 2);
  return unique.length > 0 ? unique : undefined;
}

function caseDrill(input: AnalysisInput, top: CoachingEvidence): AnalysisDrill {
  const mastery = input.practiceSummary?.find((entry) => entry.formulaId === top.caseId);
  const transfer = input.caseTransfer?.find((entry) => entry.formulaId === top.caseId);
  const observing = transfer && !transfer.readyForComparison ? "专项后实战样本仍不足，继续记录同 CASE 命中。" : "";
  return mastery && mastery.successRate >= 0.8 ? {
    title: `${top.caseId} 实战识别与衔接`,
    detail: `专项成功率已达 ${Math.round(mastery.successRate * 100)}%。回到常规复原，在不同局面中识别这个 CASE，核对起手前停顿；先确认是找块还是动作衔接。${observing}`,
    reps: "下一组常规复原",
  } : {
    title: `${top.caseId} 回放对照专项`,
    detail: `先查看代表局面，核对目标块与动作，再做固定 CASE 专项。公式库步数是参照，额外 AUF 和衔接动作需要结合局面判断。${observing}`,
    reps: "10 次，并记录起手前用时",
  };
}

/** 网络或模型不可用时，使用同一证据目录生成可核对、可回放的本地建议。 */
export function localAnalysisFallback(input: AnalysisInput): AnalysisResult {
  const stages = getStageMetrics(input).filter((stage) => stage.moves > 0);
  if (stages.length === 0 || input.totalDuration <= 0) {
    return { bottleneck: "数据不足", trainingAdvice: "再完成几把可信常规复原以积累数据。", encouragement: "先保留完整动作记录。", source: "fallback", bottleneckStage: "" };
  }
  const evidence = buildCoachingEvidence(input);
  const actionable = evidence.filter((entry) => entry.severity !== "low");
  const top = actionable[0];
  const largest = stages.reduce((a, b) => a.duration > b.duration ? a : b);
  const stage = top && top.stage !== "General" ? top.stage : largest.name;
  const drills = [top?.caseId ? caseDrill(input, top) : DRILLS[stage]];
  return {
    bottleneck: top ? `${top.description}。${top.evidence}` : "当前没有足够证据认定某阶段异常；阶段耗时占比仅表示时间分布。",
    trainingAdvice: top ? `问题：${top.description}。优化方向：核对实录局面与动作。下一把执行：${drills[0].detail}` : "继续记录常规复原，积累个人基准；每把记录一处需要复盘的停顿。",
    encouragement: "每次只调整一个有证据的问题，再观察后续实战表现。",
    source: "fallback",
    bottleneckStage: top ? stage : "",
    issues: actionable.slice(0, 4).map((entry) => ({ stage: entry.stage, severity: entry.severity,
      description: entry.description, evidence: entry.evidence, evidenceId: entry.id })),
    drills,
    nextFocus: top ? `先核对：${top.description}；下一把只跟踪这一项。` : "下一把保持常规复原，记录起手前的长停顿。",
    focusFormulas: pickFocusFormulas(input, stage, evidence),
  };
}
