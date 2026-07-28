/**
 * ui/cube-visualizer.ts
 * 用 CSS 3D 显示当前 3x3 状态，接收 move 流实时同步贴纸颜色。
 */

import { CubieCube, parseMove, SOLVED_FACELET } from "../utils/mathlib.ts";
import { isCrossSolved } from "../core/cross-solver.ts";
import { FACE_COLORS } from "../utils/cube-colors.ts";
import { invertQuaternion, multiplyQuaternion, normalizeQuaternion, slerpQuaternion, type Quaternion } from "../utils/quaternion.ts";

const FACE_ORDER = ["U", "R", "F", "D", "L", "B"] as const;

export interface FaceTurnAnimation {
  face: string;
  degrees: number;
  duration: number;
}

/** 与设备协议解耦的单位四元数；首个有效姿态会作为本次持握基准。 */
export interface DeviceQuaternion extends Quaternion {}

export interface CubeVisualizerOptions {
  /** 分析视图中将已归位贴纸淡化，仅突出发生变化的色块。 */
  emphasizeChanges?: boolean;
  /** 初始俯仰角；回放采用黄面朝上，主计时器仍保持原来的白面朝上。 */
  initialRotationX?: number;
  initialRotationY?: number;
}

/** 将标准外层动作转换为视觉动画参数；其它动作仅同步最终状态。 */
export function getFaceTurnAnimation(move: string): FaceTurnAnimation | null {
  const face = move.charAt(0).toUpperCase();
  if (!FACE_ORDER.includes(face as typeof FACE_ORDER[number])) return null;
  const isDouble = move.includes("2");
  return { face, degrees: isDouble ? 180 : move.includes("'") ? -90 : 90, duration: isDouble ? 150 : 105 };
}

interface QueuedTurn {
  animation: FaceTurnAnimation;
  facelets: string;
}

export class CubeVisualizer {
  private root: HTMLElement;
  private state: CubieCube = CubieCube.SOLVED;
  private stickers: HTMLElement[] = [];
  private cube: HTMLElement | null = null;
  private cubies: HTMLElement[] = [];
  private scene: HTMLElement | null = null;
  private turnQueue: QueuedTurn[] = [];
  private isAnimatingTurn = false;
  private activeOverlay: HTMLElement | null = null;
  private animationGeneration = 0;
  private rotationX = -28;
  private rotationY = -38;
  private orientationReference: DeviceQuaternion | null = null;
  private filteredOrientation: DeviceQuaternion | null = null;
  private pendingOrientation: DeviceQuaternion | null = null;
  private gyroFrame: number | null = null;
  private deviceOrientationTransform = "";
  private readonly emphasizeChanges: boolean;

  constructor(root: HTMLElement, options: CubeVisualizerOptions = {}) {
    this.root = root;
    this.emphasizeChanges = options.emphasizeChanges ?? false;
    this.rotationX = options.initialRotationX ?? this.rotationX;
    this.rotationY = options.initialRotationY ?? this.rotationY;
    this.renderShell();
    this.updateFacelets(SOLVED_FACELET);
    this.bindPointerControls();
  }

  reset(): void {
    this.state = CubieCube.SOLVED;
    this.animationGeneration++;
    this.turnQueue = [];
    this.isAnimatingTurn = false;
    this.restoreTurnLayer();
    this.updateFacelets(SOLVED_FACELET);
  }

  applyMove(move: string): void {
    try {
      this.state = this.state.applyMove(parseMove(move));
      const facelets = this.state.toFaceCube();
      const animation = getFaceTurnAnimation(move);
      if (!animation) {
        this.updateFacelets(facelets);
        return;
      }
      if (this.turnQueue.length >= 8) this.turnQueue = [];
      this.turnQueue.push({ animation, facelets });
      this.playNextTurn();
    } catch (err) {
      console.error("[cube-visualizer] 无法同步 move:", err);
    }
  }

