/**
 * formula/formula-library.ts
 * 公式库统一入口 + 瓶颈推荐
 *
 * 核心功能：
 *   1. 按 category 查询公式
 *   2. 根据 AGENT 瓶颈结果推荐对应公式
 *   3. 导出统一 Formula[] 给 UI 渲染
 */

import type { Formula, FormulaCategory, FormulaRecommendation } from "./types.ts";
import { F2L_FORMULAS, filterF2L } from "./f2l-formulas.ts";
import { OLL_FORMULAS, getOll2Look } from "./oll-formulas.ts";
import { PLL_FORMULAS, filterPll } from "./pll-formulas.ts";

/** 全部公式（合并三个库） */
export const ALL_FORMULAS: Formula[] = [
  ...F2L_FORMULAS,
  ...OLL_FORMULAS,
  ...PLL_FORMULAS,
];

/** 按 category 索引 */
const FORMULA_INDEX: Record<FormulaCategory, Formula[]> = {
  F2L: F2L_FORMULAS,
  OLL: OLL_FORMULAS,
  PLL: PLL_FORMULAS,
};

/** 按 ID 查找 */
export function getFormulaById(id: string): Formula | undefined {
  return ALL_FORMULAS.find((f) => f.id === id);
}

/** 按 category 列出全部 */
export function listByCategory(category: FormulaCategory): Formula[] {
  return FORMULA_INDEX[category];
}

/** 按 tag 筛选（任一 tag 匹配） */
export function filterByTag(category: FormulaCategory, tags: string[]): Formula[] {
  switch (category) {
    case "F2L":
      return filterF2L(tags);
    case "OLL":
      return OLL_FORMULAS.filter((f) => tags.some((t) => f.tags.includes(t)));
    case "PLL":
      return filterPll(tags);
  }
}

/** 按难度筛选 */
export function filterByDifficulty(category: FormulaCategory, maxDifficulty: number): Formula[] {
  return FORMULA_INDEX[category].filter((f) => f.difficulty <= maxDifficulty);
}

/**
 * 核心入口：根据瓶颈推荐公式
 * @param bottleneck "F2L" | "OLL" | "PLL" | "Cross"
 * @param stageDurationMs 该阶段用时（毫秒）
 * @param totalDurationMs 总用时（毫秒）
 */
export function recommendFormulas(
  bottleneck: string,
  stageDurationMs: number,
  totalDurationMs: number
): FormulaRecommendation {
  const ratio = totalDurationMs > 0 ? stageDurationMs / totalDurationMs : 0;
  const ratioPct = (ratio * 100).toFixed(0);

  if (bottleneck === "F2L") {
    // F2L 慢：推荐基本对位 + 分割配对
    const formulas = [
      ...filterByTag("F2L", ["basic"]),
      ...filterByTag("F2L", ["split-pair"]),
    ].slice(0, 6);
    return {
      reason: `F2L 占总用时 ${ratioPct}%，是当前最大瓶颈。优先练习基本对位（无需 split pair），熟练后再练分割配对。`,
      formulas,
      practicePlan: "每天慢拧 10 把 F2L，每把目标 12 秒以内。先 R U R' 类基本对位，再练 U R U' R' 分割。",
    };
  }

  if (bottleneck === "OLL") {
    // OLL 慢：推荐 2-look OLL
    const formulas = getOll2Look();
    return {
      reason: `OLL 占总用时 ${ratioPct}%。2-look OLL 是性价比最高的方案，7 个公式覆盖 90% 比赛场景。`,
      formulas,
      practicePlan: "每天背 1 个 2-look OLL 公式，连续 3 天即可全背熟。练习时重点关注 OLL 识别（<1 秒）。",
    };
  }

  if (bottleneck === "PLL") {
    // PLL 慢：先推荐基础 PLL（U/H/T/J）
    const basicPll = filterByTag("PLL", ["permutation-only", "two-sided"]).slice(0, 8);
    return {
      reason: `PLL 占总用时 ${ratioPct}%。PLL 关键在识别速度，先背熟 8 个基础 PLL。`,
      formulas: basicPll,
      practicePlan: "每天练习 PLL 识别（只看顶层颜色判断 case），目标是 1 秒内识别。然后慢拧练习公式。",
    };
  }

  if (bottleneck === "Cross") {
    // Cross 慢：虽然不在 Formula 库，但给一些提示
    return {
      reason: `Cross 占总用时 ${ratioPct}%。Cross 不在公式库，但需要练习观察力。`,
      formulas: [],
      practicePlan: "做 20 把 Cross 专项：打乱后先观察 3 秒再动手，目标是 4 步内完成 Cross。",
    };
  }

  // 默认
  return {
    reason: "数据不足以定位瓶颈，建议继续练习并积累更多解法数据。",
    formulas: [],
    practicePlan: "继续训练，10 把后再次分析。",
  };
}

/** 公式库统计信息 */
export function getLibraryStats() {
  return {
    F2L: F2L_FORMULAS.length,
    OLL: OLL_FORMULAS.length,
    PLL: PLL_FORMULAS.length,
    total: ALL_FORMULAS.length,
  };
}