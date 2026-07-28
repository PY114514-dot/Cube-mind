/** 公式库 case 图的贴纸状态计算，覆盖库中使用的外层、宽转、切片与整体旋转。 */

export type CubeFace = "U" | "R" | "F" | "D" | "L" | "B";
export type FormulaTopViewCategory = "OLL" | "PLL";

interface StickerPosition {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
}

const FACES: CubeFace[] = ["U", "R", "F", "D", "L", "B"];
const SOLVED: CubeFace[] = FACES.flatMap((face) => Array.from({ length: 9 }, () => face));
const STICKERS = FACES.flatMap((face) => createFacePositions(face));
const INDEX_BY_POSITION = new Map(STICKERS.map((sticker, index) => [positionKey(sticker), index]));

/** 返回按 U/R/F/D/L/B 排列的 54 个贴纸颜色。 */
export function createCaseFacelets(setup: string[]): string[] {
  let state: CubeFace[] = [...SOLVED];
  for (const move of setup) state = applyMove(state, move);
  return state;
}

export function invertAlgorithm(moves: string[]): string[] {
  return [...moves].reverse().map((move) => {
    if (move.endsWith("2")) return move;
    if (move.endsWith("'")) return move.slice(0, -1);
    return `${move}'`;
  });
}

export function getFace(facelets: string[], face: CubeFace): string[] {
  const index = FACES.indexOf(face);
  return facelets.slice(index * 9, index * 9 + 9);
}

/**
 * 返回含有指定颜色的整颗角块、棱块或中心块的所有贴纸索引。
 * F2L 示意图据此隐藏黄贴纸所在的整颗小方块，而不是只遮住黄面本身。
 */
export function getCubieFaceletIndexesWithColor(facelets: string[], color: string): Set<number> {
  const hidden = new Set<number>();
  getCubieFaceletGroups().forEach((indexes) => {
    if (!indexes.some((index) => facelets[index] === color)) return;
    indexes.forEach((index) => hidden.add(index));
  });
  return hidden;
}

/** 返回未复原的角块、棱块贴纸，用于 F2L 图只突出当前待配对的两颗小方块。 */
export function getUnsolvedCubieFaceletIndexes(facelets: string[]): Set<number> {
  const centerColors = FACES.map((_, faceIndex) => facelets[faceIndex * 9 + 4]);
  const unsolved = new Set<number>();
  getCubieFaceletGroups().filter((indexes) => indexes.length > 1).forEach((indexes) => {
    if (indexes.some((index) => facelets[index] !== centerColors[Math.floor(index / 9)])) {
      indexes.forEach((index) => unsolved.add(index));
    }
  });
  return unsolved;
}

/**
 * 生成和 TwistyTimer 一致的顶面展开图：中间 3×3 为 U 面，外围四条为相邻侧面的顶行。
 * OLL 仅保留黄色朝向，其他贴纸记为 N；PLL 则保留完整的侧面配色来展示置换。
 */
export function createFormulaTopViewState(facelets: string[], category: FormulaTopViewCategory): (string | null)[] {
  const top = getFace(facelets, "U");
  const normalize = (sticker: string): string => category === "OLL" && sticker !== "U" ? "N" : sticker;
  const back = getFace(facelets, "B").slice(0, 3).reverse().map(normalize);
  const left = getFace(facelets, "L").slice(0, 3).reverse().map(normalize);
  const right = getFace(facelets, "R").slice(0, 3).map(normalize);
  const front = getFace(facelets, "F").slice(0, 3).map(normalize);
  const topFace = top.map(normalize);
  return [
    null, ...back, null,
    left[0], ...topFace.slice(0, 3), right[0],
    left[1], ...topFace.slice(3, 6), right[1],
    left[2], ...topFace.slice(6, 9), right[2],
    null, ...front, null,
  ];
}

function getCubieFaceletGroups(): number[][] {
  const cubies = new Map<string, number[]>();
  STICKERS.forEach((sticker, index) => {
    const key = `${sticker.x},${sticker.y},${sticker.z}`;
    const indexes = cubies.get(key) ?? [];
    indexes.push(index);
    cubies.set(key, indexes);
  });
  return [...cubies.values()];
}

function applyMove(state: CubeFace[], notation: string): CubeFace[] {
  const face = notation[0];
  const turns = notation.endsWith("2") ? 2 : notation.endsWith("'") ? 3 : 1;
  let next = state;
  for (let i = 0; i < turns; i++) next = applyQuarterTurn(next, face);
  return next;
}