  /** 不播放动画地载入动作序列，用于打乱起点和复盘跳转。 */
  loadMoves(moves: string[]): boolean {
    try {
      this.reset();
      this.state = CubieCube.SOLVED.applyMoves(moves.map(parseMove));
      this.updateFacelets(this.state.toFaceCube());
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

  isCrossSolved(targetFace = "U"): boolean {
    return isCrossSolved(this.state, targetFace);
  }

  /**
   * 让视图跟随 GAN v2 的相对持握姿态。
   * 第一帧只建立基准，避免刚连接时视图突然跳到设备的绝对坐标。
   */
  setDeviceOrientation(quaternion: DeviceQuaternion): void {
    const current = normalizeQuaternion(quaternion);
    if (!current) return;
    if (!this.orientationReference) {
      this.orientationReference = current;
      this.filteredOrientation = current;
      return;
    }
    this.pendingOrientation = current;
    if (this.gyroFrame !== null) return;
    this.gyroFrame = window.requestAnimationFrame(() => this.flushDeviceOrientation());
  }

  private flushDeviceOrientation(): void {
    this.gyroFrame = null;
    const current = this.pendingOrientation;
    this.pendingOrientation = null;
    if (!current || !this.orientationReference) return;
    // BLE 通知频率高于屏幕帧率；在渲染帧内插值可同时减少抖动与无效重绘。
    this.filteredOrientation = this.filteredOrientation
      ? slerpQuaternion(this.filteredOrientation, current, 0.32)
      : current;
    const relative = multiplyQuaternion(invertQuaternion(this.orientationReference), this.filteredOrientation);
    const rotation = quaternionToCssRotation(relative);
    if (!rotation) return;
    this.deviceOrientationTransform = rotation;
    this.cube?.classList.add("is-gyro-following");
    this.renderRotation();
  }

  /** 清空设备姿态，使视图回到用户手动选择的观察角度。 */
  resetDeviceOrientation(): void {
    if (this.gyroFrame !== null) window.cancelAnimationFrame(this.gyroFrame);
    this.gyroFrame = null;
    this.orientationReference = null;
    this.filteredOrientation = null;
    this.pendingOrientation = null;
    this.deviceOrientationTransform = "";
    this.cube?.classList.remove("is-gyro-following");
    this.renderRotation();
  }

  private renderShell(): void {
    this.root.innerHTML = "";
    this.root.classList.add("cube-visualizer");

    const scene = document.createElement("div");
    scene.className = "cube-scene";
    this.scene = scene;
    const cube = document.createElement("div");
    cube.className = "cube3d";
    this.cube = cube;
    this.renderRotation();

    for (let y = -1; y <= 1; y++) {
      for (let x = -1; x <= 1; x++) {
        for (let z = -1; z <= 1; z++) this.renderCubie(cube, x, y, z);
      }
    }

    scene.appendChild(cube);
    this.root.appendChild(scene);
  }

  private bindPointerControls(): void {
    let startX = 0;
    let startY = 0;
    let initialX = 0;
    let initialY = 0;
    let dragging = false;

    this.root.addEventListener("pointerdown", (event) => {
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      initialX = this.rotationX;
      initialY = this.rotationY;
      this.root.setPointerCapture(event.pointerId);
      this.root.classList.add("is-dragging");
    });

    this.root.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      this.rotationY = initialY + (event.clientX - startX) * 0.45;
      this.rotationX = Math.max(-82, Math.min(82, initialX - (event.clientY - startY) * 0.45));
      this.renderRotation();
    });

    const stopDragging = (event: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      this.root.classList.remove("is-dragging");
      if (this.root.hasPointerCapture(event.pointerId)) this.root.releasePointerCapture(event.pointerId);
    };
    this.root.addEventListener("pointerup", stopDragging);
    this.root.addEventListener("pointercancel", stopDragging);
  }

  private renderRotation(): void {
    if (!this.cube) return;
    this.cube.style.transform = [
      `rotateX(${this.rotationX}deg)`,
      `rotateY(${this.rotationY}deg)`,
      this.deviceOrientationTransform,
    ].filter(Boolean).join(" ");
  }

