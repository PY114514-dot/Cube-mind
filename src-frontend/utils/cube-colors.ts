/** cstimer 默认魔方色表：白黄相对、绿蓝相对、红橙相对。 */
export const CUBE_COLORS = {
  white: "#ffffff",
  yellow: "#ffff00",
  green: "#00dd00",
  blue: "#0000ff",
  red: "#ff0000",
  orange: "#ffaa00",
} as const;

/** 白顶、绿前、红右的标准面向。 */
export const FACE_COLORS: Record<string, string> = {
  U: CUBE_COLORS.white,
  R: CUBE_COLORS.red,
  F: CUBE_COLORS.green,
  D: CUBE_COLORS.yellow,
  L: CUBE_COLORS.orange,
  B: CUBE_COLORS.blue,
};

/**
 * F2L Case 图以白十字朝下、红面朝前、蓝面朝左的练习视角绘制。
 * 它与主视图的面向不同，但使用同一组六色。
 */
export const F2L_CASE_COLORS: Record<string, string> = {
  U: CUBE_COLORS.yellow,
  R: CUBE_COLORS.green,
  F: CUBE_COLORS.red,
  D: CUBE_COLORS.white,
  L: CUBE_COLORS.blue,
  B: CUBE_COLORS.orange,
};

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
