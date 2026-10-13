/**
 * core/last-layer-recognizer.ts
 * 顶层（最后一层）OLL / PLL case 精确识别：由公式库 setup 局面构建本地签名表。
 *
 * 签名口径与 P0-1 的 F2L 签名一致——只取固定坐标系下目标块的状态，再对
 * U 层 4 种朝向（无 U / U / U2 / U'）做归一化，保证实战中带任意 AUF 的
 * 局面都能命中。识别本身不做 F2L 完成度校验，调用方（cfop-parser）负责
 * 只对底层归一到 D 面且 F2L 已严格完成的局面调用，避免误报。
 */

import { OLL_FORMULAS } from "../formula/oll-formulas.ts";
import { PLL_FORMULAS } from "../formula/pll-formulas.ts";
import { getFormulaSetupMoves } from "../formula/setup-validation.ts";
import { createCaseFacelets } from "../formula/cube-case-diagram.ts";
import type { Formula } from "../formula/types.ts";
import { CubieCube, parseMove } from "../utils/mathlib.ts";

export interface LastLayerCaseMatch {
  formulaId: string;
  name: string;
  tags: string[];
  confidence: "exact";
}

const OLL_SIGNATURE_TABLE = createOllSignatureTable();
const PLL_SIGNATURE_TABLE = createPllSignatureTable();

/** D 底层 F2L（含十字）是否严格完成：D 层角块、D 层棱块与 E 层棱块全部就位。 */
export function isF2lComplete(cube: CubieCube): boolean {
  for (let position = 4; position < 8; position++) {
    if (cube.ca[position] !== position) return false;
  }
  for (let position = 4; position < 12; position++) {
    if (cube.ea[position] !== position * 2) return false;
  }
  return true;
}

/** 顶层朝向是否完成：U 层 4 角 4 棱朝向位全 0（不检查排列）。 */
export function isOllComplete(cube: CubieCube): boolean {
  for (let position = 0; position < 4; position++) {
    if ((cube.ca[position] >> 3) !== 0) return false;
    if ((cube.ea[position] & 1) !== 0) return false;
  }
  return true;
}

/** 是否完全还原：用于区分「顶层已朝向 + 已归位」与真正的 PLL case 局面。 */
export function isCubeSolved(cube: CubieCube): boolean {
  if (!isF2lComplete(cube) || !isOllComplete(cube)) return false;
  for (let position = 0; position < 4; position++) {
    if ((cube.ca[position] & 7) !== position) return false;
    if ((cube.ea[position] >> 1) !== position) return false;
  }
  return true;
}

/** OLL 识别：未命中签名表（如顶层已朝向）返回 null。 */
export function recognizeOllCaseFromCube(cube: CubieCube): LastLayerCaseMatch | null {
  const formula = OLL_SIGNATURE_TABLE.get(canonicalSignature(cube, encodeOllSignature));
  return formula ? toCaseMatch(formula) : null;
}

/** PLL 识别：未命中签名表（如顶层已归位）返回 null。 */
export function recognizePllCaseFromCube(cube: CubieCube): LastLayerCaseMatch | null {
  const formula = PLL_SIGNATURE_TABLE.get(canonicalSignature(cube, encodePllSignature));
  return formula ? toCaseMatch(formula) : null;
}

/** OLL 签名：U 层 4 角朝向（0-2）+ 4 棱朝向（0-1），打包 12 bit。 */
function encodeOllSignature(cube: CubieCube): number {
  let value = 0;
  for (let position = 0; position < 4; position++) {
    value |= (cube.ca[position] >> 3) << (2 * position + 4);
  }
  for (let position = 0; position < 4; position++) {
    value |= (cube.ea[position] & 1) << position;
  }
  return value;
}

/** PLL 签名：U 层 4 角排列 + 4 棱排列（顶层朝向完成后朝向恒为 0），打包 16 bit。 */
function encodePllSignature(cube: CubieCube): number {
  let value = 0;
  for (let position = 0; position < 4; position++) {
    value |= (cube.ca[position] & 7) << (2 * (position + 4));
  }
  for (let position = 0; position < 4; position++) {
    value |= (cube.ea[position] >> 1) << (2 * position);
  }
  return value;
}

/** 对 U 层 4 种朝向（无 U / U / U2 / U'）取最小签名，消除 AUF 差异。 */
function canonicalSignature(cube: CubieCube, encode: (state: CubieCube) => number): number {
  const attempts = [
    cube,
    cube.applyMove(parseMove("U")),
    cube.applyMove(parseMove("U2")),
    cube.applyMove(parseMove("U'")),
  ];
  return Math.min(...attempts.map(encode));
}

function createOllSignatureTable(): Map<number, Formula> {
  const table = new Map<number, Formula>();
  for (const formula of OLL_FORMULAS) {
    const setup = formulaSetupState(formula);
    // 公式 setup 必须保证 D 底层 F2L 完整，否则跳过（数据有问题时宁缺毋滥）。
    if (!setup || !isF2lComplete(setup)) continue;
    const signature = canonicalSignature(setup, encodeOllSignature);
    // 同一 case 的备选公式（同签名）保留编号最小的公式。
    if (!table.has(signature)) table.set(signature, formula);
  }
  return table;
}

function createPllSignatureTable(): Map<number, Formula> {
  const table = new Map<number, Formula>();
  for (const formula of PLL_FORMULAS) {
    const setup = formulaSetupState(formula);
    if (!setup || !isF2lComplete(setup) || !isOllComplete(setup)) continue;
    const signature = canonicalSignature(setup, encodePllSignature);
    if (!table.has(signature)) table.set(signature, formula);
  }
  return table;
}

/** 由公式 setup 序列计算局面：走贴纸引擎以支持宽转/切片记号，再还原为 cubie 状态。 */
function formulaSetupState(formula: Formula): CubieCube | null {
  const facelets = createCaseFacelets(getFormulaSetupMoves(formula)).join("");
  return CubieCube.fromFaceCube(facelets);
}

function toCaseMatch(formula: Formula): LastLayerCaseMatch {
  return {
    formulaId: formula.id,
    name: formula.name,
    tags: [...formula.tags],
    confidence: "exact",
  };
}
