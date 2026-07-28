import type { SolveStatus } from "./solve-validation.ts";

export interface QualityPresentation {
  label: string;
  description: string;
}

/** 将数据校验状态转换为用户可理解的成绩可信度提示。 */
export function presentSolveQuality(status: SolveStatus | undefined, anomalies: string[] = []): QualityPresentation {
  if (status === "valid" || status === undefined) return { label: "有效成绩", description: "已纳入趋势、AO 和 AI 分析。" };
  if (status === "incomplete") return { label: "未完成", description: "未还原完成，已排除在趋势、AO 和 AI 分析之外。" };
  const detail = anomalies.length > 0 ? `检测到：${anomalies.join("、")}。` : "检测到设备动作数据异常。";
  return { label: "数据异常", description: `${detail} 已排除在趋势、AO 和 AI 分析之外。` };
}

/** AI 结论的可信度取决于可用成绩样本，而非所有历史记录。 */
export function getAnalysisSampleNotice(validCount: number): string {
  if (validCount <= 0) return "暂无有效成绩，请先完成一把正常还原。";
  if (validCount < 5) return `当前仅 ${validCount} 把有效成绩，建议积累到 5 把后再判断训练瓶颈。`;
  return `将基于最近最多 ${Math.min(validCount, 12)} 把有效成绩生成训练建议。`;
}
