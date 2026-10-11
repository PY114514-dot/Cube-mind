/** 供 Cube Agent 调用的确定性局面输入校验；模型不得自行猜测局面是否合法。 */

const FACE_ORDER = "URFDLB";
const COLOR_TO_FACE: Record<string, string> = { W: "U", R: "R", G: "F", Y: "D", O: "L", B: "B" };
const CORNER_FACELETS = [[8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11], [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51]];
const EDGE_FACELETS = [[5, 10], [7, 19], [3, 37], [1, 46], [32, 16], [28, 25], [30, 43], [34, 52], [23, 12], [21, 41], [50, 39], [48, 14]];
const SOLVED = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";

export interface CubeStateValidation {
  valid: boolean;
  normalizedFacelets: string | null;
  issues: string[];
}

/**
 * 编辑器使用 W/R/G/Y/O/B，求解和 BLE 统一使用 URFDLB。
 * 同时验证颜色、中心朝向和角棱可达性，避免把非法局面交给后续求解。
 */
export function validateCubeEditorFacelets(facelets: string): CubeStateValidation {
  const issues: string[] = [];
  if (facelets.length !== 54 || /[^WRGYOB]/.test(facelets)) {
    return { valid: false, normalizedFacelets: null, issues: ["局面必须恰好包含 54 个白红绿黄橙蓝贴纸。"] };
  }
  for (const color of Object.keys(COLOR_TO_FACE)) {
    const count = [...facelets].filter((value) => value === color).length;
    if (count !== 9) issues.push(`${color} 色应为 9 格，当前为 ${count} 格。`);
  }
  const centers = [4, 13, 22, 31, 40, 49].map((index) => facelets[index]).join("");
  if (centers !== "WRGYOB") issues.push("中心色必须保持白、红、绿、黄、橙、蓝的固定朝向。");
  if (issues.length > 0) return { valid: false, normalizedFacelets: null, issues };
  const normalizedFacelets = [...facelets].map((color) => COLOR_TO_FACE[color] ?? "").join("");
  const legalityIssue = validateCubieLegality(normalizedFacelets);
  if (legalityIssue) return { valid: false, normalizedFacelets: null, issues: [legalityIssue] };
  return { valid: true, normalizedFacelets, issues: [] };
}

/** 通过角棱朝向、排列去重和奇偶性判定用户涂出的局面能否由正常转动达到。 */
function validateCubieLegality(facelets: string): string | null {
  const corners: number[] = [];
  const cornerOrientations: number[] = [];
  for (const positions of CORNER_FACELETS) {
    const colors = positions.map((index) => facelets[index]);
    const orientation = colors.findIndex((color) => color === "U" || color === "D");
    if (orientation < 0) return "存在没有 U/D 色的角块组合，局面不可达。";
    const first = colors[(orientation + 1) % 3];
    const second = colors[(orientation + 2) % 3];
    const piece = CORNER_FACELETS.findIndex((target) => SOLVED[target[0]] === colors[orientation]
      && SOLVED[target[1]] === first && SOLVED[target[2]] === second);
    if (piece < 0) return "存在不存在的角块颜色组合，局面不可达。";
    corners.push(piece);
    cornerOrientations.push(orientation);
  }
  const edges: number[] = [];
  const edgeOrientations: number[] = [];
  for (const positions of EDGE_FACELETS) {
    const colors = positions.map((index) => facelets[index]);
    let piece = EDGE_FACELETS.findIndex((target) => SOLVED[target[0]] === colors[0] && SOLVED[target[1]] === colors[1]);
    let orientation = 0;
    if (piece < 0) {
      piece = EDGE_FACELETS.findIndex((target) => SOLVED[target[0]] === colors[1] && SOLVED[target[1]] === colors[0]);
      orientation = 1;
    }
    if (piece < 0) return "存在不存在的棱块颜色组合，局面不可达。";
    edges.push(piece);
    edgeOrientations.push(orientation);
  }
  if (new Set(corners).size !== 8 || new Set(edges).size !== 12) return "角块或棱块重复，局面不可达。";
  if (cornerOrientations.reduce((sum, value) => sum + value, 0) % 3 !== 0) return "角块朝向和不合法，局面不可达。";
  if (edgeOrientations.reduce((sum, value) => sum + value, 0) % 2 !== 0) return "棱块翻转和不合法，局面不可达。";
  if (permutationParity(corners) !== permutationParity(edges)) return "角棱排列奇偶性不一致，局面不可达。";
  return null;
}

function permutationParity(values: number[]): number {
  let inversions = 0;
  for (let left = 0; left < values.length; left++) {
    for (let right = left + 1; right < values.length; right++) if (values[left] > values[right]) inversions++;
  }
  return inversions % 2;
}
