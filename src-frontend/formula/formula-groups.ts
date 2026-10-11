/**
 * 公式库分组定义与匹配：把 41 F2L / 57 OLL / 21 PLL 归入可折叠的训练分组。
 * 纯函数模块，不依赖 DOM；分组顺序即展示顺序（OLL 按学习难度从易到难）。
 */

import type { Formula, FormulaCategory } from "./types.ts";

export interface FormulaGroupDefinition {
  id: string;
  label: string;
  /** F2L/OLL 用标签匹配：命中任一标签即归入该组（按定义顺序取首个命中）。 */
  tags?: string[];
  /** PLL 用公式 ID 匹配（去掉 "PLL-" 前缀后的部分）。 */
  ids?: string[];
}

export interface FormulaGroup {
  definition: FormulaGroupDefinition;
  formulas: Formula[];
}

export const FORMULA_GROUPS: Record<FormulaCategory, FormulaGroupDefinition[]> = {
  F2L: [
    { id: "paired", label: "已配对", tags: ["paired"] },
    { id: "split-pair", label: "分离对", tags: ["split-pair"] },
    { id: "corner-on-top", label: "顶层角块", tags: ["corner-on-top"] },
    { id: "white-on-top", label: "白角朝上", tags: ["white-on-top"] },
    { id: "in-slot", label: "槽内取块", tags: ["corner-in-slot", "edge-in-slot", "wrong-slot"] },
    { id: "flipped-edge", label: "翻转棱块", tags: ["flipped-edge"] },
    {
      id: "advanced",
      label: "进阶技巧",
      tags: ["back-slot", "hidden-pair", "sledgehammer", "hedgehammer", "rotationless", "keyhole", "twisted-corner", "advanced", "slot-preserving", "last-pair"],
    },
  ],
  OLL: [
    { id: "cross", label: "十字O", tags: ["cross-only", "corners-solved", "corner-only", "corners-only", "cross"] },
    { id: "fish", label: "鱼O", tags: ["fish", "sune", "anti-sune"] },
    { id: "square", label: "方块O", tags: ["square"] },
    { id: "lightning", label: "闪电O", tags: ["lightning"] },
    { id: "l-shape", label: "拐角O", tags: ["l-shape"] },
    { id: "line", label: "一字O", tags: ["line"] },
    { id: "dot", label: "点O", tags: ["dot"] },
    { id: "knight", label: "骑士O", tags: ["knight"] },
    { id: "p-shape", label: "P型O", tags: ["p-shape"] },
    { id: "shapes", label: "其他O", tags: ["t-shape", "bowtie", "h-shape", "pi-shape", "headlights", "awkward", "c-shape", "w-shape", "mountains", "frying-pan"] },
  ],
  PLL: [
    { id: "edge", label: "棱换", ids: ["Ua", "Ub", "H", "Z"] },
    { id: "corner", label: "角换", ids: ["Aa", "Ab", "E"] },
    { id: "adjacent", label: "邻角邻棱", ids: ["T", "F", "Ja", "Jb", "Ra", "Rb"] },
    { id: "g", label: "G 家族", ids: ["Ga", "Gb", "Gc", "Gd"] },
    { id: "diagonal", label: "对角", ids: ["Na", "Nb", "V", "Y"] },
  ],
};

function matchesGroup(category: FormulaCategory, formula: Formula, definition: FormulaGroupDefinition): boolean {
  if (definition.ids) {
    return definition.ids.includes(formula.id.replace(/^PLL-/, ""));
  }
  return definition.tags?.some((tag) => formula.tags.includes(tag)) ?? false;
}

/** 按定义顺序把公式分入各分组；未命中任何定义的公式归入兜底「其他」组。 */
export function groupFormulas(category: FormulaCategory, formulas: Formula[]): FormulaGroup[] {
  const definitions = FORMULA_GROUPS[category];
  const buckets = new Map<string, Formula[]>();
  const fallback: Formula[] = [];
  for (const formula of formulas) {
    const definition = definitions.find((candidate) => matchesGroup(category, formula, candidate));
    if (definition) {
      const list = buckets.get(definition.id) ?? [];
      list.push(formula);
      buckets.set(definition.id, list);
    } else {
      fallback.push(formula);
    }
  }
  const groups = definitions
    .map((definition) => ({ definition, formulas: buckets.get(definition.id) ?? [] }))
    .filter((group) => group.formulas.length > 0);
  if (fallback.length > 0) {
    groups.push({ definition: { id: "other", label: "其他" }, formulas: fallback });
  }
  return groups;
}
