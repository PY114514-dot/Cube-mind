/** 实战 F2L 槽位进度追踪：判断槽位完成与回退，并用本地签名表识别公式 case 编号。 */

import { CubieCube, parseMove } from "../utils/mathlib.ts";
import { recognizeF2lCaseFromCube } from "./f2l-case-recognizer.ts";
import { formatMovesForWhiteBottom, formatF2lSlotForWhiteBottom, getCrossTarget } from "./solve-notation.ts";

export interface F2lSlotReview {
  slot: "FR" | "FL" | "BL" | "BR";
  completionOrder?: number;
  completedAtMove?: number;
  duration?: number;
  moves?: number;
  /** 从上一对完成后到本槽位首次完成的实际转动。 */
  moveSequence?: string[];
  pauseCount: number;
  maxGap: number;
  breakCount: number;
  repairCount: number;
  completedWithCross: boolean;
  /** 签名表精确命中的训练公式编号；未命中时保持 undefined。 */
  caseId?: string;
  /** 起始局面的可靠分类；精确 case 编号须由本地签名表命中后才会填充。 */
  caseFamily?: F2lCaseFamily;
  caseConfidence?: "exact" | "family" | "unknown";
  caseReason?: string;
}

export type F2lCaseFamily = "Free Pairs" | "Disconnected Pairs" | "Corner In Slot" | "Edge In Slot"
  | "Pieces In Slot" | "Trapped Corner" | "Trapped Edge" | "Both Pieces Trapped" | "unknown";

const F2L_CASE_FAMILY_LABELS: Record<F2lCaseFamily, string> = {
  "Free Pairs": "自由对",
  "Disconnected Pairs": "分离对",
  "Corner In Slot": "角上",
  "Edge In Slot": "棱上",
  "Pieces In Slot": "角棱上",
  "Trapped Corner": "非标 · 角下",
  "Trapped Edge": "非标 · 棱下",
  "Both Pieces Trapped": "非标 · 角棱下",
  unknown: "未知",
};

