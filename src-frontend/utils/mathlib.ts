/**
 * utils/mathlib.ts
 * 复刻自 cstimer/src/js/lib/mathlib.js
 *
 * 坐标系约定（与 cstimer 一致）：
 *   面顺序 U R F D L B = 0..5
 *   每个轴 3 个 move：0=顺时针 90°, 1=180°, 2=逆时针 90°
 *   moveCube[axis * 3 + power]
 *   facelet 顺序：U0-U8, R0-R8, F0-F8, D0-D8, L0-L8, B0-B8（54 个贴纸）
 *
 * 数据编码（cstimer 风格）：
 *   ca[i] = (ori << 3) | perm，ori ∈ [0,2], perm ∈ [0,7]
 *   ea[i] = (perm << 1) | ori，ori ∈ [0,1], perm ∈ [0,11]
 */

const C_FACELET = [
  [8, 9, 20],   // URF
  [6, 18, 38],  // UFL
  [0, 36, 47],  // ULB
  [2, 45, 11],  // UBR
  [29, 26, 15], // DFR
  [27, 44, 24], // DLF
  [33, 53, 42], // DBL
  [35, 17, 51], // DRB
];

const E_FACELET = [
  [5, 10],   // UR
  [7, 19],   // UF
  [3, 37],   // UL
  [1, 46],   // UB
  [32, 16],  // DR
  [28, 25],  // DF
  [30, 43],  // DL
  [34, 52],  // DB
  [23, 12],  // FR
  [21, 41],  // FL
  [50, 39],  // BL
  [48, 14],  // BR
];

