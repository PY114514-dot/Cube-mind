/**
 * Cross 求解器：从标准打乱后的状态搜索 D 层十字解法。
 * 只搜索四个 D 层棱块，结果用于训练提示，不替代完整解法。
 */
import { CubieCube, moveToStr, parseMove } from "../utils/mathlib.ts";

const MOVE_INDICES = Array.from({ length: 18 }, (_, index) => index);
const MAX_DEPTH = 8;
const XCROSS_MAX_DEPTH = 8;
const EDGE_MOVE_CUBES = CubieCube.moveCube.map((move) => move.ea);
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
  return isCrossEdgesSolved(cube.ea, face);
}

function isCrossEdgesSolved(edges: number[], face: string): boolean {
  for (const position of CROSS_POSITIONS[face]) {
    if (edges[position] !== position * 2) return false;
  }
  return true;
}

function misplacedEdges(cube: CubieCube, face: string): number {
  return misplacedEdgeArray(cube.ea, face);
}

function misplacedEdgeArray(edges: number[], face: string): number {
  let count = 0;
  for (const position of CROSS_POSITIONS[face]) {
    if (edges[position] !== position * 2) count++;
  }
  return count;
}

type CrossDistanceTable = Map<number, number>;
const crossDistanceTables = new Map<string, CrossDistanceTable>();

/** Apply a move to the full CubieCube edge array (ea values are perm << 1 | ori). */
function applyFullEdgeMove(edges: number[], move: number): number[] {
  const transform = EDGE_MOVE_CUBES[move];
  return transform.map((value) => edges[value >> 1] ^ (value & 1));
}

/**
 * Apply a move to the compact Cross-only state used by the distance table.
 * Zero means that the edge is outside the four tracked Cross pieces, while
 * non-zero values use (trackedPieceIndex * 2 + orientation + 1).
 */
function applyCrossStateMove(state: number[], move: number): number[] {
  const transform = EDGE_MOVE_CUBES[move];
  return transform.map((value) => {
    const source = state[value >> 1];
    if (source === 0) return 0;
    return ((source - 1) ^ (value & 1)) + 1;
  });
}

function projectCrossState(edges: number[], face: string): number[] {
  const targetPositions = CROSS_POSITIONS[face];
  const pieceIndexes = new Array<number>(12).fill(-1);
  targetPositions.forEach((piece, index) => { pieceIndexes[piece] = index; });
  const state = new Array<number>(12).fill(0);
  for (let position = 0; position < edges.length; position++) {
    const pieceIndex = pieceIndexes[edges[position] >> 1];
    if (pieceIndex >= 0) state[position] = pieceIndex * 2 + (edges[position] & 1) + 1;
  }
  return state;
}

function encodeCrossState(state: number[]): number {
  let key = 0;
  for (const value of state) key = key * 9 + value;
  return key;
}

function buildCrossDistanceTable(face: string): CrossDistanceTable {
  const targetPositions = CROSS_POSITIONS[face];
  const solved = new Array<number>(12).fill(0);
  targetPositions.forEach((position, index) => { solved[position] = index * 2 + 1; });
  const table: CrossDistanceTable = new Map([[encodeCrossState(solved), 0]]);
  const queue: number[][] = [solved];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const distance = table.get(encodeCrossState(current)) ?? 0;
    for (const move of MOVE_INDICES) {
      const next = applyCrossStateMove(current, move);
      const key = encodeCrossState(next);
      if (table.has(key)) continue;
      table.set(key, distance + 1);
      queue.push(next);
    }
  }
  return table;
}

function getCrossDistance(edges: number[], face: string): number {
  let table = crossDistanceTables.get(face);
  if (!table) {
    table = buildCrossDistanceTable(face);
    crossDistanceTables.set(face, table);
  }
  return table.get(encodeCrossState(projectCrossState(edges, face))) ?? Number.POSITIVE_INFINITY;
}

function getCrossStateDistance(state: number[], face: string): number {
  let table = crossDistanceTables.get(face);
  if (!table) {
    table = buildCrossDistanceTable(face);
    crossDistanceTables.set(face, table);
  }
  return table.get(encodeCrossState(state)) ?? Number.POSITIVE_INFINITY;
}

