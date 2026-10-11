/**
 * core/plan-formula-picker.ts
 * 训练计划与公式库联动：为计划当天的公式阶段（F2L/OLL/PLL）自动挑选
 * 最值得练的具体公式。
 *
 * 为什么独立成模块：训练计划引擎只处理阶段级任务（drills 文案），而公式
 * 元数据在 formula/ 层；core/ 不能依赖 formula/。本模块只接收调用方传入的
 * 公式元信息（id/difficulty），结合练习记录（当前掌握度）与纵向训练档案
 * （跨天趋势）输出推荐排序，保持依赖方向不变。
 *
 * 为什么推荐在渲染时现算而不是写进 PlanDay：计划可能跨多天，用户每天练习
 * 后掌握度都在变化，渲染时现算保证推荐始终对应最新数据，且无需重生成计划。
 */

import type { PracticeRecord } from "./practice-stats.ts";
import { getFormulaMastery } from "./practice-stats.ts";
import type { TrainingProfileEntry } from "../../src-shared/training-plan-types.ts";
import { profileTrend } from "../../src-shared/analysis-evidence.ts";

/** 调用方提供的公式元信息：core/ 不依赖 formula/ 库的完整 Formula 类型。 */
export interface PlanFormulaMeta {
  id: string;
  difficulty: number;
}

/** 推荐理由：从未练习 / 近期成功率下滑 / 成功率偏低。 */
export type PlanFormulaPickReason = "unpracticed" | "declining" | "weak";

/** 单条推荐结果。 */
export interface PlanFormulaPick {
  formulaId: string;
  reason: PlanFormulaPickReason;
  /** 最近整体成功率（0-1）；从未练习过为 null */
  successRate: number | null;
  attempts: number;
}

/** 今日最多推荐的公式数。 */
export const MAX_PLAN_FORMULAS = 4;

/** 近期下滑公式的排序加成：等价于成功率再降 20 个百分点，优先于未下滑的同水平公式。 */
const DECLINE_BOOST = 0.2;

export interface PickPlanFormulasOptions {
  /** 当天计划聚焦的阶段；formulas 应只含该阶段公式（本函数按 id 前缀防御性过滤）。 */
  stage: "F2L" | "OLL" | "PLL";
  formulas: PlanFormulaMeta[];
  /** 当前会话内的练习记录（掌握度来源）。 */
  records: PracticeRecord[];
  /** 纵向训练档案条目（跨天趋势来源），可为空数组。 */
  profile: TrainingProfileEntry[];
  /** 已掌握公式由调用方判定（公式库维护掌握度标记）。 */
  isMastered: (formulaId: string) => boolean;
  /** 推荐数量上限，默认 MAX_PLAN_FORMULAS。 */
  limit?: number;
}

/** 排序中间态：sortScore 与 difficulty 只参与排序，不进返回结果。 */
interface RankedPick extends PlanFormulaPick {
  sortScore: number;
  difficulty: number;
}

/** 排序分：未练习 -1 最高优先；下滑按成功率减加成；其余按成功率升序（低者在前）。 */
function sortScoreOf(reason: PlanFormulaPickReason, successRate: number): number {
  if (reason === "unpracticed") return -1;
  return reason === "declining" ? successRate - DECLINE_BOOST : successRate;
}

/**
 * 合并掌握度来源：当前会话练习记录最精确，优先使用；会话内没有但档案有
 * 跨天聚合时用档案兜底（否则上会话练过的公式会被误判为「未练习」）。
 * 两者都没有返回 null，表示从未练习。
 */
function combinedMastery(
  records: PracticeRecord[],
  profileGroup: TrainingProfileEntry[],
  formulaId: string,
): { attempts: number; successRate: number } | null {
  const session = getFormulaMastery(records, formulaId);
  if (session.attempts > 0) return { attempts: session.attempts, successRate: session.successRate };
  const attempts = profileGroup.reduce((sum, entry) => sum + entry.attempts, 0);
  const successes = profileGroup.reduce((sum, entry) => sum + entry.successes, 0);
  if (attempts === 0) return null;
  return { attempts, successRate: successes / attempts };
}

/**
 * 为计划当天的公式阶段挑选最值得练的公式。
 * 排序：未练习 > 近期下滑 > 成功率低 > 成功率高；同分按难度升序、id 升序保证确定性。
 * 无任何练习数据时全部判未练习，此时退化为按难度升序（先易后难）。
 */
export function pickPlanFormulas(options: PickPlanFormulasOptions): PlanFormulaPick[] {
  const { stage, formulas, records, profile, isMastered, limit = MAX_PLAN_FORMULAS } = options;

  // 按 id 前缀过滤：调用方通常已按阶段过滤，这里防御混入其他阶段公式。
  const prefix = `${stage}-`;
  const ranked: RankedPick[] = [];
  for (const formula of formulas) {
    if (!formula.id.startsWith(prefix) || isMastered(formula.id)) continue;
    const profileGroup = profile.filter((entry) => entry.formulaId === formula.id);
    const mastery = combinedMastery(records, profileGroup, formula.id);
    const trend = profileTrend(profileGroup);

    let reason: PlanFormulaPickReason;
    if (mastery === null) {
      reason = "unpracticed";
    } else if (trend === "down") {
      reason = "declining";
    } else {
      reason = "weak";
    }
    ranked.push({
      formulaId: formula.id,
      reason,
      successRate: mastery?.successRate ?? null,
      attempts: mastery?.attempts ?? 0,
      sortScore: sortScoreOf(reason, mastery?.successRate ?? 0),
      difficulty: formula.difficulty,
    });
  }

  return ranked
    .sort((left, right) =>
      left.sortScore - right.sortScore
      || left.difficulty - right.difficulty
      || left.formulaId.localeCompare(right.formulaId))
    .slice(0, limit)
    .map(({ sortScore, difficulty, ...pick }) => pick);
}

/** 推荐标签：供计划卡片直接展示；未练习不显示百分比。 */
export function formatPickLabel(pick: PlanFormulaPick): string {
  if (pick.reason === "unpracticed") return "未练习";
  const percent = `${Math.round((pick.successRate ?? 0) * 100)}%`;
  return pick.reason === "declining" ? `成功率 ${percent} · 近期下滑` : `成功率 ${percent}`;
}