function applyQuarterTurn(state: CubeFace[], face: string): CubeFace[] {
  const definition = getTurnDefinition(face);
  const next = [...state];
  for (let index = 0; index < STICKERS.length; index++) {
    const sticker = STICKERS[index];
    if (!definition.matches(sticker)) continue;
    const rotated = rotateSticker(sticker, definition.axis, definition.sign);
    const target = INDEX_BY_POSITION.get(positionKey(rotated));
    if (target === undefined) throw new Error(`无法定位转动后的贴纸: ${face}`);
    next[target] = state[index];
  }
  return next;
}

function getTurnDefinition(face: string): { axis: "x" | "y" | "z"; sign: 1 | -1; matches: (sticker: StickerPosition) => boolean } {
  const definitions = {
    U: { axis: "y", sign: -1, matches: (s: StickerPosition) => s.y === 1 },
    D: { axis: "y", sign: 1, matches: (s: StickerPosition) => s.y === -1 },
    R: { axis: "x", sign: -1, matches: (s: StickerPosition) => s.x === 1 },
    L: { axis: "x", sign: 1, matches: (s: StickerPosition) => s.x === -1 },
    F: { axis: "z", sign: -1, matches: (s: StickerPosition) => s.z === 1 },
    B: { axis: "z", sign: 1, matches: (s: StickerPosition) => s.z === -1 },
    r: { axis: "x", sign: -1, matches: (s: StickerPosition) => s.x >= 0 },
    l: { axis: "x", sign: 1, matches: (s: StickerPosition) => s.x <= 0 },
    f: { axis: "z", sign: -1, matches: (s: StickerPosition) => s.z >= 0 },
    b: { axis: "z", sign: 1, matches: (s: StickerPosition) => s.z <= 0 },
    m: { axis: "x", sign: 1, matches: (s: StickerPosition) => s.x === 0 },
    x: { axis: "x", sign: -1, matches: (_s: StickerPosition) => true },
    y: { axis: "y", sign: -1, matches: (_s: StickerPosition) => true },
    z: { axis: "z", sign: -1, matches: (_s: StickerPosition) => true },
  } as const;

  if (face === "R" || face === "L" || face === "F" || face === "B") return definitions[face];
  if (face === "r" || face === "l" || face === "f" || face === "b") return definitions[face];
  if (face === "M" || face === "m") return definitions.m;
  if (face === "x" || face === "X") return definitions.x;
  if (face === "y" || face === "Y") return definitions.y;
  if (face === "z" || face === "Z") return definitions.z;
  if (face === "U" || face === "D") return definitions[face];
  throw new Error(`不支持的公式记号: ${face}`);
}

function createFacePositions(face: CubeFace): StickerPosition[] {
  return Array.from({ length: 9 }, (_, index) => {
    const row = Math.floor(index / 3);
    const column = index % 3;
    if (face === "U") return { x: column - 1, y: 1, z: row - 1, nx: 0, ny: 1, nz: 0 };
    if (face === "D") return { x: column - 1, y: -1, z: 1 - row, nx: 0, ny: -1, nz: 0 };
    if (face === "F") return { x: column - 1, y: 1 - row, z: 1, nx: 0, ny: 0, nz: 1 };
    if (face === "B") return { x: 1 - column, y: 1 - row, z: -1, nx: 0, ny: 0, nz: -1 };
    if (face === "R") return { x: 1, y: 1 - row, z: 1 - column, nx: 1, ny: 0, nz: 0 };
    return { x: -1, y: 1 - row, z: column - 1, nx: -1, ny: 0, nz: 0 };
  });
}

function rotateSticker(sticker: StickerPosition, axis: "x" | "y" | "z", sign: 1 | -1): StickerPosition {
  const position = rotateVector(sticker.x, sticker.y, sticker.z, axis, sign);
  const normal = rotateVector(sticker.nx, sticker.ny, sticker.nz, axis, sign);
  return { x: position[0], y: position[1], z: position[2], nx: normal[0], ny: normal[1], nz: normal[2] };
}

function rotateVector(x: number, y: number, z: number, axis: "x" | "y" | "z", sign: 1 | -1): [number, number, number] {
  if (axis === "x") return sign === 1 ? [x, -z, y] : [x, z, -y];
  if (axis === "y") return sign === 1 ? [z, y, -x] : [-z, y, x];
  return sign === 1 ? [-y, x, z] : [y, -x, z];
}

function positionKey(sticker: StickerPosition): string {
  return `${sticker.x},${sticker.y},${sticker.z},${sticker.nx},${sticker.ny},${sticker.nz}`;
}
