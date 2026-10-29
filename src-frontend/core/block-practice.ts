import type { BlockPracticeMode } from "../../src-shared/analysis-types.ts";
import { CubieCube } from "../utils/mathlib.ts";
import { isCrossSolved } from "./cross-solver.ts";

export const BLOCK_PRACTICE_LABELS: Record<BlockPracticeMode, string> = {
  cross: "Cross", f2l: "F2L", "cross-f2l": "Cross + F2L", xcross: "XC（十字 + 第一对）",
};

/** 实时停止与保存成绩共用终态验证；角棱必须同时归位且朝向正确。 */
export function isBlockPracticeComplete(mode: BlockPracticeMode, facelets: string): boolean {
  const cube = CubieCube.fromFaceCube(facelets);
  if (!cube || !isCrossSolved(cube, "U")) return false;
  if (mode === "cross") return true;
  const pairs = [0, 1, 2, 3].filter((i) => cube.ca[i] === i && cube.ea[8 + i] === (8 + i) * 2);
  return mode === "xcross" ? pairs.length > 0 : pairs.length === 4;
}
