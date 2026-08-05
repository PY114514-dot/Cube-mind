export const CUBE_FACES = ["U", "R", "F", "D", "L", "B"] as const;
export const CUBE_COLORS = ["W", "R", "G", "Y", "O", "B"] as const;

export type CubeFace = typeof CUBE_FACES[number];
export type CubeColor = typeof CUBE_COLORS[number];
export type CubeSticker = CubeColor | null;

export interface CubeEditorState {
  stickers: Record<CubeFace, CubeSticker[]>;
}

const CENTER_COLORS: Record<CubeFace, CubeColor> = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };

/** 创建空白局面；中心块锁定以保证用户有明确的朝向参照。 */
export function createEmptyCubeEditorState(): CubeEditorState {
  const stickers = {} as Record<CubeFace, CubeSticker[]>;
  for (const face of CUBE_FACES) {
    stickers[face] = Array<CubeSticker>(9).fill(null);
    stickers[face][4] = CENTER_COLORS[face];
  }
  return { stickers };
}

export function createSolvedCubeEditorState(): CubeEditorState {
  const state = createEmptyCubeEditorState();
  for (const face of CUBE_FACES) state.stickers[face] = Array<CubeSticker>(9).fill(CENTER_COLORS[face]);
  return state;
}

export function setCubeSticker(state: CubeEditorState, face: CubeFace, index: number, color: CubeSticker): CubeEditorState {
  if (!Number.isInteger(index) || index < 0 || index > 8) throw new Error("[cube-editor] 贴纸位置无效。");
  if (index === 4) return state;
  const stickers = { ...state.stickers, [face]: [...state.stickers[face]] };
  stickers[face][index] = color;
  return { stickers };
}

export function getPaintedStickerCount(state: CubeEditorState): number {
  return CUBE_FACES.reduce((total, face) => total + state.stickers[face].filter((sticker) => sticker !== null).length, 0);
}

/** 用于将局面作为受控工具输入传给后端；空贴纸保留为 ?。 */
export function toFaceletString(state: CubeEditorState): string {
  return CUBE_FACES.flatMap((face) => state.stickers[face]).map((sticker) => sticker ?? "?").join("");
}
