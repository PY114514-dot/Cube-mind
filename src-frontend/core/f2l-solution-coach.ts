import type { AnalysisInput, CaseAlgorithmReference, F2lSolutionReview } from "../../src-shared/analysis-types.ts";
import { CubieCube, parseMove } from "../utils/mathlib.ts";
import { isCrossSolved } from "./cross-solver.ts";
import { compactMoves } from "./practice-transition.ts";
import { formatF2lSlotForWhiteBottom, formatMovesForWhiteBottom, getSolveTargetFace, normalizeCubeForD } from "./solve-notation.ts";
import { resolvePersistedSolveTrust } from "./solve-validation.ts";

const SLOTS = ["FR", "FL", "BL", "BR"] as const;
type Slot = typeof SLOTS[number];
const AUFS = [[], ["U"], ["U2"], ["U'"]];

function solvedSlots(cube: CubieCube): Slot[] {
  return SLOTS.filter((_, index) => cube.ca[4 + index] === 4 + index && cube.ea[8 + index] === (8 + index) * 2);
}

function rotateAlgorithm(moves: string[], turns: number): string[] {
  const ring = "FRBL";
  return moves.map((move) => {
    const index = ring.indexOf(move[0]);
    return index < 0 ? move : `${ring[(index + turns) % 4]}${move.slice(1)}`;
  });
}

function candidateAlgorithms(algorithms: CaseAlgorithmReference[]): CaseAlgorithmReference[] {
  const unique = new Map<string, CaseAlgorithmReference>();
  for (const algorithm of algorithms) {
    if (!algorithm.moves.length || !algorithm.moves.every((move) => /^[URFDLB](?:2|')?$/.test(move))) continue;
    for (let rotation = 0; rotation < 4; rotation++) {
      for (const auf of AUFS) {
        const moves = compactMoves([...auf, ...rotateAlgorithm(algorithm.moves, rotation)]);
        if (moves.length && !unique.has(moves.join(" "))) unique.set(moves.join(" "), { name: algorithm.name, moves });
      }
    }
  }
  return [...unique.values()].sort((a, b) => a.moves.length - b.moves.length);
}

function findCandidate(start: CubieCube, required: Slot[], algorithms: CaseAlgorithmReference[]): CaseAlgorithmReference | undefined {
  // ponytail: 只比较公式库候选、四个槽位方向与 U 层预调整；不声称全局最短。需要自由搜索时另接有界求解器。
  return algorithms.find((algorithm) => {
    const end = start.applyMoves(algorithm.moves.map(parseMove));
    const solved = solvedSlots(end);
    return isCrossSolved(end, "D") && required.every((slot) => solved.includes(slot));
  });
}

/** 十字后的第一对推荐：复用公式候选，保留所有已完成槽位。输入为 D 底层坐标。 */
export function findFirstPairSolution(start: CubieCube, algorithms: CaseAlgorithmReference[]): { slot: Slot; algorithm: CaseAlgorithmReference } | null {
  if (!isCrossSolved(start, "D")) return null;
  const preserved = solvedSlots(start);
  for (const algorithm of candidateAlgorithms(algorithms)) {
    const end = start.applyMoves(algorithm.moves.map(parseMove));
    const solved = solvedSlots(end);
    const slot = solved.find((item) => !preserved.includes(item));
    if (slot && isCrossSolved(end, "D") && preserved.every((item) => solved.includes(item))) return { slot, algorithm };
  }
  return null;
}

function buildPairReview(
  solve: AnalysisInput, slots: NonNullable<AnalysisInput["f2lSlots"]>, states: CubieCube[],
  targetFace: "U" | "D", algorithms: CaseAlgorithmReference[],
): F2lSolutionReview | null {
  const first = slots[0];
  const end = first.completedAtMove;
  const start = end !== undefined && first.moves !== undefined ? end - first.moves : -1;
  if (end === undefined || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end >= states.length) return null;
  const initial = normalizeCubeForD(states[start], targetFace);
  const actualEnd = normalizeCubeForD(states[end], targetFace);
  const names = slots.map((slot) => slot.slot);
  const normalizedNames = names.map((slot) => formatF2lSlotForWhiteBottom(slot, targetFace));
  if (!isCrossSolved(initial, "D") || !normalizedNames.every((slot) => solvedSlots(actualEnd).includes(slot))) return null;
  const preserved = solvedSlots(initial);
  const required = [...new Set([...preserved, ...solvedSlots(actualEnd)])];
  const candidate = findCandidate(initial, required, algorithms);
  const actual = compactMoves(solve.moves!.slice(start, end));
  return {
    slots: names, targetFace, startMoveIndex: start, endMoveIndex: end,
    actualStepCount: actual.length,
    preservedSlots: preserved.map((slot) => formatF2lSlotForWhiteBottom(slot, targetFace)),
    candidate: candidate ? { name: candidate.name, moves: formatMovesForWhiteBottom(candidate.moves, targetFace) } : undefined,
    note: candidate ? `从同一局面${candidate.moves[0]?.startsWith("U") ? "先调整顶层方向，再" : "直接"}完成${normalizedNames.join(" / ")}槽位；结束时保留十字${preserved.length ? `及 ${preserved.join(" / ")} 槽位` : ""}。`
      : "公式库候选中未找到同时满足槽位与保护条件的解法，保留实录，不推测公式。",
  };
}

/** 从真实槽位起点检验每条候选，不使用公式编号的步数冒充可执行替代解。 */
export function buildF2lSolutions(solve: AnalysisInput, algorithms: CaseAlgorithmReference[]): F2lSolutionReview[] {
  if (!resolvePersistedSolveTrust(solve).analysisEligible || !solve.scramble || !solve.moves?.length) return [];
  const scramble = solve.scramble.trim().split(/\s+/);
  if (![...scramble, ...solve.moves].every((move) => /^[URFDLB](?:2|')?$/.test(move))) return [];
  const targetFace = getSolveTargetFace(solve.scramble, solve.moves);
  if (!targetFace) return [];
  const states = [CubieCube.SOLVED.applyMoves(scramble.map(parseMove))];
  for (const move of solve.moves) states.push(states[states.length - 1].applyMove(parseMove(move)));
  const groups = new Map<number, NonNullable<AnalysisInput["f2lSlots"]>>();
  for (const slot of solve.f2lSlots ?? []) {
    if (slot.completedWithCross || slot.completedAtMove === undefined) continue;
    const group = groups.get(slot.completedAtMove) ?? [];
    group.push(slot);
    groups.set(slot.completedAtMove, group);
  }
  const candidates = candidateAlgorithms(algorithms);
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, group]) => {
    const pair = buildPairReview(solve, group, states, targetFace, candidates);
    return pair ? [pair] : [];
  });
}