export class CubieCube {
  ca: number[] = [0, 1, 2, 3, 4, 5, 6, 7];
  ea: number[] = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];
  ori: number = 0;

  static SOLVED: CubieCube = new CubieCube();

  /**
   * 角块乘法：prod = a * b
   * 复刻 cstimer mathlib.js:408 CornMult()
   */
  static CornMult(a: CubieCube, b: CubieCube, prod: CubieCube): void {
    const out = new Array(8).fill(0);
    for (let corn = 0; corn < 8; corn++) {
      // 复刻 cstimer mathlib.js:408 CornMult
      // ca[i] = (ori << 3) | perm，ori∈[0,2], perm∈[0,7]
      const ori = ((a.ca[b.ca[corn] & 7] >> 3) + (b.ca[corn] >> 3)) % 3;
      out[corn] = (a.ca[b.ca[corn] & 7] & 7) | (ori << 3);
    }
    prod.ca = out;
  }

  /**
   * 棱块乘法：prod = a * b
   * 复刻 cstimer mathlib.js:402 EdgeMult()
   */
  static EdgeMult(a: CubieCube, b: CubieCube, prod: CubieCube): void {
    const out = new Array(12).fill(0);
    for (let ed = 0; ed < 12; ed++) {
      // cstimer: prod.ea[ed] = a.ea[b.ea[ed] >> 1] ^ (b.ea[ed] & 1)
      // 直接取 a.ea[bIdx]（含 ori），然后 XOR b 的 ori 位
      out[ed] = a.ea[b.ea[ed] >> 1] ^ (b.ea[ed] & 1);
    }
    prod.ea = out;
  }

  static CubeMult(a: CubieCube, b: CubieCube, prod: CubieCube): void {
    CubieCube.CornMult(a, b, prod);
    CubieCube.EdgeMult(a, b, prod);
  }

  from(other: CubieCube): void {
    this.ca = [...other.ca];
    this.ea = [...other.ea];
  }

  /**
   * 18 个基础 move 的变换矩阵
   * 复刻 cstimer mathlib.js:632
   */
  static moveCube: CubieCube[] = (() => {
    const m: CubieCube[] = [];
    for (let i = 0; i < 18; i++) m.push(new CubieCube());

    // ca[i] = (ori << 3) | perm，复刻自 cstimer mathlib.js:637-642
    // U 顺时针：U 层角块不动，ori 全为 0
    m[0].ca = [3, 0, 1, 2, 4, 5, 6, 7];
    // R 顺时针：URF→DRF→DRB→URB，会旋转角块
    m[3].ca = [20, 1, 2, 8, 15, 5, 6, 19];
    // F 顺时针：URF→UFL→DLF→DFR
    m[6].ca = [9, 21, 2, 3, 16, 12, 6, 7];
    // D 顺时针：D 层角块不动
    m[9].ca = [0, 1, 2, 3, 5, 6, 7, 4];
    // L 顺时针：UFL→UBL→DBL→DLF
    m[12].ca = [0, 10, 22, 3, 4, 17, 13, 7];
    // B 顺时针（从背后看）：UBR→UBL→DBL→DRB
    m[15].ca = [0, 1, 11, 23, 4, 5, 18, 14];

    // 棱块：ea[i] = (perm << 1) | ori，ori ∈ [0, 1]
    m[0].ea = [6, 0, 2, 4, 8, 10, 12, 14, 16, 18, 20, 22]; // U 顺时针
    m[3].ea = [16, 2, 4, 6, 22, 10, 12, 14, 8, 18, 20, 0];  // R 顺时针
    m[6].ea = [0, 19, 4, 6, 8, 17, 12, 14, 3, 11, 20, 22]; // F 顺时针
    m[9].ea = [0, 2, 4, 6, 10, 12, 14, 8, 16, 18, 20, 22]; // D 顺时针
    m[12].ea = [0, 2, 20, 6, 8, 10, 18, 14, 16, 4, 12, 22]; // L 顺时针
    m[15].ea = [0, 2, 4, 23, 8, 10, 12, 21, 16, 18, 7, 15]; // B 顺时针

    // power=1 (180°) = 应用两次
    for (let i = 0; i < 6; i++) {
      const cube = new CubieCube();
      CubieCube.CubeMult(m[i * 3], m[i * 3], cube);
      m[i * 3 + 1].ca = cube.ca;
      m[i * 3 + 1].ea = cube.ea;
    }
    // power=2 (逆时针) = 应用三次
    for (let i = 0; i < 6; i++) {
      const cube = new CubieCube();
      CubieCube.CubeMult(m[i * 3 + 1], m[i * 3], cube);
      m[i * 3 + 2].ca = cube.ca;
      m[i * 3 + 2].ea = cube.ea;
    }
    return m;
  })();

  applyMove(moveIdx: number): CubieCube {
    if (!Number.isInteger(moveIdx) || moveIdx < 0 || moveIdx >= CubieCube.moveCube.length) {
      throw new Error(`Invalid move index: ${moveIdx}`);
    }
    const cur = new CubieCube();
    CubieCube.CubeMult(this, CubieCube.moveCube[moveIdx], cur);
    return cur;
  }

  applyMoves(moves: number[]): CubieCube {
    let state: CubieCube = this;
    for (const m of moves) state = state.applyMove(m);
    return state;
  }

  /** 验证状态合法性：朝向和、排列完整性与角棱奇偶性必须一致。 */
  verify(): number {
    if (this.ca.length !== 8 || this.ea.length !== 12) return -3;
    const cornerPermutations = this.ca.map((corner) => corner & 7);
    const edgePermutations = this.ea.map((edge) => edge >> 1);
    if (this.ca.some((corner) => corner < 0 || corner > 23)
      || this.ea.some((edge) => edge < 0 || edge > 23)
      || new Set(cornerPermutations).size !== 8
      || new Set(edgePermutations).size !== 12) return -3;

    const cornerOrientation = this.ca.reduce((sum, corner) => sum + (corner >> 3), 0);
    const edgeOrientation = this.ea.reduce((sum, edge) => sum + (edge & 1), 0);
    if (cornerOrientation % 3 !== 0 || edgeOrientation % 2 !== 0) return -1;
    return permutationParity(cornerPermutations) === permutationParity(edgePermutations) ? 0 : -2;
  }

  /**
   * 转 54 字符 facelet 字符串
   * 复刻 cstimer mathlib.js:527 toFaceCube()
   */
  toFaceCube(): string {
    // 构造 perm 数组：perm[i] = 当前位置 i 应该放哪个 facelet
    const perm = new Array(54);
    for (let i = 0; i < 54; i++) perm[i] = i;

    // 角块：cFacelet[c][(n + ori) % 3] = cFacelet[j][n]
    for (let c = 0; c < 8; c++) {
      const j = this.ca[c] & 0x7;
      const ori = this.ca[c] >> 3;
      for (let n = 0; n < 3; n++) {
        perm[C_FACELET[c][(n + ori) % 3]] = C_FACELET[j][n];
      }
    }
    // 棱块：eFacelet[e][(n + ori) % 2] = eFacelet[j][n]
    for (let e = 0; e < 12; e++) {
      const j = this.ea[e] >> 1;
      const ori = this.ea[e] & 1;
      for (let n = 0; n < 2; n++) {
        perm[E_FACELET[e][(n + ori) % 2]] = E_FACELET[j][n];
      }
    }
    // perm[i] / 9 决定颜色
    const ts = "URFDLB";
    let result = "";
    for (let i = 0; i < 54; i++) {
      result += ts[Math.floor(perm[i] / 9)];
    }
    return result;
  }
}

