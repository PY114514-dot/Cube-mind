/** 实战 F2L 槽位进度追踪：只判断槽位完成与回退，不推断公式 case。 */

import { CubieCube, parseMove } from "../utils/mathlib.ts";
import { isCrossSolved } from "./cross-solver.ts";

export interface F2lSlotReview {
  slot: "FR" | "FL" | "BL" | "BR";
  completionOrder?: number;
  completedAtMove?: number;
  duration?: number;
  moves?: number;
  pauseCount: number;
  maxGap: number;
  breakCount: number;
  repairCount: number;
  completedWithCross: boolean;
}

export interface F2lSlotAnalysis {
  targetFace: "U" | "D";
  crossCompletedAtMove: number;
  crossDuration: number;
  slots: F2lSlotReview[];
}

interface SlotDefinition {
  slot: F2lSlotReview["slot"];
  corner: number;
  edge: number;
}

const D_SLOT_DEFINITIONS: SlotDefinition[] = [
  { slot: "FR", corner: 4, edge: 8 },
  { slot: "FL", corner: 5, edge: 9 },
  { slot: "BL", corner: 6, edge: 10 },
  { slot: "BR", corner: 7, edge: 11 },
];

const U_SLOT_DEFINITIONS: SlotDefinition[] = [
  { slot: "FR", corner: 0, edge: 8 },
  { slot: "FL", corner: 1, edge: 9 },
  { slot: "BL", corner: 2, edge: 10 },
  { slot: "BR", corner: 3, edge: 11 },
];

/**
 * 从完整状态回放中追踪 U/D 面 Cross 之后的四个 F2L 槽位。
 *
 * 返回 null 表示本把未进入白面朝上或朝下的 Cross，避免把非 CFOP 解法伪造成 F2L 数据。
 */
export function analyzeF2lSlots(
  scrambleMoves: string[],
  solveMoves: string[],
  moveTimes: number[],
  moveGaps: number[],
  solveStartTime: number,
  pauseThreshold: number,
): F2lSlotAnalysis | null {
  let cube = applyMoves(CubieCube.SOLVED, scrambleMoves);
  let targetFace = findCrossTarget(cube);
  let crossCompletedAtMove: number | undefined = targetFace ? 0 : undefined;
  let definitions = targetFace === "U" ? U_SLOT_DEFINITIONS : D_SLOT_DEFINITIONS;
  let crossDuration = 0;
  const slots = D_SLOT_DEFINITIONS.map(createSlotReview);
  let lastCompletionMove = 0;
  let lastCompletionTime = solveStartTime;
  let completionOrder = 0;

  if (crossCompletedAtMove !== undefined) {
    markSlotsSolvedWithCross(cube, slots, definitions);
    completionOrder = slots.filter((slot) => slot.completedWithCross).length;
    if (areAllSlotsCompleted(slots) && targetFace) {
      return { targetFace, crossCompletedAtMove, crossDuration, slots };
    }
  }

  for (let index = 0; index < solveMoves.length; index++) {
    cube = cube.applyMove(parseMove(solveMoves[index]));
    const completedMoves = index + 1;
    const timestamp = moveTimes[index] ?? solveStartTime;
    if (crossCompletedAtMove === undefined) {
      targetFace = findCrossTarget(cube);
      if (!targetFace) continue;
      definitions = targetFace === "U" ? U_SLOT_DEFINITIONS : D_SLOT_DEFINITIONS;
      crossCompletedAtMove = completedMoves;
      crossDuration = Math.max(0, timestamp - solveStartTime);
      lastCompletionMove = completedMoves;
      lastCompletionTime = timestamp;
      markSlotsSolvedWithCross(cube, slots, definitions);
      completionOrder = slots.filter((slot) => slot.completedWithCross).length;
      continue;
    }
    updateSlots(cube, slots, definitions, completedMoves, timestamp, moveGaps, pauseThreshold, {
      order: completionOrder,
      lastMove: lastCompletionMove,
      lastTime: lastCompletionTime,
    });
    const latest = slots.find((slot) => slot.completedAtMove === completedMoves);
    if (latest) {
      completionOrder = latest.completionOrder ?? completionOrder;
      lastCompletionMove = completedMoves;
      lastCompletionTime = timestamp;
    }
    // 四对均已首次完成后，后面的 OLL/PLL 不属于 F2L 复盘范围，不能计入槽位回退。
    if (areAllSlotsCompleted(slots)) break;
  }

  if (crossCompletedAtMove === undefined || !targetFace) return null;
  return { targetFace, crossCompletedAtMove, crossDuration, slots };
}

