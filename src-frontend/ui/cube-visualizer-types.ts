/**
 * ui/cube-visualizer-types.ts
 * CubeVisualizer 的公开类型与配色方案（与渲染实现解耦）。
 *
 * 拆自 cube-visualizer.ts（P1 技术债）：选项、角色、能力矩阵与配色
 * 被外观层 / DOM 渲染层 / 测试三方引用，独立成模块避免循环依赖。
 */

import { FACE_COLORS, FORMULA_CASE_COLORS, FORMULA_NEUTRAL_COLOR } from "../utils/cube-colors.ts";

/** 配色方案：舞台用主视角白顶；公式库预览用练习视角黄顶、白十字朝下。 */
export type CubeColorScheme = "stage" | "formula";

export const COLOR_SCHEMES: Record<CubeColorScheme, { faces: Record<string, string>; muted: string }> = {
  stage: { faces: FACE_COLORS, muted: "#475569" },
  formula: { faces: FORMULA_CASE_COLORS, muted: FORMULA_NEUTRAL_COLOR },
};

export interface CubeVisualizerOptions {
  /** 预设用途：不同 Adapter 只能启用其必要的交互、动画和设备姿态能力。 */
  role?: CubeVisualizerRole;
  /** 分析视图中将已归位贴纸淡化，仅突出发生变化的色块。 */
  emphasizeChanges?: boolean;
  /** 初始俯仰角；回放采用黄面朝上，主计时器仍保持原来的白面朝上。 */
  initialRotationX?: number;
  initialRotationY?: number;
  /** 编辑器模式下，点击外露贴纸时返回其标准 54 位 facelet 下标。 */
  onStickerClick?: (faceletIndex: number) => void;
  /** 公式库等缩略图只展示局面，不绑定拖拽与点击事件。 */
  interactive?: boolean;
  /** 静态讲解图中需要弱化的贴纸下标。 */
  mutedFaceletIndexes?: ReadonlySet<number>;
  /** 配色方案；公式库缩略图用练习视角（黄顶、白十字朝下），默认舞台视角。 */
  colorScheme?: CubeColorScheme;
}

export const CubeVisualizerRole = {
  Stage: "stage",
  Editor: "editor",
  Static: "static",
  Replay: "replay",
} as const;

export type CubeVisualizerRole = typeof CubeVisualizerRole[keyof typeof CubeVisualizerRole];

export interface CubeVisualizerCapabilities {
  interactive: boolean;
  animateTurns: boolean;
  acceptsDeviceOrientation: boolean;
}

/** 三种产品 Adapter（以及回放）各自允许的最小 3D 能力集合。 */
export function getCubeVisualizerCapabilities(role: CubeVisualizerRole = CubeVisualizerRole.Stage): CubeVisualizerCapabilities {
  if (role === CubeVisualizerRole.Static) return { interactive: false, animateTurns: false, acceptsDeviceOrientation: false };
  if (role === CubeVisualizerRole.Editor) return { interactive: true, animateTurns: false, acceptsDeviceOrientation: false };
  if (role === CubeVisualizerRole.Replay) return { interactive: true, animateTurns: true, acceptsDeviceOrientation: false };
  return { interactive: true, animateTurns: true, acceptsDeviceOrientation: true };
}
