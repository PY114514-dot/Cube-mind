/**
 * X-Cross 求解：IDA*，状态 = 十字打包码 + 槽位角块 + 槽位棱块，
 * 启发式取三个分量到各自目标的精确距离最大值（可采纳）。
 */
import { moveToStr, parseMove } from "../utils/mathlib.ts";
import {
  applyEdgeMoveToCode, applyScrambleToEdges, CORNER_TRANSITIONS, EDGE_TRANSITIONS,
  getCornerTable, getCrossTable, getEdgeTable, MOVE_INDICES, projectEdgeCode,
  solvedCrossCode, XCROSS_MAX_DEPTH, XCROSS_SLOTS,
} from "./cross-tables.ts";

export function getXCrossFrontFaces(targetFace = "D"): string[] {
  const face = targetFace.toUpperCase();
  if (!XCROSS_SLOTS[face]) throw new Error(`不支持的 Cross 目标面: ${targetFace}`);
  return Object.keys(XCROSS_SLOTS[face]);
}

function searchXCross(
  edgeCode: number,
  cornerState: number,
  slotEdgeState: number,
  depth: number,
  limit: number,
  path: number[],
  lastFace: number,
  edgeDistances: Uint8Array,
  cornerDistances: Uint8Array,
  slotEdgeDistances: Uint8Array,
  solvedEdgeCode: number,
  solvedCorner: number,
  solvedSlotEdge: number,
): boolean {
  const crossDistance = edgeDistances[edgeCode];
  const cornerDistance = cornerDistances[cornerState];
  const slotEdgeDistance = slotEdgeDistances[slotEdgeState];
  if (crossDistance === 0 && cornerDistance === 0 && slotEdgeDistance === 0) return true;
  const heuristic = Math.max(crossDistance, cornerDistance, slotEdgeDistance);
  if (depth >= limit || depth + heuristic > limit) return false;

  for (const move of MOVE_INDICES) {
    const face = Math.floor(move / 3);
    if (face === lastFace) continue;
    path.push(move);
    if (searchXCross(
      applyEdgeMoveToCode(edgeCode, move),
      CORNER_TRANSITIONS[move][cornerState],
      EDGE_TRANSITIONS[move][slotEdgeState],
      depth + 1, limit, path, face,
      edgeDistances, cornerDistances, slotEdgeDistances,
      solvedEdgeCode, solvedCorner, solvedSlotEdge,
    )) return true;
    path.pop();
  }
  return false;
}

export function solveXCross(scramble: string, targetFace = "D", frontFace = "F"): string[] {
  const face = targetFace.toUpperCase();
  const front = frontFace.toUpperCase();
  const slot = XCROSS_SLOTS[face]?.[front];
  if (!slot) throw new Error(`不支持的 X-Cross 起手面: ${targetFace}/${frontFace}`);
  const [cornerSlot, edgeSlot] = slot;

  const edges = applyScrambleToEdges(scramble);
  const edgeCode = projectEdgeCode(edges, face);
  const tokens = scramble.trim() ? scramble.trim().split(/\s+/) : [];
  // 追踪槽位角块与槽位棱块两块：从各自初始位置沿打乱序列推到当前状态。
  let cornerState = cornerSlot * 3;
  let slotEdgeState = edgeSlot * 2;
  for (const token of tokens) {
    const move = parseMove(token);
    cornerState = CORNER_TRANSITIONS[move][cornerState];
    slotEdgeState = EDGE_TRANSITIONS[move][slotEdgeState];
  }
  const solvedEdgeCode = solvedCrossCode(face);
  if (edgeCode === solvedEdgeCode && cornerState === cornerSlot * 3 && slotEdgeState === edgeSlot * 2) return [];

  const path: number[] = [];
  for (let limit = 1; limit <= XCROSS_MAX_DEPTH; limit++) {
    if (searchXCross(
      edgeCode, cornerState, slotEdgeState, 0, limit, path, -1,
      getCrossTable(face), getCornerTable(cornerSlot), getEdgeTable(edgeSlot),
      solvedEdgeCode, cornerSlot * 3, edgeSlot * 2,
    )) return path.map(moveToStr);
  }
  return [];
}
