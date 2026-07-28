/**
 * Cross 求解器：从标准打乱后的状态搜索 D 层十字解法。
 * 只搜索四个 D 层棱块，结果用于训练提示，不替代完整解法。
 */
import { CubieCube, moveToStr, parseMove } from "../utils/mathlib.ts";

const MOVE_INDICES = Array.from({ length: 18 }, (_, index) => index);
const MAX_DEPTH = 8;
const XCROSS_MAX_DEPTH = 8;
const CROSS_POSITIONS: Record<string, number[]> = {
  U: [0, 1, 2, 3],
  R: [0, 4, 8, 11],
  F: [1, 5, 8, 9],
  D: [4, 5, 6, 7],
  L: [2, 6, 9, 10],
  B: [3, 7, 10, 11],
};

const XCROSS_SLOTS: Record<string, Record<string, [number, number]>> = {
  U: { F: [1, 9], R: [0, 8], B: [3, 11], L: [2, 10] },
  R: { U: [0, 0], F: [4, 8], D: [7, 4], B: [3, 11] },
  F: { U: [1, 1], R: [0, 0], D: [4, 5], L: [5, 9] },
  D: { F: [4, 8], R: [7, 11], B: [6, 10], L: [5, 9] },
  L: { U: [1, 2], F: [5, 9], D: [6, 6], B: [2, 10] },
  B: { U: [3, 3], L: [2, 2], D: [6, 7], R: [7, 11] },
};

export function isCrossSolved(cube: CubieCube, face: string): boolean {
  for (const position of CROSS_POSITIONS[face]) {
    if (cube.ea[position] !== position * 2) return false;
  }
  return true;
}

function misplacedEdges(cube: CubieCube, face: string): number {
  let count = 0;
  for (const position of CROSS_POSITIONS[face]) {
    if (cube.ea[position] !== position * 2) count++;
  }
  return count;
}

function isXCrossSolved(cube: CubieCube, face: string, front: string): boolean {
  if (!isCrossSolved(cube, face)) return false;
  const slot = XCROSS_SLOTS[face][front];
  return cube.ca[slot[0]] === slot[0] && cube.ea[slot[1]] === slot[1] * 2;
}

function misplacedXCrossPieces(cube: CubieCube, face: string, front: string): number {
  const slot = XCROSS_SLOTS[face][front];
  return misplacedEdges(cube, face)
    + (cube.ca[slot[0]] === slot[0] ? 0 : 1)
    + (cube.ea[slot[1]] === slot[1] * 2 ? 0 : 1);
}

function search(
  cube: CubieCube,
  depth: number,
  limit: number,
  path: number[],
  lastFace: number,
  targetFace: string,
): boolean {
  if (isCrossSolved(cube, targetFace)) return true;
  // 单次外层转动最多同时影响两条目标 Cross 棱，因此这是可采纳的保守下界。
  if (depth >= limit || depth + Math.ceil(misplacedEdges(cube, targetFace) / 2) > limit) return false;

  for (const move of MOVE_INDICES) {
    const face = Math.floor(move / 3);
    if (face === lastFace) continue;
    path.push(move);
    if (search(cube.applyMove(move), depth + 1, limit, path, face, targetFace)) return true;
    path.pop();
  }
  return false;
}

function searchXCross(
  cube: CubieCube,
  depth: number,
  limit: number,
  path: number[],
  lastFace: number,
  targetFace: string,
  frontFace: string,
): boolean {
  if (isXCrossSolved(cube, targetFace, frontFace)) return true;
  if (depth >= limit || depth + Math.ceil(misplacedXCrossPieces(cube, targetFace, frontFace) / 2) > limit) return false;

  for (const move of MOVE_INDICES) {
    const face = Math.floor(move / 3);
    if (face === lastFace) continue;
    path.push(move);
    if (searchXCross(cube.applyMove(move), depth + 1, limit, path, face, targetFace, frontFace)) return true;
    path.pop();
  }
  return false;
}

export function solveCross(scramble: string, targetFace = "D", maxDepth = MAX_DEPTH): string[] {
  const face = targetFace.toUpperCase();
  if (!CROSS_POSITIONS[face]) throw new Error(`不支持的 Cross 目标面: ${targetFace}`);
  const scrambleMoves = scramble.trim() ? scramble.trim().split(/\s+/) : [];
  let state = CubieCube.SOLVED;
  for (const move of scrambleMoves) state = state.applyMove(parseMove(move));
  if (isCrossSolved(state, face)) return [];

  const limitDepth = Math.max(1, Math.min(MAX_DEPTH, Math.floor(maxDepth)));
  for (let limit = 1; limit <= limitDepth; limit++) {
    const path: number[] = [];
    if (search(state, 0, limit, path, -1, face)) return path.map(moveToStr);
  }
  return [];
}

export function getXCrossFrontFaces(targetFace = "D"): string[] {
  const face = targetFace.toUpperCase();
  if (!XCROSS_SLOTS[face]) throw new Error(`不支持的 Cross 目标面: ${targetFace}`);
  return Object.keys(XCROSS_SLOTS[face]);
}

export function solveXCross(scramble: string, targetFace = "D", frontFace = "F"): string[] {
  const face = targetFace.toUpperCase();
  const front = frontFace.toUpperCase();
  if (!XCROSS_SLOTS[face]?.[front]) throw new Error(`不支持的 X-Cross 起手面: ${targetFace}/${frontFace}`);
  const scrambleMoves = scramble.trim() ? scramble.trim().split(/\s+/) : [];
  let state = CubieCube.SOLVED;
  for (const move of scrambleMoves) state = state.applyMove(parseMove(move));
  if (isXCrossSolved(state, face, front)) return [];

  for (let limit = 1; limit <= XCROSS_MAX_DEPTH; limit++) {
    const path: number[] = [];
    if (searchXCross(state, 0, limit, path, -1, face, front)) return path.map(moveToStr);
  }
  return [];
}

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
