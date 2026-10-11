/**
 * Cross 求解的打包状态、转移表与距离表。
 *
 * 性能设计（与 cstimer 求解器相同的预计算思路）：
 * 十字只关心 4 条目标棱，把每条棱的 (位置,朝向) 打包成 0-23 的一个数位，
 * 4 条棱组成 24^4 = 331776 的整数状态空间。距离表用 Uint8Array 按下标直取，
 * 移动用 18×24 的转移表查表应用；每个面 BFS 建表一次（几十毫秒），
 * 之后的距离查询、路径回溯都是 O(1) 查表，不再逐节点展开完整魔方。
 */
import { CubieCube, parseMove } from "../utils/mathlib.ts";

const MOVE_COUNT = 18;
export const MOVE_INDICES = Array.from({ length: MOVE_COUNT }, (_, index) => index);
export const MAX_DEPTH = 8;
export const XCROSS_MAX_DEPTH = 8;
const EDGE_MOVE_CUBES = CubieCube.moveCube.map((move) => move.ea);
export const CROSS_POSITIONS: Record<string, number[]> = {
  U: [0, 1, 2, 3],
  R: [0, 4, 8, 11],
  F: [1, 5, 8, 9],
  D: [4, 5, 6, 7],
  L: [2, 6, 9, 10],
  B: [3, 7, 10, 11],
};

export const XCROSS_SLOTS: Record<string, Record<string, [number, number]>> = {
  U: { F: [1, 9], R: [0, 8], B: [3, 11], L: [2, 10] },
  R: { U: [0, 0], F: [4, 8], D: [7, 4], B: [3, 11] },
  F: { U: [1, 1], R: [0, 0], D: [4, 5], L: [5, 9] },
  D: { F: [4, 8], R: [7, 11], B: [6, 10], L: [5, 9] },
  L: { U: [1, 2], F: [5, 9], D: [6, 6], B: [2, 10] },
  B: { U: [3, 3], L: [2, 2], D: [6, 7], R: [7, 11] },
};

// ===== 打包状态与转移表（模块加载时一次性构建） =====

/** 单条棱 (位置,朝向) → 0-23 的逐 move 转移表；角块表同理（值 0-23）。 */
export const EDGE_TRANSITIONS: Uint8Array[] = [];
export const CORNER_TRANSITIONS: Uint8Array[] = [];

for (let move = 0; move < MOVE_COUNT; move++) {
  const edgeMove = EDGE_MOVE_CUBES[move];
  const edgeTable = new Uint8Array(24);
  for (let target = 0; target < 12; target++) {
    const source = edgeMove[target] >> 1;
    const flip = edgeMove[target] & 1;
    edgeTable[source * 2] = target * 2 + flip;
    edgeTable[source * 2 + 1] = target * 2 + (flip ^ 1);
  }
  EDGE_TRANSITIONS.push(edgeTable);

  const cornerMove = CubieCube.moveCube[move].ca;
  const cornerTable = new Uint8Array(24);
  for (let target = 0; target < 8; target++) {
    const source = cornerMove[target] & 7;
    const twist = cornerMove[target] >> 3;
    for (let orientation = 0; orientation < 3; orientation++) {
      cornerTable[source * 3 + orientation] = target * 3 + ((orientation + twist) % 3);
    }
  }
  CORNER_TRANSITIONS.push(cornerTable);
}

export const CROSS_CODE_SIZE = 24 * 24 * 24 * 24;
const UNREACHED = 255;

/** 把 4 条目标棱的状态打包成一个 < 331776 的整数（四位数位，每位 0-23）。 */
function encodeCrossCode(d0: number, d1: number, d2: number, d3: number): number {
  return ((d0 * 24 + d1) * 24 + d2) * 24 + d3;
}

/** 对打包状态应用一次转动：拆出四个数位逐一查转移表后重编码，全程零分配。 */
export function applyEdgeMoveToCode(code: number, move: number): number {
  const table = EDGE_TRANSITIONS[move];
  const digit3 = table[code % 24];
  const rest = (code / 24) | 0;
  const digit2 = table[rest % 24];
  const rest2 = (rest / 24) | 0;
  const digit1 = table[rest2 % 24];
  const digit0 = table[(rest2 / 24) | 0];
  return encodeCrossCode(digit0, digit1, digit2, digit3);
}

export function solvedCrossCode(face: string): number {
  const [p0, p1, p2, p3] = CROSS_POSITIONS[face];
  return encodeCrossCode(p0 * 2, p1 * 2, p2 * 2, p3 * 2);
}

/** 把完整 12 条棱数组投影成目标十字面的打包状态。 */
export function projectEdgeCode(edges: number[], face: string): number {
  const pieceIndex = new Int8Array(12).fill(-1);
  CROSS_POSITIONS[face].forEach((piece, index) => { pieceIndex[piece] = index; });
  const digits = [0, 0, 0, 0];
  for (let position = 0; position < 12; position++) {
    const index = pieceIndex[edges[position] >> 1];
    if (index >= 0) digits[index] = position * 2 + (edges[position] & 1);
  }
  return encodeCrossCode(digits[0], digits[1], digits[2], digits[3]);
}

// ===== 距离表 =====

