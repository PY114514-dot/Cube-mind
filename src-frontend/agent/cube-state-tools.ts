/** 供 Cube Agent 调用的确定性局面输入校验；模型不得自行猜测局面是否合法。 */

const FACE_ORDER = "URFDLB";
const COLOR_TO_FACE: Record<string, string> = { W: "U", R: "R", G: "F", Y: "D", O: "L", B: "B" };

export interface CubeStateValidation {
  valid: boolean;
  normalizedFacelets: string | null;
  issues: string[];
}

/**
 * 编辑器使用 W/R/G/Y/O/B，求解和 BLE 统一使用 URFDLB。
 * 此处只验证颜色数量和固定中心朝向；完整 cubie 合法性应由后续 two-phase 工具校验。
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
  return { valid: true, normalizedFacelets: [...facelets].map((color) => COLOR_TO_FACE[color] ?? "").join(""), issues: [] };
}
