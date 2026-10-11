/** CSS 3D 的 27 个小方块、转层动画与观察视角；实体状态由 CubeVisualizer 管理。 */

import { SOLVED_FACELET } from "../utils/mathlib.ts";
import {
  getCubiePosition,
  getFaceletIndex,
  getLayerRotation,
  isCubieInFaceLayer,
  renderCubieFaces,
  setCubiePosition,
} from "./cube-geometry.ts";
import {
  FACE_ORDER,
  getManualPitchAfterDrag,
  getManualViewRotation,
  getManualYawAfterDrag,
  rotateCubiePosition,
  shouldFastForwardTurnAnimation,
  type FaceTurnAnimation,
} from "./cube-view-rotation.ts";
import { COLOR_SCHEMES, type CubeColorScheme } from "./cube-visualizer-types.ts";
import { bindCubeViewControls } from "./cube-view-controls.ts";

interface QueuedTurn {
  animation: FaceTurnAnimation;
  facelets: string;
}

export interface CubeDomRendererOptions {
  emphasizeChanges: boolean;
  onStickerClick: ((faceletIndex: number) => void) | null;
  mutedFaceletIndexes: ReadonlySet<number>;
  colorScheme: CubeColorScheme;
  initialRotationX?: number;
  initialRotationY?: number;
  interactive: boolean;
}

/** 转层先完成几何落位，再下一帧提交局面，防止被浏览器合成为末帧染色。 */
export function deferTurnStateCommit(
  requestFrame: (callback: FrameRequestCallback) => number,
  isCurrent: () => boolean,
  commit: () => void,
): void {
  requestFrame(() => {
    if (isCurrent()) commit();
  });
}

export class CubeDomRenderer {
  private readonly root: HTMLElement;
  private cube: HTMLElement | null = null;
  private cubies: HTMLElement[] = [];
  private scene: HTMLElement | null = null;
  private turnQueue: QueuedTurn[] = [];
  private isAnimatingTurn = false;
  private activeOverlay: HTMLElement | null = null;
  private activeAnimation: Animation | null = null;
  private turnFallbackTimer: number | null = null;
  private animationGeneration = 0;
  private rotationX: number;
  private rotationY: number;
  private readonly initialRotationX: number;
  private readonly initialRotationY: number;
  private zoom = 1;
  private manualRotationFrame: number | null = null;
  private deviceOrientationTransform = "";
  private readonly emphasizeChanges: boolean;
  private readonly onStickerClick: ((faceletIndex: number) => void) | null;
  private readonly mutedFaceletIndexes: ReadonlySet<number>;
  private readonly colorScheme: CubeColorScheme;

  constructor(root: HTMLElement, options: CubeDomRendererOptions) {
    this.root = root;
    this.emphasizeChanges = options.emphasizeChanges;
    this.onStickerClick = options.onStickerClick;
    this.mutedFaceletIndexes = options.mutedFaceletIndexes;
    this.colorScheme = options.colorScheme;
    this.rotationX = options.initialRotationX ?? -30;
    this.rotationY = options.initialRotationY ?? -45;
    this.initialRotationX = this.rotationX;
    this.initialRotationY = this.rotationY;
    this.renderShell();
    this.updateFacelets(SOLVED_FACELET);
    if (options.interactive) {
      bindCubeViewControls(root, {
        reset: () => this.resetView(),
        zoom: (delta) => this.zoomBy(delta),
        rotate: (pitch, yaw) => {
          this.rotationX += pitch;
          this.rotationY += yaw;
          this.renderRotation();
        },
      });
      this.bindPointerControls();
    }
  }

  /** 丢弃进行中的转层与几何偏移，回到「所有小方块处于原位」的 DOM 基态。 */
  reset(): void {
    this.animationGeneration++;
    this.activeAnimation?.cancel();
    this.activeAnimation = null;
    if (this.turnFallbackTimer !== null) window.clearTimeout(this.turnFallbackTimer);
    this.turnFallbackTimer = null;
    this.turnQueue = [];
    this.isAnimatingTurn = false;
    this.restoreTurnLayer();
    this.resetCubieGeometry();
  }

