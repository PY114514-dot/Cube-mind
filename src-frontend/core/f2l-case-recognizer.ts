/** 基于公式训练起始状态的 F2L case 精确识别。 */

import { createCaseFacelets } from "../formula/cube-case-diagram.ts";
import { F2L_FORMULAS } from "../formula/f2l-formulas.ts";
import { getFormulaSetupMoves } from "../formula/setup-validation.ts";
import type { Formula } from "../formula/types.ts";

export interface F2lCaseMatch {
  formulaId: string;
  name: string;
  tags: string[];
  confidence: "exact";
}

const F2L_CASE_TEMPLATES = createF2lCaseTemplates();

/**
 * 识别与公式库训练 setup 完全一致的 F2L case。
 *
 * 非完整模板状态返回 null，避免在普通复原里把局部相似状态误判为某个 case。
 */
export function recognizeF2lCase(facelets: string): F2lCaseMatch | null {
  const formula = F2L_CASE_TEMPLATES.get(facelets);
  return formula ? toCaseMatch(formula) : null;
}

/** 识别当前专项练习所使用的 setup，支持 UI 生成的同一 case 变体公式。 */
export function recognizeF2lPracticeCase(facelets: string, formula: Formula): F2lCaseMatch | null {
  if (formula.category !== "F2L") return null;
  const expectedFacelets = createCaseFacelets(getFormulaSetupMoves(formula)).join("");
  return facelets === expectedFacelets ? toCaseMatch(formula) : null;
}

function createF2lCaseTemplates(): Map<string, Formula> {
  const templates = new Map<string, Formula>();
  for (const formula of F2L_FORMULAS) {
    const facelets = createCaseFacelets(getFormulaSetupMoves(formula)).join("");
    if (templates.has(facelets)) {
      throw new Error(`[F2L 识别] 训练 setup 重复: ${formula.id}`);
    }
    templates.set(facelets, formula);
  }
  return templates;
}

function toCaseMatch(formula: Formula): F2lCaseMatch {
  return {
    formulaId: formula.id,
    name: formula.name,
    tags: [...formula.tags],
    confidence: "exact",
  };
}
