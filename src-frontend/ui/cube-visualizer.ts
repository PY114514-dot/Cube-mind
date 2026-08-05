/**
 * ui/cube-visualizer.ts
 * 用 CSS 3D 显示当前 3x3 状态，接收 move 流实时同步贴纸颜色。
 */

import { CubieCube, parseMove, SOLVED_FACELET } from "../utils/mathlib.ts";
import { isCrossSolved } from "../core/cross-solver.ts";
import { FACE_COLORS } from "../utils/cube-colors.ts";
import { invertQuaternion, multiplyQuaternion, normalizeQuaternion, type Quaternion } from "../utils/quaternion.ts";

const FACE_ORDER = ["U", "R", "F", "D", "L", "B"] as const;
const MAX_PENDING_TURN_ANIMATIONS = 2;

export interface FaceTurnAnimation {
  face: string;
  degrees: number;
  duration: number;
}

export interface CubiePosition {
  x: number;
  y: number;
  z: number;
}

/** 与设备协议解耦的单位四元数；首个有效姿态会作为本次持握基准。 */
export interface DeviceQuaternion extends Quaternion {}

export interface CubeVisualizerOptions {
  /** 分析视图中将已归位贴纸淡化，仅突出发生变化的色块。 */
  emphasizeChanges?: boolean;
  /** 初始俯仰角；回放采用黄面朝上，主计时器仍保持原来的白面朝上。 */
  initialRotationX?: number;
  initialRotationY?: number;
  /** 编辑器模式下，点击外露贴纸时返回其标准 54 位 facelet 下标。 */
  onStickerClick?: (faceletIndex: number) => void;
}

/** 将标准外层动作转换为视觉动画参数；其它动作仅同步最终状态。 */
export function getFaceTurnAnimation(move: string): FaceTurnAnimation | null {
  const face = move.charAt(0).toUpperCase();
  if (!FACE_ORDER.includes(face as typeof FACE_ORDER[number])) return null;
  const isDouble = move.includes("2");
  return { face, degrees: isDouble ? 180 : move.includes("'") ? -90 : 90, duration: isDouble ? 150 : 105 };
}

/** 连续动作超过动画吞吐时，优先保证局面正确而非播放过期动画。 */
export function shouldFastForwardTurnAnimation(isAnimating: boolean, pendingTurns: number): boolean {
  return isAnimating && pendingTurns >= MAX_PENDING_TURN_ANIMATIONS;
}

interface QueuedTurn {
  animation: FaceTurnAnimation;
  facelets: string;
}

export class CubeVisualizer {
  private root: HTMLElement;
  private state: CubieCube = CubieCube.SOLVED;
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
  private pendingOrientation: DeviceQuaternion | null = null;
  private gyroFrame: number | null = null;
  private deviceOrientationTransform = "";
  private readonly emphasizeChanges: boolean;
  private readonly onStickerClick: ((faceletIndex: number) => void) | null;
  private suppressStickerClick = false;

  constructor(root: HTMLElement, options: CubeVisualizerOptions = {}) {
    this.root = root;
    this.emphasizeChanges = options.emphasizeChanges ?? false;
    this.onStickerClick = options.onStickerClick ?? null;
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
    this.resetCubieGeometry();
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
      // 设备动作快于 CSS 转层时，继续逐帧排队只会让画面滞后，并可能在结束时残留转层容器。
      // 此时直接提交最新状态，下一次动作再恢复轻量动画。
      if (shouldFastForwardTurnAnimation(this.isAnimatingTurn, this.turnQueue.length)) {
        this.fastForwardTurnAnimations();
        this.updateFacelets(facelets);
        return;
      }
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
      for (const move of moves) {
        this.state = this.state.applyMove(parseMove(move));
        const animation = getFaceTurnAnimation(move);
        if (animation) this.commitTurnGeometry(animation);
      }
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

  /** 直接显示 54 位 facelet，不改变内部动作状态，供局面编辑器预览使用。 */
  setFacelets(facelets: string): void {
    if (facelets.length !== 54) throw new Error("[cube-visualizer] facelet 长度必须为 54。");
    this.updateFacelets(facelets);
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
    // BLE 通知频率高于屏幕帧率：每帧只消费最新姿态，既限制重绘又不引入插值追赶的滞后。
    const relative = getDeviceViewRotation(this.orientationReference, current);
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
    this.renderCore(cube);

    for (let y = -1; y <= 1; y++) {
      for (let x = -1; x <= 1; x++) {
        for (let z = -1; z <= 1; z++) this.renderCubie(cube, x, y, z);
      }
    }

    scene.appendChild(cube);
    this.root.appendChild(scene);
  }

  /**
   * 转层之间露出的部分需要有实体内核承接，避免从缝隙看起来像空壳。
   * 内核不参与转层，符合真实魔方的中心轴结构。
   */
  private renderCore(cube: HTMLElement): void {
    const core = document.createElement("div");
    core.className = "cube-inner-core";
    for (const face of FACE_ORDER) {
      const faceElement = document.createElement("div");
      faceElement.className = `cube-inner-core-face cube-inner-core-face-${face.toLowerCase()}`;
      core.appendChild(faceElement);
    }
    cube.appendChild(core);
  }

  private bindPointerControls(): void {
    let startX = 0;
    let startY = 0;
    let initialX = 0;
    let initialY = 0;
    let dragging = false;
    let moved = false;

    this.root.addEventListener("pointerdown", (event) => {
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      initialX = this.rotationX;
      initialY = this.rotationY;
      moved = false;
      this.root.setPointerCapture(event.pointerId);
      this.root.classList.add("is-dragging");
    });

    this.root.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      if (Math.abs(event.clientX - startX) > 3 || Math.abs(event.clientY - startY) > 3) moved = true;
      this.rotationY = initialY + (event.clientX - startX) * 0.45;
      // 不限制俯仰角，用户可以翻到背面和底面检查局面；CSS 的 3D 面会自行处理可见面。
      this.rotationX = initialX - (event.clientY - startY) * 0.45;
      this.renderRotation();
    });

