/**
 * 公式库 UI 控制器
 * 持有筛选/掌握/变体/备用解状态与事件绑定，HTML 构建委托 FormulaLibraryRenderer。
 * 练习会话的实际启动通过 onStartPractice 回调委托给外部。
 */

import { recommendFormulas, getFormulaById } from "../formula/formula-library.ts";
import type { Formula, FormulaCategory } from "../formula/types.ts";
import { getFormulaSetupMoves, isFormulaDevicePracticeSafe } from "../formula/setup-validation.ts";
import { loadCustomF2lAlgorithms, saveCustomF2lAlgorithms, validateCustomF2lAlgorithm } from "../formula/custom-f2l.ts";
import { StaticCubePreviewAdapter } from "../ui/static-cube-preview.ts";
import { FormulaLibraryRenderer } from "./formula-library-render.ts";
import type {
  FormulaLibraryCallbacks, FormulaLibraryElements, LibraryState, PendingPractice,
  SpeedCubeDbAlternativesResponse,
} from "./formula-library-types.ts";

const FORMULA_MASTERED_KEY = "cubemind:formula-mastered";

export class FormulaLibraryController {
  private els: FormulaLibraryElements;
  private cb: FormulaLibraryCallbacks;

  private libraryState: LibraryState = { category: "F2L", search: "", hideMastered: false };
  private masteredFormulaIds = new Set<string>();
  private selectedFormulaVariants = new Map<string, number>();
  private speedCubeDbVariants = new Map<string, string[][]>();
  private customF2lAlgorithms = new Map<string, string[]>();
  private isLoadingSpeedCubeDb = false;
  private hasLoadedSpeedCubeDb = false;
  private pendingPractice: PendingPractice | null = null;
  private staticCubePreviews: StaticCubePreviewAdapter;
  /** 展开备用解列表的公式 ID；展开/收起只原地改卡片，不重建整个列表。 */
  private expandedVariants = new Set<string>();
  /** 已收起的分组 id；收起/展开只切 CSS class，筛选重建后保持。 */
  private collapsedGroups = new Set<string>();
  /** OLL/PLL 卡片的 case 图模式（2D 顶视图 / 3D 实体预览），默认 2D。 */
  private diagramModes = new Map<string, "2d" | "3d">();
  private renderer: FormulaLibraryRenderer;

  constructor(elements: FormulaLibraryElements, callbacks: FormulaLibraryCallbacks) {
    this.els = elements;
    this.cb = callbacks;
    this.staticCubePreviews = new StaticCubePreviewAdapter(elements.libraryContent);
    // renderer 与控制器共享同一批可变状态对象，渲染读取即控制器写入。
    this.renderer = new FormulaLibraryRenderer({
      els: elements,
      cb: callbacks,
      libraryState: this.libraryState,
      masteredFormulaIds: this.masteredFormulaIds,
      selectedFormulaVariants: this.selectedFormulaVariants,
      speedCubeDbVariants: this.speedCubeDbVariants,
      customF2lAlgorithms: this.customF2lAlgorithms,
      expandedVariants: this.expandedVariants,
      collapsedGroups: this.collapsedGroups,
      diagramModes: this.diagramModes,
      staticCubePreviews: this.staticCubePreviews,
      bindControls: () => this.bindLibraryControls(),
      bindActions: () => this.bindFormulaActions(),
      loadSpeedCubeDbVariants: () => { void this.loadSpeedCubeDbVariants(); },
    });
  }

  // ====== 公共 API ======