  /** 按动画吞吐决定排队播放或快进；facelets 为动作提交后的最新局面。 */
  applyTurn(animation: FaceTurnAnimation, facelets: string): void {
    // 设备动作快于 CSS 转层时，继续逐帧排队只会让画面滞后，并可能在结束时残留转层容器。
    // 此时直接提交最新状态，下一次动作再恢复轻量动画。
    if (shouldFastForwardTurnAnimation(this.isAnimatingTurn, this.turnQueue.length)) {
      this.reset();
      this.updateFacelets(facelets);
      return;
    }
    this.turnQueue.push({ animation, facelets });
    this.playNextTurn();
  }

  /** 不播放动画地提交转层几何，用于打乱起点和复盘跳转。 */
  commitTurnGeometry(animation: FaceTurnAnimation): void {
    const movingCubies = this.cubies.filter((cubie) => isCubieInFaceLayer(cubie, animation.face));
    for (const cubie of movingCubies) {
      const next = rotateCubiePosition(getCubiePosition(cubie), animation);
      setCubiePosition(cubie, next);
      renderCubieFaces(cubie, next);
    }
  }

  updateFacelets(facelets: string): void {
    for (const cubie of this.cubies) {
      const position = getCubiePosition(cubie);
      cubie.querySelectorAll<HTMLElement>(".cube-sticker").forEach((sticker) => {
        const face = sticker.dataset.face;
        if (!face) return;
        const faceletIndex = getFaceletIndex(face, position.x, position.y, position.z);
        const colorName = facelets[faceletIndex] ?? "?";
        const isSolvedSticker = SOLVED_FACELET[faceletIndex] === colorName;
        const scheme = COLOR_SCHEMES[this.colorScheme];
        const color = colorName === "?"
          ? "#171717"
          : this.mutedFaceletIndexes.has(faceletIndex) || (this.emphasizeChanges && isSolvedSticker)
          ? scheme.muted
          : (scheme.faces[colorName] ?? "#171717");
        sticker.dataset.color = colorName === "?" ? "empty" : colorName;
        sticker.dataset.faceletIndex = String(faceletIndex);
        sticker.style.setProperty("--sticker-color", color);
        // 无贴纸魔方的色塑料应覆盖整个外露 cubie 面；span 仍保留作编辑器命中层。
        if (sticker.parentElement instanceof HTMLElement) sticker.parentElement.style.setProperty("--cubie-color", color);
      });
    }
  }

  /** 陀螺仪跟随产生的 CSS 变换（空串表示清空，回到手动视角）。 */
  setDeviceOrientationTransform(cssTransform: string): void {
    this.deviceOrientationTransform = cssTransform;
    this.renderRotation();
  }

  setGyroFollowing(following: boolean): void {
    this.cube?.classList.toggle("is-gyro-following", following);
    this.root.classList.toggle("is-gyro-following", following);
  }

  private resetView(): void {
    this.rotationX = this.initialRotationX;
    this.rotationY = this.initialRotationY;
    this.zoom = 1;
    this.renderRotation();
  }

  private zoomBy(delta: number): void {
    this.zoom = Math.max(0.7, Math.min(1.6, this.zoom + delta));
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

  /** 内核承接转层露出的空间，避免缝隙呈现空壳。 */
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
    let activePointerId: number | null = null;
    let moved = false;

    this.root.addEventListener("pointerdown", (event) => {
      if (activePointerId !== null) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest("button")) return;
      event.preventDefault();
      this.root.focus({ preventScroll: true });
      activePointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      initialX = this.rotationX;
      initialY = this.rotationY;
      moved = false;
      this.root.setPointerCapture(event.pointerId);
      this.root.classList.add("is-dragging");
    }, { capture: true });

    this.root.addEventListener("pointermove", (event) => {
      if (event.pointerId !== activePointerId) return;
      event.preventDefault();
      if (Math.abs(event.clientX - startX) > 3 || Math.abs(event.clientY - startY) > 3) moved = true;
      this.rotationY = getManualYawAfterDrag(initialY, event.clientX - startX);
      // 拖拽即抓握表面：表面随光标移动——向下拖动看到顶面、向右拖动看到左面；不限制俯仰角以便检查背面和底面。
      this.rotationX = getManualPitchAfterDrag(initialX, event.clientY - startY);
      this.scheduleManualRotationFrame();
    }, { capture: true });

