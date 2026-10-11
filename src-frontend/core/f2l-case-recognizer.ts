/** 基于公式训练起始状态的 F2L case 精确识别。 */

import { createCaseFacelets } from "../formula/cube-case-diagram.ts";
import { F2L_FORMULAS } from "../formula/f2l-formulas.ts";
import { getFormulaSetupMoves } from "../formula/setup-validation.ts";
import type { Formula } from "../formula/types.ts";
import { CubieCube, parseMove } from "../utils/mathlib.ts";
import { isCrossSolved } from "./cross-solver.ts";

export interface F2lCaseMatch {
  formulaId: string;
  name: string;
  tags: string[];
  confidence: "exact";
}

export type FormulaCaseMatch = F2lCaseMatch;

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
  return recognizeFormulaPracticeCase(facelets, formula);
}

/**
 * 校验 OLL / PLL（以及 F2L）专项的起始 case。
 * 公式库和练习入口使用同一套 setup，因此这里可以做精确匹配，避免把
 * “打乱做错但最后恰好还原”的尝试计为正确样本。
 */
export function recognizeFormulaPracticeCase(facelets: string, formula: Formula): FormulaCaseMatch | null {
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

/**
 * 实战 F2L case 识别（本地签名法）。
 *
 * 训练 setup 状态 = 十字完成 + 其余三对就位 + 目标对处于 case 配置，而实战里
 * 每一对开始时其余槽位可能仍未复原，整局面 54 贴纸与模板必然不一致。因此这里
 * 只提取目标对的局部签名（角块位置+朝向、棱块位置+朝向），忽略无关块，再把
 * 目标槽位整体绕 y 轴旋转到 FR 视角与模板比对，最后允许 U 层 4 种朝向（AUF 变体）。
 */

/** 绕 U-D 轴把 F 面转到 R 面方向的旋转（记 y'）置换表：new[i] = old[prev[i]]。 */
const Y_CORNER_PREV = [1, 2, 3, 0, 5, 6, 7, 4] as const;
const Y_EDGE_PREV = [1, 2, 3, 0, 5, 6, 7, 4, 9, 10, 11, 8] as const;

/** 目标槽位绕上述方向旋转到 FR 视角所需的次数（FR 0 次、FL 1 次、BL 2 次、BR 3 次）。 */
const SLOT_Y_ROTATIONS: Record<F2lCaseTargetSlot, number> = { FR: 0, FL: 1, BL: 2, BR: 3 };

export type F2lCaseTargetSlot = "FR" | "FL" | "BL" | "BR";

const D_SLOT_PIECES: ReadonlyArray<{ slot: F2lCaseTargetSlot; corner: number; edge: number }> = [
  { slot: "FR", corner: 4, edge: 8 },
  { slot: "FL", corner: 5, edge: 9 },
  { slot: "BL", corner: 6, edge: 10 },
  { slot: "BR", corner: 7, edge: 11 },
];

const F2L_SIGNATURE_TABLE = createF2lSignatureTable();

/** 实战槽位开始的局面 → 命中的训练公式（未命中返回 null）。 */
export function recognizeF2lCaseFromCube(
  cube: CubieCube,
  slot: F2lCaseTargetSlot,
  targetFace: "U" | "D",
): F2lCaseMatch | null {
  // 签名表只覆盖白十字（D 面）模板；黄十字实战暂退回家族分类。
  if (targetFace !== "D") return null;
  const definition = findSlotDefinition(slot);
  const normalized = rotateCubeY(cube, SLOT_Y_ROTATIONS[slot]);
  const attempts = [
    normalized,
    normalized.applyMove(parseMove("U")),
    normalized.applyMove(parseMove("U2")),
    normalized.applyMove(parseMove("U'")),
  ];
  for (const attempt of attempts) {
    const formula = F2L_SIGNATURE_TABLE.get(extractPairSignature(attempt, definition.corner, definition.edge));
    if (formula) return toCaseMatch(formula);
  }
  return null;
}

/** 绕 U-D 轴把 F 面转到 R 面方向旋转 times 次，返回新 cube，不改入参。 */
export function rotateCubeY(cube: CubieCube, times: number): CubieCube {
  let result = new CubieCube();
  result.from(cube);
  const turns = ((times % 4) + 4) % 4;
  for (let turn = 0; turn < turns; turn++) {
    const rotated = new CubieCube();
    rotated.ca = [...Y_CORNER_PREV].map((prev) => result.ca[prev]);
    // E 层棱块朝向以 F/B 贴纸为参照，旋转会把参照面转到侧面，朝向位须翻转；角块与 U/D 层棱块朝向位不变。
    rotated.ea = [...Y_EDGE_PREV].map((prev, position) => {
      const value = result.ea[prev];
      return position >= 8 ? value ^ 1 : value;
    });
    result = rotated;
  }
  return result;
}

/** 提取目标对（按块 id 定位）的局部签名，格式 `${角位置},${角朝向},${棱位置},${棱朝向}`。 */
export function extractPairSignature(cube: CubieCube, cornerId: number, edgeId: number): string {
  const cornerPosition = cube.ca.findIndex((value) => (value & 7) === cornerId);
  const edgePosition = cube.ea.findIndex((value) => (value >> 1) === edgeId);
  if (cornerPosition < 0 || edgePosition < 0) {
    throw new Error("[F2L 识别] 无法定位目标角块或棱块，cube 状态非法");
  }
  const cornerOrientation = cube.ca[cornerPosition] >> 3;
  const edgeOrientation = cube.ea[edgePosition] & 1;
  return `${cornerPosition},${cornerOrientation},${edgePosition},${edgeOrientation}`;
}

function createF2lSignatureTable(): Map<string, Formula> {
  const table = new Map<string, Formula>();
  for (const formula of F2L_FORMULAS) {
    const setupCube = applyMoves(CubieCube.SOLVED, getFormulaSetupMoves(formula));
    if (!isCrossSolved(setupCube, "D")) continue;
    // 仅当 setup 恰好破坏一个槽位时才能确定目标槽；keyhole 类（如 F2L-31/32）破坏两个槽，退回家族分类。
    const targetSlot = findSingleUnsolvedSlot(setupCube);
    if (!targetSlot) continue;
    const definition = findSlotDefinition(targetSlot);
    const normalized = rotateCubeY(setupCube, SLOT_Y_ROTATIONS[targetSlot]);
    const signature = extractPairSignature(normalized, definition.corner, definition.edge);
    // 同一局部 case 的别名公式（如 F2L-03 与 F2L-25 同 case）：保留编号最小的公式。
    if (table.has(signature)) continue;
    table.set(signature, formula);
  }
  return table;
}

function findSingleUnsolvedSlot(cube: CubieCube): F2lCaseTargetSlot | null {
  const unsolved = D_SLOT_PIECES.filter((definition) =>
    cube.ca[definition.corner] !== definition.corner || cube.ea[definition.edge] !== definition.edge * 2);
  return unsolved.length === 1 ? unsolved[0].slot : null;
}

function findSlotDefinition(slot: F2lCaseTargetSlot): { slot: F2lCaseTargetSlot; corner: number; edge: number } {
  const definition = D_SLOT_PIECES.find((item) => item.slot === slot);
  if (!definition) throw new Error(`[F2L 识别] 未知槽位: ${slot}`);
  return definition;
}

function applyMoves(cube: CubieCube, moves: string[]): CubieCube {
  return moves.reduce((state, move) => state.applyMove(parseMove(move)), cube);
}
