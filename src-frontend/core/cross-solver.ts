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
