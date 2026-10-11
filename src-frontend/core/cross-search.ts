/**
 * Cross 求解与训练打乱：距离表逐步回溯，极端非法状态退回 IDDFS 兜底。
 */
import { moveToStr } from "../utils/mathlib.ts";
import {
  applyEdgeMoveToCode, applyFullEdgeMove, applyScrambleToEdges, CROSS_CODE_SIZE,
  CROSS_POSITIONS, getCrossCodeDistance, getCrossDistance, isCrossEdgesSolved,
  misplacedEdgeArray, MAX_DEPTH, MOVE_INDICES, projectEdgeCode, solvedCrossCode,
} from "./cross-tables.ts";

// ===== 训练打乱构造（最短 Cross 恰好 N 步） =====

function findCrossStatePath(targetSteps: number, face: string): number[] | null {
  const solved = solvedCrossCode(face);
  const visited = new Set<number>();

  const searchPath = (code: number, depth: number): number[] | null => {
    if (depth === targetSteps) return [];
    // 同一状态可在不同深度到达，按 (深度,状态) 去重避免重复展开。
    const stateKey = depth * CROSS_CODE_SIZE + code;
    if (visited.has(stateKey)) return null;
    visited.add(stateKey);

    const candidates = MOVE_INDICES.filter((move) =>
      getCrossCodeDistance(applyEdgeMoveToCode(code, move), face) === depth + 1);
    // 打乱等长分支顺序，避免多轮训练反复出现同一种套路。
    for (let index = candidates.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1));
      [candidates[index], candidates[swap]] = [candidates[swap], candidates[index]];
    }
    for (const move of candidates) {
      const suffix = searchPath(applyEdgeMoveToCode(code, move), depth + 1);
      if (suffix) return [move, ...suffix];
    }
    return null;
  };

  return searchPath(solved, 0);
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

// ===== Cross 求解 =====

/** 距离表不可用时的保守兜底搜索（IDDFS + 可采纳下界）。 */
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
    if (search(applyFullEdgeMove(edges, move), depth + 1, limit, path, face, targetFace, seen)) return true;
    path.pop();
  }
  return false;
}

export function solveCross(scramble: string, targetFace = "D", maxDepth = MAX_DEPTH): string[] {
  const face = targetFace.toUpperCase();
  if (!CROSS_POSITIONS[face]) throw new Error(`不支持的 Cross 目标面: ${targetFace}`);
  const limitDepth = Math.max(1, Math.min(MAX_DEPTH, Math.floor(maxDepth)));
  const edges = applyScrambleToEdges(scramble);
  const shortestDepth = getCrossDistance(edges, face);
  if (shortestDepth === 0 || shortestDepth > limitDepth) return [];

  // 从打乱状态沿距离表逐步回溯：每一步选一个让距离恰好减 1 的转动。
  let code = projectEdgeCode(edges, face);
  const path: number[] = [];
  let distance = shortestDepth;
  while (distance > 0) {
    let found = false;
    for (const move of MOVE_INDICES) {
      const next = applyEdgeMoveToCode(code, move);
      if (getCrossCodeDistance(next, face) !== distance - 1) continue;
      path.push(move);
      code = next;
      distance--;
      found = true;
      break;
    }
    if (!found) break;
  }
  if (distance === 0) return path.map(moveToStr);

  // 距离表在极端非法状态下可能无法回溯，保留原搜索作为安全兜底。
  for (let limit = 1; limit <= limitDepth; limit++) {
    const fallbackPath: number[] = [];
    if (search(edges, 0, limit, fallbackPath, -1, face, new Set<string>())) return fallbackPath.map(moveToStr);
  }
  return [];
}