  private playNextTurn(): void {
    if (this.isAnimatingTurn) return;
    const turn = this.turnQueue.shift();
    if (!turn || !this.cube || !this.scene) return;
    this.isAnimatingTurn = true;
    const overlay = document.createElement("div");
    overlay.className = "cube-turn-layer";
    const movingCubies = this.cubies.filter((cubie) => isCubieInFaceLayer(cubie, turn.animation.face));
    // 转层容器覆盖整个魔方。这样小方块被临时移入、移出时仍以相同中心定位，
    // 不会在动画首尾因父元素坐标系变化而闪到另一种贴纸排列。
    movingCubies.forEach((cubie) => overlay.appendChild(cubie));
    const duration = this.animationDuration(turn.animation.duration);
    overlay.style.transitionDuration = `${duration}ms`;
    this.activeOverlay = overlay;
    const generation = this.animationGeneration;
    this.cube.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.style.transform = getLayerRotation(turn.animation.face, turn.animation.degrees);
    });
    window.setTimeout(() => {
      if (generation !== this.animationGeneration) return;
      movingCubies.forEach((cubie) => this.cube?.appendChild(cubie));
      overlay.remove();
      if (this.activeOverlay === overlay) this.activeOverlay = null;
      this.updateFacelets(turn.facelets);
      this.isAnimatingTurn = false;
      this.playNextTurn();
    }, duration + 20);
  }

  private animationDuration(defaultDuration: number): number {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : defaultDuration;
  }

  private renderCubie(cube: HTMLElement, x: number, y: number, z: number): void {
    const cubie = document.createElement("div");
    cubie.className = "cube-cubie";
    cubie.dataset.x = String(x);
    cubie.dataset.y = String(y);
    cubie.dataset.z = String(z);
    cubie.style.transform = `translate3d(${x * 50}px, ${y * 50}px, ${z * 50}px)`;
    for (const face of getCubieFaces(x, y, z)) {
      const faceElement = document.createElement("div");
      faceElement.className = `cube-cubie-face cube-cubie-face-${face.toLowerCase()}`;
      const sticker = document.createElement("span");
      sticker.className = "cube-sticker";
      const faceletIndex = getFaceletIndex(face, x, y, z);
      sticker.title = `${face}${faceletIndex % 9}`;
      this.stickers[faceletIndex] = sticker;
      faceElement.appendChild(sticker);
      cubie.appendChild(faceElement);
    }
    this.cubies.push(cubie);
    cube.appendChild(cubie);
  }

  private restoreTurnLayer(): void {
    if (!this.activeOverlay || !this.cube) return;
    this.activeOverlay.querySelectorAll<HTMLElement>(".cube-cubie").forEach((cubie) => this.cube?.appendChild(cubie));
    this.activeOverlay.remove();
    this.activeOverlay = null;
  }

  private updateFacelets(facelets: string): void {
    for (let i = 0; i < this.stickers.length; i++) {
      const colorName = facelets[i] ?? "U";
      const isSolvedSticker = SOLVED_FACELET[i] === colorName;
      const color = this.emphasizeChanges && isSolvedSticker ? "#475569" : (FACE_COLORS[colorName] ?? "#94a3b8");
      this.stickers[i].dataset.color = colorName;
      this.stickers[i].style.setProperty("--sticker-color", color);
    }
  }
}

function quaternionToCssRotation(quaternion: DeviceQuaternion): string | null {
  const normalized = normalizeQuaternion(quaternion);
  if (!normalized) return null;
  const w = Math.max(-1, Math.min(1, normalized.w));
  const angle = 2 * Math.acos(w);
  const sinHalfAngle = Math.sqrt(Math.max(0, 1 - w * w));
  if (sinHalfAngle < 0.0001 || angle < 0.0001) return "";
  const degrees = (angle * 180) / Math.PI;
  return `rotate3d(${normalized.x / sinHalfAngle}, ${normalized.y / sinHalfAngle}, ${normalized.z / sinHalfAngle}, ${degrees}deg)`;
}

function getCubieFaces(x: number, y: number, z: number): string[] {
  const faces: string[] = [];
  if (y === -1) faces.push("U");
  if (x === 1) faces.push("R");
  if (z === 1) faces.push("F");
  if (y === 1) faces.push("D");
  if (x === -1) faces.push("L");
  if (z === -1) faces.push("B");
  return faces;
}

function getFaceletIndex(face: string, x: number, y: number, z: number): number {
  const row = y + 1;
  const col = x + 1;
  if (face === "U") return (z + 1) * 3 + col;
  if (face === "R") return 9 + row * 3 + (1 - z);
  if (face === "F") return 18 + row * 3 + col;
  if (face === "D") return 27 + (1 - z) * 3 + col;
  if (face === "L") return 36 + row * 3 + (z + 1);
  return 45 + row * 3 + (1 - x);
}

function isCubieInFaceLayer(cubie: HTMLElement, face: string): boolean {
  const x = Number(cubie.dataset.x);
  const y = Number(cubie.dataset.y);
  const z = Number(cubie.dataset.z);
  if (face === "U") return y === -1;
  if (face === "D") return y === 1;
  if (face === "R") return x === 1;
  if (face === "L") return x === -1;
  if (face === "F") return z === 1;
  return z === -1;
}

function getLayerRotation(face: string, degrees: number): string {
  if (face === "U") return `rotateY(${degrees}deg)`;
  if (face === "D") return `rotateY(${-degrees}deg)`;
  if (face === "R") return `rotateX(${-degrees}deg)`;
  if (face === "L") return `rotateX(${degrees}deg)`;
  if (face === "F") return `rotateZ(${degrees}deg)`;
  return `rotateZ(${-degrees}deg)`;
}