const crossTables = new Map<string, Uint8Array>();

function buildCrossTable(face: string): Uint8Array {
  const table = new Uint8Array(CROSS_CODE_SIZE).fill(UNREACHED);
  const solved = solvedCrossCode(face);
  table[solved] = 0;
  // 可达状态最多 12P4 × 2^4 = 190080，队列直接复用整表大小的定长数组。
  const queue = new Int32Array(CROSS_CODE_SIZE);
  queue[0] = solved;
  let head = 0;
  let tail = 1;
  while (head < tail) {
    const current = queue[head++];
    const nextDistance = table[current] + 1;
    for (let move = 0; move < MOVE_COUNT; move++) {
      const next = applyEdgeMoveToCode(current, move);
      if (table[next] !== UNREACHED) continue;
      table[next] = nextDistance;
      queue[tail++] = next;
    }
  }
  return table;
}

export function getCrossTable(face: string): Uint8Array {
  let table = crossTables.get(face);
  if (!table) {
    table = buildCrossTable(face);
    crossTables.set(face, table);
  }
  return table;
}

export function getCrossCodeDistance(code: number, face: string): number {
  const distance = getCrossTable(face)[code];
  return distance === UNREACHED ? Number.POSITIVE_INFINITY : distance;
}

export function getCrossDistance(edges: number[], face: string): number {
  return getCrossCodeDistance(projectEdgeCode(edges, face), face);
}

// ===== 单棱 / 单角距离表（X-Cross 启发式用，各 24 个状态） =====

const cornerTables = new Map<number, Uint8Array>();
const edgeTables = new Map<number, Uint8Array>();

function buildSinglePieceTable(transitions: Uint8Array[], solved: number): Uint8Array {
  const table = new Uint8Array(24).fill(UNREACHED);
  table[solved] = 0;
  const queue: number[] = [solved];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const nextDistance = table[current] + 1;
    for (let move = 0; move < MOVE_COUNT; move++) {
      const next = transitions[move][current];
      if (table[next] !== UNREACHED) continue;
      table[next] = nextDistance;
      queue.push(next);
    }
  }
  return table;
}

export function getCornerTable(targetPosition: number): Uint8Array {
  let table = cornerTables.get(targetPosition);
  if (!table) {
    table = buildSinglePieceTable(CORNER_TRANSITIONS, targetPosition * 3);
    cornerTables.set(targetPosition, table);
  }
  return table;
}

export function getEdgeTable(targetPosition: number): Uint8Array {
  let table = edgeTables.get(targetPosition);
  if (!table) {
    table = buildSinglePieceTable(EDGE_TRANSITIONS, targetPosition * 2);
    edgeTables.set(targetPosition, table);
  }
  return table;
}

// ===== 基础判定 =====

export function isCrossSolved(cube: CubieCube, face: string): boolean {
  return isCrossEdgesSolved(cube.ea, face);
}

export function isCrossEdgesSolved(edges: number[], face: string): boolean {
  for (const position of CROSS_POSITIONS[face]) {
    if (edges[position] !== position * 2) return false;
  }
  return true;
}

export function misplacedEdgeArray(edges: number[], face: string): number {
  let count = 0;
  for (const position of CROSS_POSITIONS[face]) {
    if (edges[position] !== position * 2) count++;
  }
  return count;
}

/** 对完整 12 条棱数组应用一次转动（无完整魔方开销）。 */
export function applyFullEdgeMove(edges: number[], move: number): number[] {
  const transform = EDGE_MOVE_CUBES[move];
  return transform.map((value) => edges[value >> 1] ^ (value & 1));
}

export function applyScrambleToEdges(scramble: string): number[] {
  let edges = CubieCube.SOLVED.ea.slice();
  const tokens = scramble.trim() ? scramble.trim().split(/\s+/) : [];
  for (const token of tokens) {
    edges = applyFullEdgeMove(edges, parseMove(token));
  }
  return edges;
}

// ===== 距离查询 =====

export function getCrossDistanceForScramble(scramble: string, targetFace = "D"): number {
  const face = targetFace.toUpperCase();
  if (!CROSS_POSITIONS[face]) throw new Error(`不支持的 Cross 目标面: ${targetFace}`);
  return getCrossDistance(applyScrambleToEdges(scramble), face);
}

/**
 * 面向重复抽样场景的十字距离计分器：内部持有打包状态，applyMove 只做
 * 4 次数位查表，避免每次抽样都重新解析字符串并展开完整魔方。
 */
export interface CrossDistanceScorer {
  reset(): void;
  applyMove(moveIndex: number): void;
  distance(): number;
}

export function createCrossDistanceScorer(targetFace: string): CrossDistanceScorer {
  const face = targetFace.toUpperCase();
  if (!CROSS_POSITIONS[face]) throw new Error(`不支持的 Cross 目标面: ${targetFace}`);
  const table = getCrossTable(face);
  const solved = solvedCrossCode(face);
  let code = solved;
  return {
    reset() { code = solved; },
    applyMove(moveIndex: number) { code = applyEdgeMoveToCode(code, moveIndex); },
    distance() {
      const value = table[code];
      return value === UNREACHED ? Number.POSITIVE_INFINITY : value;
    },
  };
}
