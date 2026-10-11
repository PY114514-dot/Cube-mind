/**
 * 公式库 2D case 图：SpeedCubeDB 风格顶面展开图。
 * 黑色十字底板由 CSS 背景承担，U 面 3×3 贴纸居中，四条薄翼为相邻侧面的顶行；
 * OLL 只保留黄色朝向、其余贴纸中性灰；PLL 保留完整侧面配色展示置换。
 * 21 张贴纸通过 grid-area 落在 index.html 的 .formula-top-view 模板上，空角不渲染。
 */

import { createCaseFacelets, createFormulaTopViewState, type FormulaTopViewCategory } from "../formula/cube-case-diagram.ts";
import { TOP_VIEW_COLORS, TOP_VIEW_NEUTRAL } from "../utils/cube-colors.ts";

/** 顶视图中单个贴纸的颜色值（"N" 为 OLL 的中性贴纸）。 */
export function getTopViewStickerColor(cell: string): string {
  if (cell === "N") return TOP_VIEW_NEUTRAL;
  return TOP_VIEW_COLORS[cell] ?? TOP_VIEW_NEUTRAL;
}

/** 与 grid-template-areas 对应的 21 个贴纸位置，顺序与 createFormulaTopViewState 输出一致。 */
const CELL_AREAS = [
  "b1", "b2", "b3",
  "l1", "u1", "u2", "u3", "r1",
  "l2", "u4", "u5", "u6", "r2",
  "l3", "u7", "u8", "u9", "r3",
  "f1", "f2", "f3",
] as const;

/**
 * 渲染 21 格顶面展开图 HTML：空角不渲染，十字底板由 CSS 背景承担。
 * 颜色通过内联 CSS 变量传入，由 index.html 的 .formula-top-view 规则消费。
 */
export function renderFormulaTopView(setupMoves: string[], category: FormulaTopViewCategory): string {
  const facelets = createCaseFacelets(setupMoves);
  const state = createFormulaTopViewState(facelets, category);
  const cells = state
    .filter((cell): cell is string => cell !== null)
    .map((cell, index) => `<span style="grid-area:${CELL_AREAS[index]};--formula-top-sticker:${getTopViewStickerColor(cell)}"></span>`);
  return `<div class="formula-top-view" role="img" aria-label="${category} case 顶视图">${cells.join("")}</div>`;
}