function findCrossStatePath(targetSteps: number, face: string): number[] | null {
  const solved = new Array<number>(12).fill(0);
  CROSS_POSITIONS[face].forEach((position, index) => { solved[position] = index * 2 + 1; });
  const visited = new Set<string>();

  const searchPath = (state: number[], depth: number): number[] | null => {
    if (depth === targetSteps) return [];
    const stateKey = `${depth}|${encodeCrossState(state)}`;
    if (visited.has(stateKey)) return null;
    visited.add(stateKey);

    const candidates = MOVE_INDICES.filter((move) =>
      getCrossStateDistance(applyCrossStateMove(state, move), face) === depth + 1);
    // Randomize equal-length branches so repeated training rounds do not use one pattern.
    for (let index = candidates.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1));
      [candidates[index], candidates[swap]] = [candidates[swap], candidates[index]];
    }
    for (const move of candidates) {
      const suffix = searchPath(applyCrossStateMove(state, move), depth + 1);
      if (suffix) return [move, ...suffix];
    }
    return null;
  };

  return searchPath(solved, 0);
}

export function getCrossDistanceForScramble(scramble: string, targetFace = "D"): number {
  const face = targetFace.toUpperCase();
  if (!CROSS_POSITIONS[face]) throw new Error(`不支持的 Cross 目标面: ${targetFace}`);
  const scrambleMoves = scramble.trim() ? scramble.trim().split(/\s+/) : [];
  let state = CubieCube.SOLVED;
  for (const move of scrambleMoves) state = state.applyMove(parseMove(move));
  return getCrossDistance(state.ea, face);
}

/** 生成一个 Cross 最短解恰好为指定步数的短训练序列。 */
export function generateCrossDistanceScramble(targetSteps: number, targetFace = "D"): string {
  const face = targetFace.toUpperCase();
  if (!CROSS_POSITIONS[face]) throw new Error(`不支持的 Cross 目标面: ${targetFace}`);
  if (!Number.isInteger(targetSteps) || targetSteps < 1 || targetSteps > MAX_DEPTH) {
    throw new Error(`Cross 步数必须在 1 到 ${MAX_DEPTH} 之间`);
  }

  const path = findCrossStatePath(targetSteps, face);
  if (!path) throw new Error(`无法构造 ${targetSteps} 步 Cross 训练状态`);
  return path.map(moveToStr).join(" ");
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
  edges: number[],
  depth: number,
  limit: number,
  path: number[],
  lastFace: number,
  targetFace: string,
  seen: Set<string>,
): boolean {
  if (isCrossEdgesSolved(edges, targetFace)) return true;
  // 单次外层转动最多同时影响两条目标 Cross 棱，因此这是可采纳的保守下界。
  if (depth >= limit || depth + Math.ceil(misplacedEdgeArray(edges, targetFace) / 2) > limit) return false;
  const stateKey = `${depth}|${lastFace}|${edges.join(",")}`;
  if (seen.has(stateKey)) return false;
  seen.add(stateKey);

  for (const move of MOVE_INDICES) {
    const face = Math.floor(move / 3);
    if (face === lastFace) continue;
    path.push(move);
    const nextEdges = applyFullEdgeMove(edges, move);
    if (search(nextEdges, depth + 1, limit, path, face, targetFace, seen)) return true;
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
  const limitDepth = Math.max(1, Math.min(MAX_DEPTH, Math.floor(maxDepth)));
  const shortestDepth = getCrossDistance(state.ea, face);
  if (shortestDepth === 0 || shortestDepth > limitDepth) return [];

  // Cross 只依赖 12 条棱。先用坐标表按距离逐步回溯，避免在同一状态重复展开完整魔方。
  let edges = state.ea.slice();
  const path: number[] = [];
  let distance = shortestDepth;
  while (distance > 0) {
    let found = false;
    for (const move of MOVE_INDICES) {
      const nextEdges = applyFullEdgeMove(edges, move);
      if (getCrossDistance(nextEdges, face) !== distance - 1) continue;
      path.push(move);
      edges = nextEdges;
      distance--;
      found = true;
      break;
    }
    if (!found) break;
  }
  if (distance === 0) return path.map(moveToStr);

  // 坐标表在极端非法状态下可能无法回溯，保留原搜索作为安全兜底。
  for (let limit = 1; limit <= limitDepth; limit++) {
    const fallbackPath: number[] = [];
    if (search(state.ea, 0, limit, fallbackPath, -1, face, new Set<string>())) return fallbackPath.map(moveToStr);
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
