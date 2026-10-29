/**
 * ui/cube-visualizer.ts
 * 用 CSS 3D 显示当前 3x3 状态，接收 move 流实时同步贴纸颜色（外观层）。
 *
 * P1 技术债拆分后：动作状态与陀螺仪决策在此类；DOM 渲染在 cube-dom-renderer.ts；
 * 视角/姿态数学在 cube-view-rotation.ts；贴纸几何在 cube-geometry.ts；
 * 类型与配色在 cube-visualizer-types.ts。re-export 保持既有 import 路径不变。
 */

import { CubieCube, parseMove, SOLVED_FACELET } from "../utils/mathlib.ts";
import { isCrossSolved } from "../core/cross-solver.ts";
import { CubeDomRenderer } from "./cube-dom-renderer.ts";
import {
  DeviceOrientationFollower,
  getFaceTurnAnimation,
  type DeviceQuaternion,
} from "./cube-view-rotation.ts";
import {
  getCubeVisualizerCapabilities,
  type CubeVisualizerCapabilities,
  type CubeVisualizerOptions,
} from "./cube-visualizer-types.ts";

export class CubeVisualizer {
  private state: CubieCube = CubieCube.SOLVED;
  private readonly capabilities: CubeVisualizerCapabilities;
  private readonly renderer: CubeDomRenderer;
  private readonly orientationFollower: DeviceOrientationFollower;

  constructor(root: HTMLElement, options: CubeVisualizerOptions = {}) {
    this.capabilities = getCubeVisualizerCapabilities(options.role);
    this.renderer = new CubeDomRenderer(root, {
      emphasizeChanges: options.emphasizeChanges ?? false,
      onStickerClick: options.onStickerClick ?? null,
      mutedFaceletIndexes: options.mutedFaceletIndexes ?? new Set<number>(),
      colorScheme: options.colorScheme ?? "stage",
      initialRotationX: options.initialRotationX,
      initialRotationY: options.initialRotationY,
      interactive: this.capabilities.interactive && options.interactive !== false,
    });
    this.orientationFollower = new DeviceOrientationFollower({
      onTransformChange: (css) => this.renderer.setDeviceOrientationTransform(css),
      onFollowingChange: (following) => this.renderer.setGyroFollowing(following),
    });
  }

  reset(): void {
    this.state = CubieCube.SOLVED;
    this.renderer.reset();
    this.renderer.updateFacelets(SOLVED_FACELET);
  }

  applyMove(move: string, animationDuration?: number): void {
    try {
      this.state = this.state.applyMove(parseMove(move));
      const facelets = this.state.toFaceCube();
      const animation = getFaceTurnAnimation(move);
      if (!animation || !this.capabilities.animateTurns) {
        // 直接同步局面前必须取消旧动画，避免队列稍后覆盖新状态。
        this.renderer.reset();
        this.renderer.updateFacelets(facelets);
        return;
      }
      this.renderer.applyTurn(animationDuration === undefined ? animation : {
        ...animation, duration: Math.max(0, animationDuration),
      }, facelets);
    } catch (err) {
      console.error("[cube-visualizer] 无法同步 move:", err);
    }
  }

  /** 不播放动画地载入动作序列，用于打乱起点和复盘跳转。 */
  loadMoves(moves: string[]): boolean {
    try {
      this.reset();
      for (const move of moves) {
        this.state = this.state.applyMove(parseMove(move));
        const animation = getFaceTurnAnimation(move);
        if (animation) this.renderer.commitTurnGeometry(animation);
      }
      this.renderer.updateFacelets(this.state.toFaceCube());
      return true;
    } catch (error) {
      console.error("[cube-visualizer] 无法载入动作序列:", error);
      this.reset();
      return false;
    }
  }

  isSolved(): boolean {
    return this.state.toFaceCube() === SOLVED_FACELET;
  }

  getFacelets(): string {
    return this.state.toFaceCube();
  }

  /** 将已校验的实体局面作为后续动作的数学基线，而不仅是覆盖可视贴纸。 */
  loadFacelets(facelets: string): boolean {
    const state = CubieCube.fromFaceCube(facelets);
    if (!state) return false;
    this.state = state;
    this.renderer.reset();
    this.renderer.updateFacelets(facelets);
    return true;
  }

  /** 直接显示 54 位 facelet，不改变内部动作状态，供局面编辑器预览使用。 */
  setFacelets(facelets: string): void {
    if (facelets.length !== 54) throw new Error("[cube-visualizer] facelet 长度必须为 54。");
    this.renderer.updateFacelets(facelets);
  }

  isCrossSolved(targetFace = "U"): boolean {
    return isCrossSolved(this.state, targetFace);
  }

  /**
   * 让视图跟随 GAN v2 的相对持握姿态。
   * 第一帧只建立基准，避免刚连接时视图突然跳到设备的绝对坐标。
   */
  setDeviceOrientation(quaternion: DeviceQuaternion): void {
    if (!this.capabilities.acceptsDeviceOrientation) return;
    this.orientationFollower.accept(quaternion);
  }

  /** 清空设备姿态，使视图回到用户手动选择的观察角度。 */
  resetDeviceOrientation(): void {
    if (!this.capabilities.acceptsDeviceOrientation) return;
    this.orientationFollower.reset();
  }

  /** 以当前实体姿态校准为网页的白上、黄下基准。 */
  calibrateDeviceOrientation(): boolean {
    if (!this.capabilities.acceptsDeviceOrientation) return false;
    return this.orientationFollower.calibrate();
  }
}

// 既有 import 路径不变：main.ts 等用 CubeVisualizer，测试用以下纯函数/常量
export { CubeVisualizerRole, getCubeVisualizerCapabilities } from "./cube-visualizer-types.ts";
export {
  getFaceTurnAnimation,
  getDeviceViewRotation,
  getOrientationSmoothingFactor,
  getManualViewRotation,
  getManualPitchAfterDrag,
  getManualYawAfterDrag,
  rotateCubiePosition,
} from "./cube-view-rotation.ts";
