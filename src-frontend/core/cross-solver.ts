/**
 * Cross / X-Cross 求解器门面。
 * 表构建与距离查询在 cross-tables.ts，Cross 求解在 cross-search.ts，
 * X-Cross 求解在 xcross-solver.ts；本文件统一对外 API 并保留既有 import 路径。
 */
export {
  isCrossSolved, getCrossDistanceForScramble, createCrossDistanceScorer,
  type CrossDistanceScorer,
} from "./cross-tables.ts";
export { generateCrossDistanceScramble, solveCross } from "./cross-search.ts";
export { getXCrossFrontFaces, solveXCross } from "./xcross-solver.ts";

// ===== 白底朝下换算 =====

const WHITE_DOWN_FACE_MAP: Record<string, Record<string, string>> = {
  F: { U: "D", D: "U", R: "L", L: "R", F: "F", B: "B" },
  R: { U: "D", D: "U", F: "R", R: "F", B: "L", L: "B" },
  B: { U: "D", D: "U", R: "R", L: "L", F: "B", B: "F" },
  L: { U: "D", D: "U", F: "L", L: "F", R: "B", B: "R" },
};

export function convertSolutionForWhiteDown(moves: string[], frontFace: string): string[] {
  const map = WHITE_DOWN_FACE_MAP[frontFace.toUpperCase()];
  if (!map) throw new Error(`不支持的白底朝下起手面: ${frontFace}`);
  return moves.map((move) => `${map[move[0].toUpperCase()]}${move.slice(1)}`);
}
