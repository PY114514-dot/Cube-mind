/** 解法保存后的下一步计划：把练习流转与可信度提示从 UI 编排层移出。 */

import type { PhysicalCubeState, SolveAnomaly } from "./solve-validation.ts";

export type FormulaAttemptAction = "none" | "complete" | "retry";

export interface SolveCompletionPlanInput {
  analysisEligible: boolean;
  physicalState: PhysicalCubeState;
  validationAnomalies: SolveAnomaly[];
  isFormulaAttempt: boolean;
  formulaPracticeSucceeded: boolean;
  blockPracticeSucceeded: boolean;
}

export interface SolveCompletionPlan {
  formulaAttemptAction: FormulaAttemptAction;
  awaitingNextScramble: boolean;
  statusMessage: string;
  statusLevel: "info" | "error";
}

/** 同一份计划同时决定练习流转和用户提示，避免页面按不同条件重复判断可信度。 */
export function buildSolveCompletionPlan(input: SolveCompletionPlanInput): SolveCompletionPlan {
  return {
    formulaAttemptAction: getFormulaAttemptAction(input),
    awaitingNextScramble: !input.isFormulaAttempt,
    ...getStatus(input),
  };
}

function getFormulaAttemptAction(input: SolveCompletionPlanInput): FormulaAttemptAction {
  if (!input.isFormulaAttempt) return "none";
  return input.formulaPracticeSucceeded ? "complete" : "retry";
}

function getStatus(input: SolveCompletionPlanInput): Pick<SolveCompletionPlan, "statusMessage" | "statusLevel"> {
  if (input.analysisEligible) return { statusMessage: "状态回放确认已还原；成绩可用于 AO 与 AI", statusLevel: "info" };
  if (input.physicalState === "confirmed-solved") {
    return { statusMessage: "实体状态确认已复原；成绩已计入 AO，动作流仅保留诊断用途", statusLevel: "info" };
  }
  if (input.formulaPracticeSucceeded || input.blockPracticeSucceeded) {
    return { statusMessage: "状态回放确认专项目标完成；已仅计入专项统计", statusLevel: "info" };
  }
  return { statusMessage: `成绩已保存但未通过状态校验：${input.validationAnomalies.join("、")}`, statusLevel: "error" };
}
