/** 公式库静态预览 Adapter：复用真实 3D cubie，但不绑定交互或动作动画。 */

import { CubeVisualizer } from "./cube-visualizer.ts";
import { createCaseFacelets, getF2LNeutralFaceletIndexes, type F2LTargetSlot } from "../formula/cube-case-diagram.ts";

export interface StaticCubePreviewConfig {
  initialRotationX: number;
  initialRotationY: number;
}

/**
 * F2L 与 OLL/PLL 同样从上方观察（rotationX 为负，露出 U 面），仅左右槽位各自靠近观察者。
 * 待插入的棱块几乎总在顶层，白色朝向（朝上/朝侧）正是 case 的核心信号；
 * 底层仰视角会把 U 面整体转到背面——分离对里在顶层的棱块与白贴纸朝上的角块完全不可见。
 */
export function getStaticCubePreviewConfig(category: string | undefined, targetSlot: F2LTargetSlot = "right"): StaticCubePreviewConfig {
  if (category === "F2L") {
    return { initialRotationX: -28, initialRotationY: targetSlot === "right" ? -38 : 38 };
  }
  return { initialRotationX: -28, initialRotationY: -38 };
}

/** 容错读取 DOM 中保存的公式 setup。 */
export function parseStaticCubePreviewMoves(value: string | undefined): string[] {
  return value?.trim().split(/\s+/).filter(Boolean) ?? [];
}

/**
 * 只在卡片进入可视区域后构建 3D DOM，避免一次打开 F2L/OLL/PLL 时创建全部 cubie。
 */
export class StaticCubePreviewAdapter {
  private observer: IntersectionObserver | null = null;
  private mounted = new WeakSet<HTMLElement>();
  private pendingMounts = new Set<HTMLElement>();
  /** 已排定的下一次构建回调；存取消函数以兼容 rAF 与 setTimeout 两种调度。 */
  private mountScheduled: (() => void) | null = null;

  constructor(private readonly root: HTMLElement) {}