function applyMoves(cube: CubieCube, moves: string[]): CubieCube {
  return moves.reduce((state, move) => state.applyMove(parseMove(move)), cube);
}

function createSlotReview(definition: SlotDefinition): F2lSlotReview {
  return { slot: definition.slot, pauseCount: 0, maxGap: 0, breakCount: 0, repairCount: 0, completedWithCross: false };
}

function isSlotSolved(cube: CubieCube, definitions: SlotDefinition[], slot: F2lSlotReview["slot"]): boolean {
  const definition = definitions.find((item) => item.slot === slot);
  if (!definition) throw new Error(`[F2L 槽位] 未知槽位: ${slot}`);
  return cube.ca[definition.corner] === definition.corner && cube.ea[definition.edge] === definition.edge * 2;
}

function markSlotsSolvedWithCross(cube: CubieCube, slots: F2lSlotReview[], definitions: SlotDefinition[]): void {
  for (const slot of slots) {
    if (!isSlotSolved(cube, definitions, slot.slot)) continue;
    slot.completedWithCross = true;
    slot.completionOrder = 0;
    slot.completedAtMove = 0;
    slot.duration = 0;
    slot.moves = 0;
  }
}

function updateSlots(
  cube: CubieCube,
  slots: F2lSlotReview[],
  definitions: SlotDefinition[],
  completedMoves: number,
  timestamp: number,
  moveGaps: number[],
  pauseThreshold: number,
  previous: { order: number; lastMove: number; lastTime: number },
): void {
  for (const slot of slots) {
    const solved = isSlotSolved(cube, definitions, slot.slot);
    if (!solved || slot.completedAtMove !== undefined) continue;
    const gapStart = Math.min(Math.max(0, previous.lastMove), moveGaps.length);
    const gapEnd = Math.min(Math.max(gapStart, completedMoves), moveGaps.length);
    const gaps = moveGaps.slice(gapStart, gapEnd);
    slot.completionOrder = previous.order + 1;
    slot.completedAtMove = completedMoves;
    slot.duration = Math.max(0, timestamp - previous.lastTime);
    slot.moves = Math.max(0, completedMoves - previous.lastMove);
    slot.pauseCount = gaps.filter((gap) => gap >= pauseThreshold).length;
    slot.maxGap = gaps.length === 0 ? 0 : Math.max(...gaps);
  }
}

/** 将实战槽位追踪压缩为可直接放进 CFOP 结果的文本。 */
export function formatF2lSlotAnalysis(analysis: F2lSlotAnalysis | null): string {
  if (!analysis) return "F2L 槽位：未检测到白面朝上或朝下的 Cross，本把不输出逐对判断。";
  const lines = [`F2L 槽位复盘（${analysis.targetFace} 面 Cross，不按公式 case 归类）`];
  for (const slot of analysis.slots) {
    if (slot.completedWithCross) {
      lines.push(`${slot.slot}: 与 Cross 同时完成${slot.breakCount > 0 ? ` · 回退 ${slot.breakCount} 次` : ""}`);
      continue;
    }
    if (slot.completedAtMove === undefined) {
      lines.push(`${slot.slot}: 未完成${slot.breakCount > 0 ? ` · 曾回退 ${slot.breakCount} 次` : ""}`);
      continue;
    }
    const pauses = slot.pauseCount > 0 ? ` · 长停顿 ${slot.pauseCount} 次` : "";
    const repairs = slot.repairCount > 0 ? ` · 修复 ${slot.repairCount} 次` : "";
    const breaks = slot.breakCount > 0 ? ` · 回退 ${slot.breakCount} 次` : "";
    lines.push(`${slot.slot}: 第 ${slot.completionOrder} 对 · ${slot.moves} 步 · ${((slot.duration ?? 0) / 1000).toFixed(2)}s${pauses}${repairs}${breaks}`);
  }
  return lines.join("\n");
}

function findCrossTarget(cube: CubieCube): "U" | "D" | null {
  if (isCrossSolved(cube, "U")) return "U";
  if (isCrossSolved(cube, "D")) return "D";
  return null;
}

function areAllSlotsCompleted(slots: F2lSlotReview[]): boolean {
  return slots.every((slot) => slot.completedAtMove !== undefined);
}