    const stopDragging = (event: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      this.suppressStickerClick = moved;
      this.root.classList.remove("is-dragging");
      if (this.root.hasPointerCapture(event.pointerId)) this.root.releasePointerCapture(event.pointerId);
    };
    this.root.addEventListener("pointerup", stopDragging);
    this.root.addEventListener("pointercancel", stopDragging);
    this.root.addEventListener("click", (event) => {
      if (!this.onStickerClick) return;
      if (this.suppressStickerClick) {
        this.suppressStickerClick = false;
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(".cube-sticker") : null;
      const faceletIndex = Number(target?.dataset.faceletIndex);
      if (!target || !Number.isInteger(faceletIndex)) return;
      this.onStickerClick(faceletIndex);
    });
  }

  private renderRotation(): void {
    if (!this.cube) return;
    this.cube.style.transform = [
      getManualViewRotation(this.rotationX, this.rotationY),
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
    overlay.style.transformOrigin = "50% 50%";
    overlay.style.transitionDuration = `${duration}ms`;
    this.activeOverlay = overlay;
    const generation = this.animationGeneration;
    this.cube.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.style.transform = getLayerRotation(turn.animation.face, turn.animation.degrees);
    });
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      if (generation !== this.animationGeneration) return;
      // 先在转层容器内提交坐标和面方向，再移回主容器。这样不会在
      // transition 结束的那一帧把小方块短暂绘制到旧位置。
      movingCubies.forEach((cubie) => {
        const position = getCubiePosition(cubie);
        const next = rotateCubiePosition(position, turn.animation);
        setCubiePosition(cubie, next);
        renderCubieFaces(cubie, next);
        this.cube?.appendChild(cubie);
      });
      overlay.remove();
      if (this.activeOverlay === overlay) this.activeOverlay = null;
      this.updateFacelets(turn.facelets);
      this.isAnimatingTurn = false;
      this.playNextTurn();
    };
    const fallbackTimer = window.setTimeout(finish, duration + 40);
    overlay.addEventListener("transitionend", (event) => {
      if (event.target !== overlay || event.propertyName !== "transform") return;
      window.clearTimeout(fallbackTimer);
      finish();
    }, { once: true });
    if (duration === 0) window.queueMicrotask(finish);
  }

  /** 丢弃视觉动画而不丢弃状态；适用于高 TPS 连续转动。 */
  private fastForwardTurnAnimations(): void {
    this.animationGeneration++;
    this.turnQueue = [];
    this.isAnimatingTurn = false;
    this.restoreTurnLayer();
    this.resetCubieGeometry();
  }

  private animationDuration(defaultDuration: number): number {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : defaultDuration;
  }

  private renderCubie(cube: HTMLElement, x: number, y: number, z: number): void {
    const cubie = document.createElement("div");
    cubie.className = "cube-cubie";
    cubie.dataset.homeX = String(x);
    cubie.dataset.homeY = String(y);
    cubie.dataset.homeZ = String(z);
    setCubiePosition(cubie, { x, y, z });
    renderCubieFaces(cubie, { x, y, z });
    this.cubies.push(cubie);
    cube.appendChild(cubie);
  }

  private resetCubieGeometry(): void {
    for (const cubie of this.cubies) {
      const position = {
        x: Number(cubie.dataset.homeX ?? "0"),
        y: Number(cubie.dataset.homeY ?? "0"),
        z: Number(cubie.dataset.homeZ ?? "0"),
      };
      setCubiePosition(cubie, position);
      renderCubieFaces(cubie, position);
    }
  }

  private restoreTurnLayer(): void {
    if (!this.activeOverlay || !this.cube) return;
    this.activeOverlay.querySelectorAll<HTMLElement>(".cube-cubie").forEach((cubie) => this.cube?.appendChild(cubie));
    this.activeOverlay.remove();
    this.activeOverlay = null;
  }

  private commitTurnGeometry(animation: FaceTurnAnimation): void {
    const movingCubies = this.cubies.filter((cubie) => isCubieInFaceLayer(cubie, animation.face));
    for (const cubie of movingCubies) {
      const next = rotateCubiePosition(getCubiePosition(cubie), animation);
      setCubiePosition(cubie, next);
      renderCubieFaces(cubie, next);
    }
  }

  private updateFacelets(facelets: string): void {
    for (const cubie of this.cubies) {
      const position = getCubiePosition(cubie);
      cubie.querySelectorAll<HTMLElement>(".cube-sticker").forEach((sticker) => {
        const face = sticker.dataset.face;
        if (!face) return;
        const faceletIndex = getFaceletIndex(face, position.x, position.y, position.z);
        const colorName = facelets[faceletIndex] ?? "?";
        const isSolvedSticker = SOLVED_FACELET[faceletIndex] === colorName;
        const color = colorName === "?" ? "#171717" : this.emphasizeChanges && isSolvedSticker ? "#475569" : (FACE_COLORS[colorName] ?? "#171717");
        sticker.dataset.color = colorName === "?" ? "empty" : colorName;
        sticker.dataset.faceletIndex = String(faceletIndex);
        sticker.style.setProperty("--sticker-color", color);
      });
    }
  }
}