  mount(): void {
    this.destroy();
    const scenes = Array.from(this.root.querySelectorAll<HTMLElement>("[data-static-cube-preview]"));
    if (typeof IntersectionObserver === "undefined") {
      scenes.forEach((scene) => this.mountScene(scene));
      return;
    }
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!(entry.target instanceof HTMLElement)) continue;
        if (entry.isIntersecting) this.scheduleMount(entry.target);
        // 滚出预载区只清空构建，不能 unobserve：一旦摘除观察，滚回视口时再收不到交叉事件，场景永远挂不上。
        else this.clearScene(entry.target);
      }
    // 公式内容本身不滚动，真正的滚动容器是外层弹窗；以视口为根才能收到初始和滚动交叉事件。
    }, { root: null, rootMargin: "160px 0px" });
    scenes.forEach((scene) => this.observer?.observe(scene));
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.mountScheduled?.();
    this.mountScheduled = null;
    this.pendingMounts.clear();
    this.root.querySelectorAll<HTMLElement>("[data-static-cube-preview]").forEach((scene) => scene.replaceChildren());
    this.mounted = new WeakSet<HTMLElement>();
  }

  /**
   * 按需立即挂载（OLL/PLL 卡片从 2D 切到 3D 时调用）：
   * 场景不在 IO 预载观察内，直接走构建队列，一次仍只建一颗。
   */
  mountNow(scene: HTMLElement): void {
    this.observer?.observe(scene);
    this.scheduleMount(scene);
  }

  /**
   * 弹窗已打开后同步构建当前可见的场景，消除 IO 回调 + rAF 的几帧延迟。
   * 以最近的滚动容器（弹窗内容区）可见范围为界，只挂真正可见的场景：
   * 既不把折叠区以下的内容全量误挂载，也不与 IO 的预载边距打架（建了又被摘）。
   * 弹窗仍隐藏（display:none）时滚动容器高度为 0，直接跳过。
   */
  mountVisibleNow(): void {
    const viewport = this.getScrollViewport();
    if (!viewport) return;
    const margin = 40;
    this.root.querySelectorAll<HTMLElement>("[data-static-cube-preview]").forEach((scene) => {
      if (this.mounted.has(scene)) return;
      if (scene.getClientRects().length === 0) return;
      const rect = scene.getBoundingClientRect();
      if (rect.bottom > viewport.top - margin && rect.top < viewport.bottom + margin) this.mountScene(scene);
    });
  }

  /** 向上找最近的纵向滚动容器，返回其可视区域；弹窗未开（高度 0）时返回 null。 */
  private getScrollViewport(): { top: number; bottom: number } | null {
    let element: HTMLElement | null = this.root.parentElement;
    while (element) {
      const overflowY = window.getComputedStyle(element).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") {
        const rect = element.getBoundingClientRect();
        if (rect.height > 0) return { top: rect.top, bottom: rect.bottom };
      }
      element = element.parentElement;
    }
    return null;
  }

  /** 场景滚出预载区时清空构建（IO 路径）；保持观察，滚回视口时能重新收到交叉事件并重建。 */
  private clearScene(scene: HTMLElement): void {
    this.pendingMounts.delete(scene);
    if (!this.mounted.delete(scene)) return;
    scene.replaceChildren();
  }

  /** 彻底放弃场景（切回 2D 时调用）：摘除观察并清空；若仍排队未构建则直接从队列移除。 */
  unmountScene(scene: HTMLElement): void {
    this.observer?.unobserve(scene);
    this.pendingMounts.delete(scene);
    if (!this.mounted.delete(scene)) return;
    scene.replaceChildren();
  }

  // 每帧最多构建一个 3D 场景：打开弹窗或滚动时不再同步堆建多颗魔方，避免长帧卡顿。
  // 文档隐藏时 rAF 会被浏览器完全停摆，改用 setTimeout 兜底，保证队列持续推进。
  private scheduleMount(scene: HTMLElement): void {
    this.pendingMounts.add(scene);
    if (this.mountScheduled !== null) return;
    const flush = (): void => {
      this.mountScheduled = null;
      const next = this.pendingMounts.values().next();
      if (next.done) return;
      const candidate = next.value;
      this.pendingMounts.delete(candidate);
      // 排队期间可能已被滚出预载区或随列表重建而断开，构建前再确认一次。
      if (candidate.isConnected && this.isNearViewport(candidate)) this.mountScene(candidate);
      if (this.pendingMounts.size > 0) this.scheduleFlushTick(flush);
    };
    this.scheduleFlushTick(flush);
  }

  private scheduleFlushTick(flush: () => void): void {
    if (document.hidden) {
      const id = window.setTimeout(flush, 120);
      this.mountScheduled = () => window.clearTimeout(id);
    } else {
      const id = requestAnimationFrame(flush);
      this.mountScheduled = () => cancelAnimationFrame(id);
    }
  }

  private isNearViewport(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    const margin = 200;
    return rect.bottom > -margin && rect.top < window.innerHeight + margin;
  }

  private mountScene(scene: HTMLElement): void {
    if (this.mounted.has(scene)) return;
    this.mounted.add(scene);
    try {
      const moves = parseStaticCubePreviewMoves(scene.dataset.staticCubePreview);
      const category = scene.dataset.staticCubeCategory;
      const targetSlot = scene.dataset.staticCubeTargetSlot === "left" ? "left" : "right";
      const config = getStaticCubePreviewConfig(category, targetSlot);
      const faceletColors = createCaseFacelets(moves);
      const mutedFaceletIndexes = category === "F2L" ? getF2LNeutralFaceletIndexes(faceletColors) : undefined;
      const visualizer = new CubeVisualizer(scene, {
        role: "static",
        ...config,
        interactive: false,
        mutedFaceletIndexes,
        // 公式库按练习视角配色：黄顶、白十字朝下，与 2D case 图一致。
        colorScheme: "formula",
      });
      // 贴纸状态直接喂给 3D：loadMoves 走 CubieCube 数学层，只认 URFDLB 六个外层动作，
      // Z-Perm、H-Perm 的 M 切片和带 r/l/f/b 宽转的 OLL 会解析失败而回退成还原态。
      // createCaseFacelets 与 2D 顶视图共用同一套贴纸模拟，天然支持切片/宽转，二者画面一致。
      visualizer.loadFacelets(faceletColors.join(""));
    } catch (error) {
      // 备用解记号超出贴纸模拟支持范围时，宁可留空场景，也不打断排队中的其它场景构建。
      console.error("[static-cube-preview] 无法构建 case 预览:", error);
      this.mounted.delete(scene);
    }
  }
}