/** F2L family 的界面术语；内部英文枚举保留给签名表和 AI 证据使用。 */
export function formatF2lCaseFamily(family: F2lCaseFamily): string {
  return F2L_CASE_FAMILY_LABELS[family];
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
  let targetFace = getCrossTarget(cube);
  let crossCompletedAtMove: number | undefined = targetFace ? 0 : undefined;
  let definitions = targetFace === "U" ? U_SLOT_DEFINITIONS : D_SLOT_DEFINITIONS;
  let crossDuration = 0;
  const slots = D_SLOT_DEFINITIONS.map(createSlotReview);
  const slotSolvedState: Record<F2lSlotReview["slot"], boolean> = { FR: false, FL: false, BL: false, BR: false };
  let lastCompletionMove = 0;
  let lastCompletionTime = solveStartTime;
  let completionOrder = 0;
  let pairStartCube = cube;

  if (crossCompletedAtMove !== undefined) {
    markSlotsSolvedWithCross(cube, slots, definitions, slotSolvedState);
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
      targetFace = getCrossTarget(cube);
      if (!targetFace) continue;
      definitions = targetFace === "U" ? U_SLOT_DEFINITIONS : D_SLOT_DEFINITIONS;
      crossCompletedAtMove = completedMoves;
      crossDuration = Math.max(0, timestamp - solveStartTime);
      lastCompletionMove = completedMoves;
      lastCompletionTime = timestamp;
      markSlotsSolvedWithCross(cube, slots, definitions, slotSolvedState);
      completionOrder = slots.filter((slot) => slot.completedWithCross).length;
      pairStartCube = cube;
      continue;
    }
    updateSlots(cube, slots, definitions, solveMoves, completedMoves, timestamp, moveGaps, pauseThreshold, slotSolvedState, {
      order: completionOrder,
      lastMove: lastCompletionMove,
      lastTime: lastCompletionTime,
    });
    const latestOrder = Math.max(...slots.map((slot) => slot.completionOrder ?? 0), completionOrder);
    if (latestOrder > completionOrder) {
      for (const slot of slots.filter((item) => (item.completionOrder ?? 0) > completionOrder)) {
        const definition = definitions.find((item) => item.slot === slot.slot);
        if (!definition) continue;
        const classification = classifyF2lCaseFamily(pairStartCube, definition, definitions, targetFace ?? "D");
        slot.caseFamily = classification.family;
        slot.caseConfidence = classification.confidence;
        slot.caseReason = classification.reason;
        // 签名表精确命中时以公式编号为准，覆盖家族分类。
        const caseMatch = recognizeF2lCaseFromCube(pairStartCube, definition.slot, targetFace ?? "D");
        if (caseMatch) {
          slot.caseId = caseMatch.formulaId;
          slot.caseConfidence = "exact";
          slot.caseReason = `本地签名表精确命中 ${caseMatch.formulaId}`;
        }
      }
      completionOrder = latestOrder;
      lastCompletionMove = completedMoves;
      lastCompletionTime = timestamp;
      pairStartCube = cube;
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

function markSlotsSolvedWithCross(
  cube: CubieCube,
  slots: F2lSlotReview[],
  definitions: SlotDefinition[],
  slotSolvedState: Record<F2lSlotReview["slot"], boolean>,
): void {
  for (const slot of slots) {
    if (!isSlotSolved(cube, definitions, slot.slot)) continue;
    slot.completedWithCross = true;
    slot.completionOrder = 0;
    slot.completedAtMove = 0;
    slot.duration = 0;
    slot.moves = 0;
    slotSolvedState[slot.slot] = true;
  }
}

function updateSlots(
  cube: CubieCube,
  slots: F2lSlotReview[],
  definitions: SlotDefinition[],
  solveMoves: string[],
  completedMoves: number,
  timestamp: number,
  moveGaps: number[],
  pauseThreshold: number,
  slotSolvedState: Record<F2lSlotReview["slot"], boolean>,
  previous: { order: number; lastMove: number; lastTime: number },
): void {
  let nextOrder = previous.order;
  for (const slot of slots) {
    const solved = isSlotSolved(cube, definitions, slot.slot);
    if (slot.completedAtMove !== undefined) {
      // Cross 时已经归位的槽位不算 F2L 复盘对象；后续 OLL/PLL 也不应把它标成回退。
      if (slot.completedWithCross) continue;
      if (slotSolvedState[slot.slot] && !solved) {
        slot.breakCount++;
        slotSolvedState[slot.slot] = false;
      } else if (!slotSolvedState[slot.slot] && solved) {
        slot.repairCount++;
        slotSolvedState[slot.slot] = true;
      }
      continue;
    }
    if (!solved) continue;
    const gapStart = Math.min(Math.max(0, previous.lastMove), moveGaps.length);
    const gapEnd = Math.min(Math.max(gapStart, completedMoves), moveGaps.length);
    const gaps = moveGaps.slice(gapStart, gapEnd);
    nextOrder++;
    slot.completionOrder = nextOrder;
    slot.completedAtMove = completedMoves;
    slot.duration = Math.max(0, timestamp - previous.lastTime);
    slot.moves = Math.max(0, completedMoves - previous.lastMove);
    slot.moveSequence = solveMoves.slice(previous.lastMove, completedMoves);
    slot.pauseCount = gaps.filter((gap) => gap > pauseThreshold).length;
    slot.maxGap = gaps.length === 0 ? 0 : Math.max(...gaps);
    slotSolvedState[slot.slot] = true;
  }
}

/** 将实战槽位追踪压缩为可直接放进 CFOP 结果的文本。 */
export function formatF2lSlotAnalysis(analysis: F2lSlotAnalysis | null): string {
  if (!analysis) return "F2L 槽位：未检测到白面朝上或朝下的 Cross，本把不输出逐对判断。";
  const crossColor = analysis.targetFace === "U" ? "白色" : "黄色";
  const notation = analysis.targetFace === "U" ? "白底视角" : "原始面码";
  const lines = [`F2L 槽位复盘（${notation} · ${crossColor} Cross，签名表命中时标注公式编号）`];
  const orderedSlots = [...analysis.slots].sort((left, right) =>
    (left.completionOrder ?? Number.MAX_SAFE_INTEGER) - (right.completionOrder ?? Number.MAX_SAFE_INTEGER));
  for (const slot of orderedSlots) {
    if (slot.completedWithCross) {
      lines.push(`${formatF2lSlotForWhiteBottom(slot.slot, analysis.targetFace)}: 与 Cross 同时完成`);
      continue;
    }
    if (slot.completedAtMove === undefined) {
      lines.push(`${formatF2lSlotForWhiteBottom(slot.slot, analysis.targetFace)}: 未完成`);
      continue;
    }
    const pauses = slot.pauseCount > 0 ? ` · 长停顿 ${slot.pauseCount} 次` : "";
    const pairLabel = `F2L-${slot.completionOrder ?? "?"}`;
    const caseLabel = slot.caseId
      ? ` · ${slot.caseId}`
      : slot.caseFamily && slot.caseFamily !== "unknown" ? ` · ${formatF2lCaseFamily(slot.caseFamily)}` : "";
    const displaySlot = formatF2lSlotForWhiteBottom(slot.slot, analysis.targetFace);
    const displayMoves = slot.moveSequence ? formatMovesForWhiteBottom(slot.moveSequence, analysis.targetFace) : [];
    lines.push(`${pairLabel} (${displaySlot})${caseLabel} · ${slot.moves ?? 0}步${pauses}`);
    lines.push(`  转动: ${displayMoves.join(" ") || "—"}`);
  }
  return lines.join("\n");
}

function classifyF2lCaseFamily(
  cube: CubieCube,
  target: SlotDefinition,
  definitions: SlotDefinition[],
  targetFace: "U" | "D",
): { family: F2lCaseFamily; confidence: "family" | "unknown"; reason: string } {
  const cornerPosition = cube.ca.findIndex((value) => (value & 7) === target.corner);
  const edgePosition = cube.ea.findIndex((value) => (value >> 1) === target.edge);
  const otherCorners = definitions.filter((item) => item.slot !== target.slot).map((item) => item.corner);
  const otherEdges = definitions.filter((item) => item.slot !== target.slot).map((item) => item.edge);
  const cornerTrapped = otherCorners.includes(cornerPosition);
  const edgeTrapped = otherEdges.includes(edgePosition);
  if (cornerTrapped && edgeTrapped) return { family: "Both Pieces Trapped", confidence: "family", reason: "目标角块和棱块均位于其它 F2L 槽位" };
  if (cornerTrapped) return { family: "Trapped Corner", confidence: "family", reason: "目标角块位于其它 F2L 槽位" };
  if (edgeTrapped) return { family: "Trapped Edge", confidence: "family", reason: "目标棱块位于其它 F2L 槽位" };
  if (cornerPosition === target.corner && edgePosition === target.edge) return { family: "Pieces In Slot", confidence: "family", reason: "目标角棱均在目标槽位" };
  if (cornerPosition === target.corner) return { family: "Corner In Slot", confidence: "family", reason: "目标角块已在目标槽位" };
  if (edgePosition === target.edge) return { family: "Edge In Slot", confidence: "family", reason: "目标棱块已在目标槽位" };
  const lastLayerPositions = targetFace === "U" ? [4, 5, 6, 7] : [0, 1, 2, 3];
  if (lastLayerPositions.includes(cornerPosition) && lastLayerPositions.includes(edgePosition)) {
    return { family: "Disconnected Pairs", confidence: "family", reason: "目标角块和棱块均在最后一层，尚未成对" };
  }
  return { family: "unknown", confidence: "unknown", reason: "局部状态不满足可靠的标准或被困分类" };
}

function areAllSlotsCompleted(slots: F2lSlotReview[]): boolean {
  return slots.every((slot) => slot.completedAtMove !== undefined);
}
