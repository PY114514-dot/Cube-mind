/** cstimer 默认魔方色表：白黄相对、绿蓝相对、红橙相对。 */
export const CUBE_COLORS = {
  white: "#f5f5f5",
  yellow: "#ffff00",
  green: "#00dd00",
  blue: "#2266d0",
  red: "#e02f2f",
  orange: "#ffaa00",
} as const;

/** 主舞台默认展示白顶、竞速红前、竞速蓝右；仅影响视觉配色，不改变魔方状态编码。 */
export const FACE_COLORS: Record<string, string> = {
  U: CUBE_COLORS.white,
  R: CUBE_COLORS.blue,
  F: CUBE_COLORS.red,
  D: CUBE_COLORS.yellow,
  L: CUBE_COLORS.green,
  B: CUBE_COLORS.orange,
};

/**
 * 公式库练习视角配色：与主舞台同一颗魔方绕 F-B 轴翻转 180°（黄顶、白十字朝下、红前）。
 * F2L 示意图与公式库 3D 预览共用；OLL/PLL 以黄顶展示，F2L 以白十字朝下展示。
 */
export const FORMULA_CASE_COLORS: Record<string, string> = {
  U: CUBE_COLORS.yellow,
  R: CUBE_COLORS.green,
  F: CUBE_COLORS.red,
  D: CUBE_COLORS.white,
  L: CUBE_COLORS.blue,
  B: CUBE_COLORS.orange,
};

/** 公式库中无关贴纸的实体中性灰，OLL/PLL 与 F2L 共用。 */
export const FORMULA_NEUTRAL_COLOR = "#4b5563";

/**
 * SpeedCubeDB 风格的 2D 顶视图贴纸配色（黄 #ffff00 / 绿 #11aa00 / 蓝 #2040d0 /
 * 红 #d00000 / 橙 #ee8800）。只用于公式库 2D case 图，与 3D 预览配色分离互不影响。
 */
export const TOP_VIEW_COLORS: Record<string, string> = {
  U: "#ffff00",
  R: "#11aa00",
  F: "#d00000",
  D: "#ffffff",
  L: "#2040d0",
  B: "#ee8800",
};

/** 2D 顶视图中无关贴纸的中性灰（SpeedCubeDB 同款 #888888）。 */
export const TOP_VIEW_NEUTRAL = "#888888";

/** SpeedCubeDB 与公式库使用的单字符颜色标记。 */
export const STICKER_COLORS: Record<string, string> = {
  ...FACE_COLORS,
  r: CUBE_COLORS.red,
  o: CUBE_COLORS.orange,
  b: CUBE_COLORS.blue,
  g: CUBE_COLORS.green,
  w: CUBE_COLORS.white,
  y: CUBE_COLORS.yellow,
};
