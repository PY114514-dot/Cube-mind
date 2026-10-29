import type { CaseAlgorithmReference } from "../../src-shared/analysis-types.ts";
import { CubieCube, parseMove } from "../utils/mathlib.ts";
import { isCrossSolved, solveCross, solveXCross } from "./cross-solver.ts";
import { findFirstPairSolution } from "./f2l-solution-coach.ts";
import { formatMovesForWhiteBottom, normalizeCubeForD } from "./solve-notation.ts";

export const PAIR_SLOTS = ["FR", "FL", "BL", "BR"] as const;
export type PairSlot = typeof PAIR_SLOTS[number];
export const PAIR_COLORS: Record<PairSlot, string> = { FR: "白 · 红 · 蓝", FL: "白 · 蓝 · 橙", BL: "白 · 橙 · 绿", BR: "白 · 绿 · 红" };
export const CORNER_POSITIONS = ["URF", "UFL", "ULB", "UBR", "DFR", "DLF", "DBL", "DRB"] as const;
export const EDGE_POSITIONS = ["UR", "UF", "UL", "UB", "DR", "DF", "DL", "DB", "FR", "FL", "BL", "BR"] as const;

export interface CrossLesson {
  scramble: string;
  crossMoves: string[];
  slot: PairSlot;
  corner: string;
  edge: string;
  pairMoves: string[] | null;
  pairAlreadySolved: boolean;
}

export interface XCrossLesson {
  scramble: string;
  candidates: { slot: PairSlot; moves: string[] }[];
}

function readScramble(scramble: string): CubieCube {
  const moves = scramble.trim().split(/\s+/).filter(Boolean);
  if (!moves.every((move) => /^[URFDLB](?:2|')?$/.test(move))) throw new Error("打乱仅支持 U R F D L B 及逆转、半转。");
  return CubieCube.SOLVED.applyMoves(moves.map(parseMove));
}

/** 观察题从真实起点追踪两块，答案使用与白底 3D 一致的 x2 坐标。 */
export function buildCrossLesson(scramble: string, algorithms: CaseAlgorithmReference[], plannedMoves?: string[]): CrossLesson {
  const initial = readScramble(scramble);
  const crossMoves = plannedMoves ?? solveCross(scramble, "U", 8);
  if (!crossMoves.every((move) => /^[URFDLB](?:2|')?$/.test(move))) throw new Error("十字方案仅支持外层转动。");
  const after = initial.applyMoves(crossMoves.map(parseMove));
  if (!isCrossSolved(after, "U")) throw new Error("这个方案尚未完成白色十字，请检查持握和动作。");
  const normalized = normalizeCubeForD(after, "U");
  const solved = PAIR_SLOTS.find((_, i) => normalized.ca[4 + i] === 4 + i && normalized.ea[8 + i] === (8 + i) * 2);
  const candidate = solved ? null : findFirstPairSolution(normalized, algorithms);
  const slot = solved ?? candidate?.slot ?? "FR";
  const index = PAIR_SLOTS.indexOf(slot);
  return {
    scramble, crossMoves, slot,
    corner: CORNER_POSITIONS[normalized.ca.findIndex((value) => (value & 7) === 4 + index)],
    edge: EDGE_POSITIONS[normalized.ea.findIndex((value) => (value >> 1) === 8 + index)],
    pairMoves: candidate ? formatMovesForWhiteBottom(candidate.algorithm.moves, "U") : null,
    pairAlreadySolved: Boolean(solved),
  };
}

/** 比较四槽在八步内的解，并验证最终状态；空解只有在目标已完成时才成立。 */
export function buildXCrossLesson(scramble: string): XCrossLesson {
  const initial = readScramble(scramble);
  const fronts = ["B", "L", "F", "R"];
  const candidates = PAIR_SLOTS.flatMap((slot, i) => {
    const moves = solveXCross(scramble, "U", fronts[i]);
    const end = normalizeCubeForD(initial.applyMoves(moves.map(parseMove)), "U");
    return isCrossSolved(end, "D") && end.ca[4 + i] === 4 + i && end.ea[8 + i] === (8 + i) * 2
      ? [{ slot, moves }] : [];
  }).sort((a, b) => a.moves.length - b.moves.length);
  return { scramble, candidates };
}