/**
 * 设备上报的是设备相对世界的姿态，CSS 视图需要观察方向的逆变换。
 * 不做时间插值，避免快速转动时画面持续落后于实体魔方。
 */
export function getDeviceViewRotation(reference: DeviceQuaternion, current: DeviceQuaternion): DeviceQuaternion {
  const deviceRelative = multiplyQuaternion(invertQuaternion(reference), current);
  return invertQuaternion(deviceRelative);
}

function getCubiePosition(cubie: HTMLElement): CubiePosition {
  return {
    x: Number(cubie.dataset.x ?? "0"),
    y: Number(cubie.dataset.y ?? "0"),
    z: Number(cubie.dataset.z ?? "0"),
  };
}

function setCubiePosition(cubie: HTMLElement, position: CubiePosition): void {
  cubie.dataset.x = String(position.x);
  cubie.dataset.y = String(position.y);
  cubie.dataset.z = String(position.z);
  cubie.style.transform = `translate3d(${position.x * 50}px, ${position.y * 50}px, ${position.z * 50}px)`;
}

function renderCubieFaces(cubie: HTMLElement, position: CubiePosition): void {
  cubie.replaceChildren();
  const visibleFaces = new Set(getCubieFaces(position.x, position.y, position.z));
  // 参考 cubing.js 的 cubie foundation：每个外露面都有连续的黑色实体底座，
  // 圆角外框与贴纸仅作为上层装饰，不再依赖会干扰转层的全局外壳。
  for (const face of visibleFaces) {
    const foundation = document.createElement("div");
    foundation.className = `cube-cubie-foundation-face cube-cubie-foundation-face-${face.toLowerCase()}`;
    cubie.appendChild(foundation);
  }
  // 每颗小方块保留完整的黑色塑料本体；只有朝外的面才装贴纸。
  // 这样从转层缝隙或相邻块之间看进去时，不会透出同一颗块背面的彩色贴纸。
  for (const face of FACE_ORDER) {
    const faceElement = document.createElement("div");
    faceElement.className = `cube-cubie-face cube-cubie-face-${face.toLowerCase()}`;
    if (!visibleFaces.has(face)) {
      faceElement.classList.add("cube-cubie-face-inner");
      cubie.appendChild(faceElement);
      continue;
    }
    const sticker = document.createElement("span");
    sticker.className = "cube-sticker";
    sticker.dataset.face = face;
    sticker.title = `${face}${getFaceletIndex(face, position.x, position.y, position.z) % 9}`;
    faceElement.appendChild(sticker);
    cubie.appendChild(faceElement);
  }
}

/** 将视觉层的 CSS 旋转提交为新的整数网格坐标。 */
export function rotateCubiePosition(position: CubiePosition, animation: Pick<FaceTurnAnimation, "face" | "degrees">): CubiePosition {
  const face = animation.face.toUpperCase();
  const angle = face === "D" || face === "R" || face === "B" ? -animation.degrees : animation.degrees;
  const quarterTurns = Math.abs(Math.round(angle / 90));
  const positive = angle >= 0;
  let next = { ...position };
  for (let index = 0; index < quarterTurns; index++) next = rotateCssQuarter(next, face, positive);
  return next;
}

function rotateCssQuarter(position: CubiePosition, face: string, positive: boolean): CubiePosition {
  if (face === "U" || face === "D") {
    return positive
      ? { x: position.z, y: position.y, z: -position.x }
      : { x: -position.z, y: position.y, z: position.x };
  }
  if (face === "R" || face === "L") {
    return positive
      ? { x: position.x, y: -position.z, z: position.y }
      : { x: position.x, y: position.z, z: -position.y };
  }
  return positive
    ? { x: -position.y, y: position.x, z: position.z }
    : { x: position.y, y: -position.x, z: position.z };
}

/**
 * CSS 从右向左应用变换：把 rotateY 放在左侧，使其成为不随俯仰翻转的观察轴。
 */
export function getManualViewRotation(rotationX: number, rotationY: number): string {
  return `rotateY(${rotationY}deg) rotateX(${rotationX}deg)`;
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