/** 标准 facelet 顺序（已还原状态） */
export const SOLVED_FACELET = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";

export const FACE_TO_AXIS: Record<string, number> = {
  U: 0, R: 1, F: 2, D: 3, L: 4, B: 5,
};

export function parseMove(move: string): number {
  const normalizedMove = move.trim();
  if (!/^[URFDLB](?:2|')?$/.test(normalizedMove)) throw new Error(`Invalid move: ${move}`);
  const face = normalizedMove[0];
  const axis = FACE_TO_AXIS[face];
  if (axis === undefined) throw new Error(`Invalid move: ${move}`);
  const power = normalizedMove.endsWith("2") ? 1 : normalizedMove.endsWith("'") ? 2 : 0;
  return axis * 3 + power;
}

export function moveToStr(idx: number): string {
  if (!Number.isInteger(idx) || idx < 0 || idx >= 18) throw new Error(`Invalid move index: ${idx}`);
  const axis = Math.floor(idx / 3);
  const power = idx % 3;
  const face = "URFDLB".charAt(axis);
  const suffix = power === 1 ? "2" : power === 2 ? "'" : "";
  return face + suffix;
}

function permutationParity(permutation: number[]): number {
  let inversions = 0;
  for (let i = 0; i < permutation.length; i++) {
    for (let j = i + 1; j < permutation.length; j++) {
      if (permutation[i] > permutation[j]) inversions++;
    }
  }
  return inversions % 2;
}

/** 返回同一面的逆转动索引；180 度转动的逆仍为自身。 */
export function invertMoveIndex(idx: number): number {
  const axis = Math.floor(idx / 3);
  const power = idx % 3;
  if (axis < 0 || axis >= 6 || power < 0 || power > 2) {
    throw new Error(`Invalid move index: ${idx}`);
  }
  const inversePower = power === 0 ? 2 : power === 2 ? 0 : 1;
  return axis * 3 + inversePower;
}

export function valuedArray<T>(length: number, val: T | ((i: number) => T)): T[] {
  const arr: T[] = new Array(length);
  if (typeof val === "function") {
    for (let i = 0; i < length; i++) arr[i] = (val as (i: number) => T)(i);
  } else {
    for (let i = 0; i < length; i++) arr[i] = val;
  }
  return arr;
}

export function parseMoves(moves: string[]): number[] {
  return moves.map(parseMove);
}

export function movesToStrs(moves: number[]): string[] {
  return moves.map(moveToStr);
}