  init(): void {
    this.loadMasteredFormulas();
    try {
      for (const [id, moves] of loadCustomF2lAlgorithms(localStorage)) this.customF2lAlgorithms.set(id, moves);
    } catch (error) {
      console.error("[自定义 F2L] 读取失败:", error);
      this.cb.log(`自定义 F2L 读取失败：${error instanceof Error ? error.message : String(error)}`, "error");
    }
    this.els.btnOpenLibrary.onclick = () => this.openCategory(this.libraryState.category);
    this.els.btnCloseLibrary.onclick = () => {
      this.staticCubePreviews.destroy();
      this.els.libraryModal.classList.remove("open");
    };
    // 解法切换与展开/收起用事件委托：展开是原地改卡片 DOM，逐次重建后重新绑定会丢失。
    this.els.libraryContent.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const remove = target.closest<HTMLButtonElement>("[data-delete-custom-f2l]");
      if (remove) {
        const form = remove.closest<HTMLFormElement>("[data-custom-f2l-form]");
        if (form) this.updateCustomF2l(form, true);
        return;
      }
      const groupToggle = target.closest<HTMLButtonElement>("[data-toggle-group]");
      if (groupToggle) {
        const section = groupToggle.closest<HTMLElement>(".formula-group");
        if (section) {
          const id = groupToggle.dataset.toggleGroup ?? "";
          const collapsed = section.classList.toggle("collapsed");
          if (collapsed) this.collapsedGroups.add(id);
          else this.collapsedGroups.delete(id);
          groupToggle.setAttribute("aria-expanded", String(!collapsed));
        }
        return;
      }
      const caseMode = target.closest<HTMLButtonElement>("[data-case-mode]");
      if (caseMode) {
        const id = caseMode.dataset.formulaId;
        const mode: "2d" | "3d" = caseMode.dataset.caseMode === "3d" ? "3d" : "2d";
        if (id) this.renderer.switchCaseDiagram(id, mode);
        return;
      }
      const toggle = target.closest<HTMLButtonElement>("[data-toggle-variants]");
      if (toggle) {
        const id = toggle.dataset.toggleVariants;
        if (!id) return;
        if (this.expandedVariants.has(id)) this.expandedVariants.delete(id);
        else this.expandedVariants.add(id);
        const formula = getFormulaById(id);
        const container = toggle.closest<HTMLElement>(".formula-variants");
        if (formula && container) container.innerHTML = this.renderer.renderVariantControls(formula);
        return;
      }
      const select = target.closest<HTMLButtonElement>("[data-select-formula-variant]");
      if (select) {
        const id = select.dataset.selectFormulaVariant;
        const variantIndex = Number(select.dataset.variantIndex ?? "0");
        if (!id || !Number.isFinite(variantIndex)) return;
        this.selectedFormulaVariants.set(id, variantIndex);
        this.renderer.showLibrary(this.libraryState.category);
      }
    });
    this.els.libraryContent.addEventListener("submit", (event) => {
      if (!(event.target instanceof HTMLFormElement) || !event.target.matches("[data-custom-f2l-form]")) return;
      event.preventDefault();
      this.updateCustomF2l(event.target, false);
    });
  }

  openCategory(category: FormulaCategory): void {
    this.renderer.showLibrary(category);
  }

  openForBottleneck(bottleneck: string, stageDuration: number, totalDuration: number): void {
    if (!bottleneck) {
      this.cb.log("瓶颈不明确，打开公式库总览", "info");
      this.renderer.showLibrary("F2L");
      return;
    }
    const rec = recommendFormulas(bottleneck, stageDuration, totalDuration);
    this.staticCubePreviews.destroy();
    this.els.libraryTitle.textContent = `${bottleneck} 公式练习推荐`;
    this.els.libraryContent.innerHTML = this.renderer.renderRecommendation(rec);
    this.bindFormulaActions();
    this.els.libraryModal.classList.add("open");
    // mount 时弹窗仍隐藏，首屏场景无法同步构建；开窗后立刻补挂当前可见场景。
    this.staticCubePreviews.mountVisibleNow();
    this.cb.log(`打开公式库：${bottleneck}`);
  }

  /** AI 指派的具体公式：跳过公式库浏览，直接弹出专项练习确认框（复盘 → 练习 ≤2 次点击）。 */
  openFormulaPractice(formulaId: string): void {
    const formula = getFormulaById(formulaId);
    if (!formula) {
      this.cb.log(`公式库中未找到 ${formulaId}`, "error");
      return;
    }
    const practiceFormula = this.renderer.withSelectedFormulaMoves(formula);
    if (!isFormulaDevicePracticeSafe(practiceFormula)) {
      this.cb.log(`该公式包含 M、宽转、转体，暂不进入智能魔方专项计时：${formula.id}`, "error");
      return;
    }
    this.pendingPractice = { formula: practiceFormula, candidates: [practiceFormula], order: "sequential" };
    this.els.practiceFormulaName.textContent = formula.id;
    this.els.practiceCount.value = "10";
    this.staticCubePreviews.destroy();
    this.els.libraryModal.classList.remove("open");
    this.els.practiceModal.classList.add("open");
    this.cb.log(`准备专项练习：${formula.id}，默认 10 次`);
  }

  resolvePracticeFormula(formula: Formula): Formula {
    return this.renderer.withSelectedFormulaMoves(formula);
  }

  private updateCustomF2l(form: HTMLFormElement, remove: boolean): void {
    const id = form.dataset.customF2lForm ?? "";
    const formula = getFormulaById(id);
    const input = form.querySelector<HTMLTextAreaElement>("textarea");
    const message = form.querySelector<HTMLElement>("[data-custom-message]");
    if (!formula || formula.category !== "F2L" || !input || !message) return;
    try {
      const next = new Map(this.customF2lAlgorithms);
      if (remove) next.delete(id);
      else next.set(id, validateCustomF2lAlgorithm(formula, input.value));
      saveCustomF2lAlgorithms(localStorage, next);
      this.customF2lAlgorithms.clear();
      for (const [caseId, moves] of next) this.customF2lAlgorithms.set(caseId, moves);
      this.selectedFormulaVariants.delete(id);
      this.renderer.showLibrary(this.libraryState.category);
      const editor = this.els.libraryContent.querySelector<HTMLDetailsElement>(`[data-custom-editor="${CSS.escape(id)}"]`);
      if (editor) {
        editor.open = true;
        const status = editor.querySelector<HTMLElement>("[data-custom-message]");
        if (status) status.textContent = remove ? "已删除，恢复主解。" : "已保存并使用。预览和练习已同步。";
        editor.querySelector<HTMLElement>("summary")?.focus();
      }
      this.cb.log(`${id} ${remove ? "已删除我的解法" : "已保存并使用我的解法"}`);
    } catch (error) {
      console.error("[自定义 F2L] 修改失败:", error);
      message.textContent = error instanceof Error ? error.message : "本机保存失败，请保留输入后重试。";
      message.classList.add("error");
      input.setAttribute("aria-invalid", "true");
    }
  }

  getMasteredIds(): Set<string> {
    return new Set(this.masteredFormulaIds);
  }

  isMastered(id: string): boolean {
    return this.masteredFormulaIds.has(id);
  }

  /** 外部练习对话框确认按钮调用 */
  confirmPractice(): void {
    if (!this.pendingPractice) return;
    const target = Math.max(1, Math.min(100, Math.floor(Number(this.els.practiceCount.value) || 1)));
    const { formula, candidates, order } = this.pendingPractice;
    this.pendingPractice = null;
    this.els.practiceModal.classList.remove("open");
    this.cb.onStartPractice(formula, target, candidates.length > 0 ? candidates : [formula], order);
  }

  cancelPractice(): void {
    this.pendingPractice = null;
    this.els.practiceModal.classList.remove("open");
  }

  hasPendingPractice(): boolean {
    return this.pendingPractice !== null;
  }

  // ====== 事件绑定 ======

  private bindLibraryControls(): void {
    this.els.libraryContent.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cat = btn.dataset.cat as FormulaCategory | undefined;
        // 点击当前分类不重建列表，避免无意义的整页 DOM 替换。
        if (cat && cat !== this.libraryState.category) this.renderer.showLibrary(cat);
      });
    });

    const searchInput = this.els.libraryContent.querySelector<HTMLInputElement>("#formula-search");
    if (searchInput) {
      let isComposing = false;
      let searchTimer = 0;
      searchInput.addEventListener("compositionstart", () => { isComposing = true; });
      searchInput.addEventListener("compositionend", (event) => {
        isComposing = false;
        this.libraryState.search = (event.target as HTMLInputElement).value;
        this.renderer.showLibrary(this.libraryState.category);
      });
      searchInput.addEventListener("input", (event) => {
        if (isComposing) return;
        const value = (event.target as HTMLInputElement).value;
        const cursorPos = (event.target as HTMLInputElement).selectionStart;
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
          if (value === this.libraryState.search) return;
          this.libraryState.search = value;
          // 搜索防抖可能晚于进入练习，不能重新打开已经关闭的公式库。
          if (!this.els.libraryModal.classList.contains("open")) return;
          this.renderer.showLibrary(this.libraryState.category);
          // 重建 DOM 后恢复焦点与光标，避免中文输入时跳位
          const restored = this.els.libraryContent.querySelector<HTMLInputElement>("#formula-search");
          if (restored) {
            restored.focus();
            restored.setSelectionRange(cursorPos ?? value.length, cursorPos ?? value.length);
          }
        }, 200);
      });
    }

    this.els.libraryContent.querySelector<HTMLInputElement>("#formula-hide-mastered")?.addEventListener("change", (event) => {
      this.libraryState.hideMastered = (event.target as HTMLInputElement).checked;
      this.renderer.showLibrary(this.libraryState.category);
    });
  }

  private bindFormulaActions(): void {
    this.staticCubePreviews.mount();

    this.els.libraryContent.querySelectorAll<HTMLButtonElement>("[data-copy-setup]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.copySetup;
        const formula = id ? getFormulaById(id) : undefined;
        if (!formula) return;
        try {
          await navigator.clipboard?.writeText(getFormulaSetupMoves(this.renderer.withSelectedFormulaMoves(formula)).join(" "));
          this.cb.log(`已复制打乱：${formula.id}`);
        } catch (err) {
          console.error(err);
          this.cb.log(`复制失败：${err instanceof Error ? err.message : String(err)}`, "error");
        }
      });
    });

    this.els.libraryContent.querySelectorAll<HTMLButtonElement>("[data-copy-formula]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.copyFormula;
        const formula = id ? getFormulaById(id) : undefined;
        if (!formula) return;
        try {
          await navigator.clipboard?.writeText(this.renderer.getSelectedFormulaMoves(formula).join(" "));
          this.cb.log(`已复制公式：${formula.id}`);
        } catch (err) {
          console.error(err);
          this.cb.log(`复制失败：${err instanceof Error ? err.message : String(err)}`, "error");
        }
      });
    });

    this.els.libraryContent.querySelectorAll<HTMLButtonElement>("[data-practice-formula]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.practiceFormula;
        if (id) this.openFormulaPractice(id);
      });
    });
  }

  // ====== 掌握状态持久化 ======

  private toggleFormulaMastered(id: string): void {
    if (this.masteredFormulaIds.has(id)) {
      this.masteredFormulaIds.delete(id);
    } else {
      this.masteredFormulaIds.add(id);
    }
    this.saveMasteredFormulas();
  }

  private saveMasteredFormulas(): void {
    localStorage.setItem(FORMULA_MASTERED_KEY, JSON.stringify([...this.masteredFormulaIds]));
  }

  private loadMasteredFormulas(): void {
    const saved = localStorage.getItem(FORMULA_MASTERED_KEY);
    if (!saved) return;
    try {
      const ids: unknown = JSON.parse(saved);
      if (Array.isArray(ids)) {
        // 原地替换集合内容而非重建：renderer 持有同一 Set 引用，重建会使其脱钩。
        this.masteredFormulaIds.clear();
        for (const id of ids) {
          if (typeof id === "string") this.masteredFormulaIds.add(id);
        }
      }
    } catch (err) {
      console.error(err);
      localStorage.removeItem(FORMULA_MASTERED_KEY);
    }
  }

  // ====== SpeedCubeDB 备用解 ======

  private async loadSpeedCubeDbVariants(): Promise<void> {
    if (this.hasLoadedSpeedCubeDb || this.isLoadingSpeedCubeDb) return;
    this.isLoadingSpeedCubeDb = true;
    try {
      const response = await fetch("/api/formula-alternatives");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload: unknown = await response.json();
      if (!this.isSpeedCubeDbResponse(payload)) throw new Error("响应格式无效");
      for (const [id, alternatives] of Object.entries(payload.alternatives)) {
        if (!Array.isArray(alternatives) || !alternatives.every((moves) => Array.isArray(moves) && moves.every((move) => typeof move === "string"))) continue;
        this.speedCubeDbVariants.set(id, alternatives);
      }
      this.hasLoadedSpeedCubeDb = true;
      if (this.els.libraryModal.classList.contains("open") && !this.els.libraryContent.querySelector(".formula-custom-editor[open]")) this.renderer.showLibrary(this.libraryState.category);
    } catch (error) {
      console.error("[formula-library] SpeedCubeDB 备用解加载失败:", error);
    } finally {
      this.isLoadingSpeedCubeDb = false;
    }
  }

  private isSpeedCubeDbResponse(value: unknown): value is SpeedCubeDbAlternativesResponse {
    if (!value || typeof value !== "object" || !("alternatives" in value)) return false;
    const alternatives = (value as Record<string, unknown>).alternatives;
    return typeof alternatives === "object" && alternatives !== null;
  }
}