    const stopDragging = (event: PointerEvent): void => {
      if (event.pointerId !== activePointerId) return;
      activePointerId = null;
      const shouldPaint = !moved && event.type === "pointerup";
      this.root.classList.remove("is-dragging");
      if (this.root.hasPointerCapture(event.pointerId)) this.root.releasePointerCapture(event.pointerId);
      if (shouldPaint) this.selectStickerAt(event.clientX, event.clientY);
    };
    this.root.addEventListener("pointerup", stopDragging, { capture: true });
    this.root.addEventListener("pointercancel", stopDragging, { capture: true });
    this.root.addEventListener("lostpointercapture", stopDragging, { capture: true });
  }

  private scheduleManualRotationFrame(): void {
    if (this.manualRotationFrame !== null) return;
    this.manualRotationFrame = window.requestAnimationFrame(() => {
      this.manualRotationFrame = null;
      this.renderRotation();
    });
  }

  /** Pointer Capture 会重定向 click target，编辑器必须按松开坐标命中真实贴纸。 */
  private selectStickerAt(clientX: number, clientY: number): void {
    if (!this.onStickerClick) return;
    const element = document.elementFromPoint(clientX, clientY);
    const target = element instanceof HTMLElement ? element.closest<HTMLElement>(".cube-sticker") : null;
    const faceletIndex = Number(target?.dataset.faceletIndex);
    if (!target || !Number.isInteger(faceletIndex)) return;
    this.onStickerClick(faceletIndex);
  }

  private renderRotation(): void {
    if (!this.cube) return;
    this.cube.style.transform = [
      getManualViewRotation(this.rotationX, this.rotationY),
      this.deviceOrientationTransform,
      `scale(${this.zoom})`,
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
    const targetTransform = getLayerRotation(turn.animation.face, turn.animation.degrees);
    overlay.style.transformOrigin = "50% 50%";
    this.activeOverlay = overlay;
    const generation = this.animationGeneration;
    this.cube.appendChild(overlay);
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      if (generation !== this.animationGeneration) return;
      if (this.turnFallbackTimer !== null) window.clearTimeout(this.turnFallbackTimer);
      this.turnFallbackTimer = null;
      this.activeAnimation = null;
      // 先仅提交九个 cubie 的几何位置并移回主容器，保留它们动画期间的旧面。
      // 若这里同时重建面片、刷新 facelets，Chromium 会把它们合成到动画末帧，
      // 视觉上就像没有实体转层、只发生了一次染色。
      movingCubies.forEach((cubie) => {
        const position = getCubiePosition(cubie);
        const next = rotateCubiePosition(position, turn.animation);
        setCubiePosition(cubie, next);
        this.cube?.appendChild(cubie);
      });
      overlay.remove();
      if (this.activeOverlay === overlay) this.activeOverlay = null;
      deferTurnStateCommit(
        window.requestAnimationFrame.bind(window),
        () => generation === this.animationGeneration,
        () => {
          // 独立绘制帧才重建朝向并同步新局面，使用户看到的是九块完整转过 90°。
          movingCubies.forEach((cubie) => renderCubieFaces(cubie, getCubiePosition(cubie)));
          this.updateFacelets(turn.facelets);
          this.isAnimatingTurn = false;
          this.playNextTurn();
        },
      );
    };
    this.turnFallbackTimer = window.setTimeout(finish, duration + 80);
    // Chrome 的 Web Animations API 明确指定首尾帧，避免初末样式被合并而跳过转动。
    const animation = overlay.animate([
      { transform: "none" },
      { transform: targetTransform },
    ], { duration, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" });
    this.activeAnimation = animation;
    animation.addEventListener("finish", () => {
      finish();
    }, { once: true });
    if (duration === 0) window.queueMicrotask(finish);
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
}
