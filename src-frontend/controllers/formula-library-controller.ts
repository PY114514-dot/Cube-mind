/**
 * 公式库 UI 控制器
 * 封装公式库弹窗的渲染、筛选、变体选择、掌握状态与练习入口逻辑。
 * 练习会话的实际启动通过 onStartPractice 回调委托给外部。
 */

import { recommendFormulas, listByCategory, getLibraryStats, getFormulaById } from "../formula/formula-library.ts";
import type { Formula, FormulaCategory, FormulaVariant } from "../formula/types.ts";
import { createCaseFacelets, createFormulaTopViewState, getF2LFocusFaceletIndexes, getF2LNeutralFaceletIndexes, getFace, type F2LTargetSlot } from "../formula/cube-case-diagram.ts";
import { getFormulaSetupMoves, isFormulaDevicePracticeSafe } from "../formula/setup-validation.ts";
import { getFormulaMastery, selectPracticeFormula, type PracticeRecord } from "../core/practice-stats.ts";
import { F2L_CASE_COLORS, FORMULA_NEUTRAL_COLOR } from "../utils/cube-colors.ts";
import { CubeVisualizer } from "../ui/cube-visualizer.ts";

export interface FormulaLibraryElements {
  libraryModal: HTMLDivElement;
  libraryContent: HTMLDivElement;
  libraryTitle: HTMLHeadingElement;
  btnCloseLibrary: HTMLButtonElement;
  btnOpenLibrary: HTMLButtonElement;
  practiceModal: HTMLDivElement;
  practiceFormulaName: HTMLElement;
  practiceCount: HTMLInputElement;
}

export interface FormulaLibraryCallbacks {
  log: (msg: string, level?: "info" | "move" | "error") => void;
  onStartPractice: (formula: Formula, target: number, candidates: Formula[], order: "random" | "sequential") => void;
  getPracticeRecords: () => PracticeRecord[];
}

interface LibraryState {
  category: FormulaCategory;
  search: string;
  difficulty: number | null;
  tag: string;
  hideMastered: boolean;
}

interface SpeedCubeDbAlternativesResponse {
  alternatives: Record<string, string[][]>;
  source: "SpeedCubeDB";
}

interface PendingPractice {
  formula: Formula;
  candidates: Formula[];
  order: "random" | "sequential";
}

const FORMULA_MASTERED_KEY = "cubemind:formula-mastered";

export class FormulaLibraryController {
  private els: FormulaLibraryElements;
  private cb: FormulaLibraryCallbacks;

  private libraryState: LibraryState = { category: "F2L", search: "", difficulty: null, tag: "", hideMastered: false };
  private masteredFormulaIds = new Set<string>();
  private selectedFormulaVariants = new Map<string, number>();
  private speedCubeDbVariants = new Map<string, string[][]>();
  private isLoadingSpeedCubeDb = false;
  private hasLoadedSpeedCubeDb = false;
  private pendingPractice: PendingPractice | null = null;

  constructor(elements: FormulaLibraryElements, callbacks: FormulaLibraryCallbacks) {
    this.els = elements;
    this.cb = callbacks;
  }

  // ====== 公共 API ======

  init(): void {
    this.loadMasteredFormulas();
    this.els.btnOpenLibrary.onclick = () => this.openCategory(this.libraryState.category);
    this.els.btnCloseLibrary.onclick = () => this.els.libraryModal.classList.remove("open");
  }

  openCategory(category: FormulaCategory): void {
    this.showLibrary(category);
  }

  openForBottleneck(bottleneck: string, stageDuration: number, totalDuration: number): void {
    if (!bottleneck) {
      this.cb.log("瓶颈不明确，打开公式库总览", "info");
      this.showLibrary("F2L");
      return;
    }
    const rec = recommendFormulas(bottleneck, stageDuration, totalDuration);
    this.els.libraryTitle.textContent = `${bottleneck} 公式练习推荐`;
    this.els.libraryContent.innerHTML = this.renderRecommendation(rec);
    this.bindFormulaActions();
    this.els.libraryModal.classList.add("open");
    this.cb.log(`打开公式库：${bottleneck}`);
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

  // ====== 渲染 ======

  private showLibrary(category: FormulaCategory): void {
    this.libraryState.category = category;
    void this.loadSpeedCubeDbVariants();
    const stats = getLibraryStats();
    const formulas = this.getVisibleFormulas(category);
    const allInCategory = listByCategory(category);
    const tags = this.getCategoryTags(category);
    const masteredInCategory = allInCategory.filter((f) => this.masteredFormulaIds.has(f.id)).length;

    this.els.libraryTitle.textContent = `Formula Library (${stats.total})`;
    this.els.libraryContent.innerHTML = `
      ${this.renderTodayTrainingQueue()}
      <div class="library-tabs">
        <button class="tab-btn ${category === "F2L" ? "active" : ""}" data-cat="F2L">F2L (${stats.F2L})</button>
        <button class="tab-btn ${category === "OLL" ? "active" : ""}" data-cat="OLL">OLL (${stats.OLL})</button>
        <button class="tab-btn ${category === "PLL" ? "active" : ""}" data-cat="PLL">PLL (${stats.PLL})</button>
      </div>
      <div class="library-toolbar">
        <input id="formula-search" type="search" placeholder="搜索 ID、名称、公式、识别点" value="${this.escapeHtml(this.libraryState.search)}">
        <select id="formula-difficulty">
          <option value="0" ${this.libraryState.difficulty === null ? "selected" : ""}>全部星级</option>
          ${[1, 2, 3, 4, 5].map((level) => `
            <option value="${level}" ${this.libraryState.difficulty === level ? "selected" : ""}>${"★".repeat(level)}${"☆".repeat(5 - level)}</option>
          `).join("")}
        </select>
        <select id="formula-tag">
          <option value="" ${this.libraryState.tag === "" ? "selected" : ""}>全部标签</option>
          ${tags.map((tag) => `
            <option value="${this.escapeHtml(tag)}" ${this.libraryState.tag === tag ? "selected" : ""}>${this.escapeHtml(tag)}</option>
          `).join("")}
        </select>
        <label class="library-toggle">
          <input id="formula-hide-mastered" type="checkbox" ${this.libraryState.hideMastered ? "checked" : ""}>
          隐藏已掌握
        </label>
      </div>
      <div class="library-meta">
        <span>显示 ${formulas.length} / ${allInCategory.length}</span>
        <span>已掌握 ${masteredInCategory}</span>
        <span>当前 ${category}</span>
      </div>
      <div class="formula-list">
        ${formulas.map((f) => this.renderFormulaCard(f)).join("")}
      </div>
      ${formulas.length === 0 ? '<p class="placeholder">没有符合条件的公式，换个筛选条件试试。</p>' : ""}
    `;
    this.els.libraryModal.classList.add("open");
    this.bindLibraryControls();
    this.bindFormulaActions();
  }

  private renderRecommendation(rec: { reason: string; formulas: Formula[]; practicePlan: string }): string {
    return `
      <div class="recommendation">
        <div class="rec-reason"><strong>推荐理由：</strong>${this.escapeHtml(rec.reason)}</div>
        <div class="rec-plan"><strong>练习计划：</strong>${this.escapeHtml(rec.practicePlan)}</div>
      </div>
      <div class="formula-list">
        ${rec.formulas.map((f) => this.renderFormulaCard(f)).join("")}
      </div>
      ${rec.formulas.length === 0 ? '<p class="placeholder">无对应公式库，参考练习计划</p>' : ""}
    `;
  }

  private renderTodayTrainingQueue(): string {
    const records = this.cb.getPracticeRecords();
    const queue = (["F2L", "OLL", "PLL"] as FormulaCategory[]).flatMap((category) => {
      const candidates = listByCategory(category).filter((f) => isFormulaDevicePracticeSafe(f));
      const formula = selectPracticeFormula(candidates, records);
      return formula ? [formula] : [];
    });
    if (queue.length === 0) return "";
    return `
      <section class="today-training-queue" aria-label="今日训练队列">
        <div><span class="eyebrow">Today's Queue</span><strong class="queue-title"><span>今天练这</span><span class="queue-count">3</span><span>条</span></strong><p>优先安排未练习或成功率较低的公式。</p></div>
        <div class="queue-items">${queue.map((formula) => `
          <button class="queue-item" data-practice-formula="${this.escapeHtml(formula.id)}">
            <span>${formula.category}</span><strong>${this.escapeHtml(formula.id)}</strong><em>${this.escapeHtml(this.getFormulaDisplayName(formula))}</em>
          </button>
        `).join("")}</div>
      </section>
    `;
  }

  private renderFormulaCard(f: Formula): string {
    const mastered = this.masteredFormulaIds.has(f.id);
    const mastery = getFormulaMastery(this.cb.getPracticeRecords(), f.id);
    const moves = this.getSelectedFormulaMoves(f);
    const algorithm = moves.join(" ");
    const setupMoves = getFormulaSetupMoves({ ...f, moves });
    const setup = setupMoves.join(" ");

    return `
      <div class="formula-card ${mastered ? "mastered" : ""}">
        <div class="formula-header">
          <span class="formula-id">${this.escapeHtml(f.id)}</span>
          <span class="formula-name">${this.escapeHtml(this.getFormulaDisplayName(f))}</span>
          <span class="formula-difficulty">${"★".repeat(f.difficulty)}</span>
        </div>
        ${this.renderFormulaCaseDiagram(f, setupMoves)}
        <div class="formula-algorithm">
          <div class="algorithm-label">打乱 / Setup <span>从复原状态执行</span></div>
          <code class="algorithm-moves">${this.escapeHtml(setup)}</code>
        </div>
        <div class="formula-algorithm primary">
          <div class="algorithm-label">解法 / Alg <span>${f.moves.length} 步</span></div>
          <code class="algorithm-moves">${this.escapeHtml(algorithm)}</code>
        </div>
        ${f.source ? `<div class="formula-source">来源：${this.escapeHtml(f.source)}</div>` : ""}
        ${this.renderFormulaVariants(f)}
        <div class="formula-actions">
          <button class="ghost" data-copy-setup="${this.escapeHtml(f.id)}">复制打乱</button>
          <button class="ghost" data-copy-formula="${this.escapeHtml(f.id)}">复制公式</button>
          <button class="practice-btn" data-practice-formula="${this.escapeHtml(f.id)}">开始练习</button>
        </div>
        <div class="formula-mastery">练习 ${mastery.attempts} 次 · 成功率 ${(mastery.successRate * 100).toFixed(0)}% · 平均 ${this.formatPracticeTime(mastery.averageDuration)}${mastery.averageRecognitionDuration !== null ? ` · 识别 ${this.formatPracticeTime(mastery.averageRecognitionDuration)} / 执行 ${this.formatPracticeTime(mastery.averageExecutionDuration)}` : ""}</div>
      </div>
    `;
  }

  private renderFormulaVariants(formula: Formula): string {
    const variants = this.getFormulaVariants(formula);
    const selectedIndex = this.selectedFormulaVariants.get(formula.id) ?? 0;
    return `
      <div class="formula-variants" aria-label="${this.escapeHtml(formula.id)} 可选解法">
        ${variants.map((variant, index) => `
          <button
            class="formula-variant ${index === selectedIndex ? "active" : ""}"
            data-select-formula-variant="${this.escapeHtml(formula.id)}"
            data-variant-index="${index}"
            type="button"
          >
            <span class="variant-name">${this.escapeHtml(variant.name)}</span>
            <code>${this.escapeHtml(variant.moves.join(" "))}</code>
            <span class="variant-meta">${variant.moves.length} 步${variant.note ? ` · ${this.escapeHtml(variant.note)}` : ""}</span>
          </button>
        `).join("")}
      </div>
    `;
  }

  private renderFormulaCaseDiagram(formula: Formula, setup: string[]): string {
    const facelets = createCaseFacelets(setup);
    if (formula.category !== "F2L") {
      return `
        <div class="formula-case-diagram formula-case-diagram-top" aria-label="${this.escapeHtml(formula.id)} top preview">
          <div class="formula-cube-scene" data-formula-cube-moves="${this.escapeHtml(setup.join(" "))}"></div>
        </div>
      `;
    }
    const targetSlot: F2LTargetSlot = formula.tags.includes("left-slot") ? "left" : "right";
    const focusCubieFacelets = getF2LFocusFaceletIndexes(facelets, targetSlot);
    const neutralFacelets = getF2LNeutralFaceletIndexes(facelets, focusCubieFacelets);
    return `
      <div class="formula-case-diagram formula-case-diagram-f2l" aria-label="${this.escapeHtml(formula.id)} case preview">
        <div class="formula-cube-scene" data-formula-cube-moves="${this.escapeHtml(setup.join(" "))}">
          <div class="formula-cube3d">
            ${this.renderFormulaCubeFace("u", getFace(facelets, "U"), neutralFacelets, focusCubieFacelets, 0)}
            ${this.renderFormulaCubeFace("r", getFace(facelets, "R"), neutralFacelets, focusCubieFacelets, 1)}
            ${this.renderFormulaCubeFace("f", getFace(facelets, "F"), neutralFacelets, focusCubieFacelets, 2)}
            ${this.renderFormulaCubeFace("d", getFace(facelets, "D"), neutralFacelets, focusCubieFacelets, 3)}
            ${this.renderFormulaCubeFace("l", getFace(facelets, "L"), neutralFacelets, focusCubieFacelets, 4)}
            ${this.renderFormulaCubeFace("b", getFace(facelets, "B"), neutralFacelets, focusCubieFacelets, 5)}
          </div>
        </div>
        <div class="formula-case-meta">
          <strong>Case 图</strong>
          <span>白底 / 红前 / 蓝左；黄色层隐藏，待配对角块与棱块高亮</span>
        </div>
      </div>
    `;
  }

  private renderFormulaTopView(facelets: string[], category: "OLL" | "PLL"): string {
    const state = createFormulaTopViewState(facelets, category);
    return `
      <div class="formula-top-view formula-top-view-${category.toLowerCase()}" aria-label="${category} 顶面状态">
        ${state.map((sticker) => this.renderFormulaTopSticker(sticker)).join("")}
      </div>
    `;
  }

  private renderFormulaTopSticker(sticker: string | null): string {
    if (sticker === null) return '<span class="formula-top-empty" aria-hidden="true"></span>';
    const color = sticker === "N" ? FORMULA_NEUTRAL_COLOR : F2L_CASE_COLORS[sticker] ?? "#e5e7eb";
    return `<span style="background:${color}"></span>`;
  }

  private renderFormulaCubeFace(face: string, stickers: string[], neutralFacelets: Set<number>, focusFacelets: Set<number>, faceIndex: number): string {
    return `
      <div class="formula-cube-face formula-cube-face-${face}">
        ${stickers.map((sticker, index) => {
          const faceletIndex = faceIndex * 9 + index;
          const classes = [
            neutralFacelets.has(faceletIndex) ? "formula-sticker-neutral" : "",
            focusFacelets.has(faceletIndex) ? "formula-sticker-focus" : "",
          ].filter(Boolean).join(" ");
          return `<span class="${classes}" style="--formula-sticker:${F2L_CASE_COLORS[sticker] ?? "#94a3b8"}"></span>`;
        }).join("")}
      </div>
    `;
  }

  // ====== 事件绑定 ======

  private bindLibraryControls(): void {
    this.els.libraryContent.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cat = btn.dataset.cat as FormulaCategory | undefined;
        if (cat) this.showLibrary(cat);
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
        this.showLibrary(this.libraryState.category);
      });
      searchInput.addEventListener("input", (event) => {
        if (isComposing) return;
        const value = (event.target as HTMLInputElement).value;
        const cursorPos = (event.target as HTMLInputElement).selectionStart;
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
          this.libraryState.search = value;
          this.showLibrary(this.libraryState.category);
          // 重建 DOM 后恢复焦点与光标，避免中文输入时跳位
          const restored = this.els.libraryContent.querySelector<HTMLInputElement>("#formula-search");
          if (restored) {
            restored.focus();
            restored.setSelectionRange(cursorPos ?? value.length, cursorPos ?? value.length);
          }
        }, 200);
      });
    }

    this.els.libraryContent.querySelector<HTMLSelectElement>("#formula-difficulty")?.addEventListener("change", (event) => {
      const difficulty = Number((event.target as HTMLSelectElement).value);
      this.libraryState.difficulty = difficulty === 0 ? null : difficulty;
      this.showLibrary(this.libraryState.category);
    });

    this.els.libraryContent.querySelector<HTMLSelectElement>("#formula-tag")?.addEventListener("change", (event) => {
      this.libraryState.tag = (event.target as HTMLSelectElement).value;
      this.showLibrary(this.libraryState.category);
    });

    this.els.libraryContent.querySelector<HTMLInputElement>("#formula-hide-mastered")?.addEventListener("change", (event) => {
      this.libraryState.hideMastered = (event.target as HTMLInputElement).checked;
      this.showLibrary(this.libraryState.category);
    });
  }

  private bindFormulaActions(): void {
    this.bindFormulaCubeControls();

    this.els.libraryContent.querySelectorAll<HTMLButtonElement>("[data-select-formula-variant]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.selectFormulaVariant;
        const variantIndex = Number(btn.dataset.variantIndex ?? "0");
        if (!id || !Number.isFinite(variantIndex)) return;
        this.selectedFormulaVariants.set(id, variantIndex);
        this.showLibrary(this.libraryState.category);
      });
    });

    this.els.libraryContent.querySelectorAll<HTMLButtonElement>("[data-copy-setup]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.copySetup;
        const formula = id ? getFormulaById(id) : undefined;
        if (!formula) return;
        try {
          await navigator.clipboard?.writeText(getFormulaSetupMoves(this.withSelectedFormulaMoves(formula)).join(" "));
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
          await navigator.clipboard?.writeText(this.getSelectedFormulaMoves(formula).join(" "));
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
        const formula = id ? getFormulaById(id) : undefined;
        if (!formula) return;
        const practiceFormula = this.withSelectedFormulaMoves(formula);
        if (!isFormulaDevicePracticeSafe(practiceFormula)) {
          this.cb.log(`该公式包含 M / 宽转 / 转体，暂不进入智能魔方专项计时：${formula.id}`, "error");
          return;
        }
        this.pendingPractice = { formula: practiceFormula, candidates: [practiceFormula], order: "sequential" };
        this.els.practiceFormulaName.textContent = `${formula.id} · ${this.getFormulaDisplayName(formula)}`;
        this.els.practiceCount.value = "10";
        this.els.practiceModal.classList.add("open");
      });
    });
  }

  private bindFormulaCubeControls(): void {
    this.els.libraryContent.querySelectorAll<HTMLElement>(".formula-cube-scene").forEach((scene) => {
      const moves = scene.dataset.formulaCubeMoves?.trim().split(/\s+/).filter(Boolean) ?? [];
      const visualizer = new CubeVisualizer(scene, { initialRotationX: -28, initialRotationY: -38 });
      visualizer.loadMoves(moves);
    });
  }

  // ====== 筛选与变体 ======

  private getVisibleFormulas(category: FormulaCategory): Formula[] {
    const search = this.libraryState.search.trim().toLowerCase();
    return listByCategory(category).filter((formula) => {
      if (this.libraryState.difficulty !== null && formula.difficulty !== this.libraryState.difficulty) return false;
      if (this.libraryState.tag && !formula.tags.includes(this.libraryState.tag)) return false;
      if (this.libraryState.hideMastered && this.masteredFormulaIds.has(formula.id)) return false;
      if (!search) return true;
      const haystack = [formula.id, formula.name, formula.moves.join(" "), formula.tags.join(" ")].join(" ").toLowerCase();
      return haystack.includes(search);
    });
  }

  private getCategoryTags(category: FormulaCategory): string[] {
    return [...new Set(listByCategory(category).flatMap((formula) => formula.tags))].sort();
  }

  private getFormulaVariants(formula: Formula): FormulaVariant[] {
    const sourceVariants: FormulaVariant[] = [
      { name: "主解", moves: formula.moves, note: "默认角度" },
      ...(formula.variants ?? []),
      ...(this.speedCubeDbVariants.get(formula.id) ?? []).map((moves, index) => ({
        name: `备用解 ${index + 1}`,
        moves,
        note: "SpeedCubeDB",
      })),
    ];
    // 按 moves 序列去重，避免同一解法因来源不同而重复展示
    const seen = new Set<string>();
    const variants: FormulaVariant[] = [];
    for (const variant of sourceVariants) {
      const key = variant.moves.join(" ");
      if (seen.has(key)) continue;
      seen.add(key);
      variants.push(variant);
    }
    return variants;
  }

  private getSelectedFormulaVariant(formula: Formula): FormulaVariant {
    const variants = this.getFormulaVariants(formula);
    const index = this.selectedFormulaVariants.get(formula.id) ?? 0;
    return variants[index] ?? variants[0];
  }

  private getSelectedFormulaMoves(formula: Formula): string[] {
    return this.getSelectedFormulaVariant(formula).moves;
  }

  private withSelectedFormulaMoves(formula: Formula): Formula {
    return { ...formula, moves: this.getSelectedFormulaMoves(formula) };
  }

  private getFormulaDisplayName(formula: Formula): string {
    if (formula.category !== "F2L") return formula.name;
    const labels: Record<string, string> = {
      basic: "基础", paired: "已配对", "split-pair": "分离对", "right-slot": "蓝红槽位",
      "left-slot": "左侧槽位", "corner-on-top": "顶层角块", "edge-on-top": "顶层棱块",
      "white-on-top": "顶层白角", "flipped-edge": "翻转棱块", "corner-in-slot": "角块在槽内",
      "edge-in-slot": "棱块在槽内", "wrong-slot": "错误槽位", extraction: "取出", "back-slot": "后方槽位",
      "hidden-pair": "隐藏配对", sledgehammer: "Sledge 触发", hedgehammer: "Hedge 触发",
      setup: "预调整", rotationless: "免旋转", keyhole: "钥匙孔", "twisted-corner": "扭转角块",
      advanced: "进阶", "slot-preserving": "保槽", "last-pair": "最后一对",
    };
    const details = formula.tags.map((tag) => labels[tag]).filter((label): label is string => Boolean(label));
    const match = /^f2l-(\d+)$/i.exec(formula.id);
    if (!match) return formula.name;
    return `F2L 第 ${Number(match[1])} 例 · ${details.slice(0, 3).join(" / ")}`;
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
        this.masteredFormulaIds = new Set(ids.filter((id): id is string => typeof id === "string"));
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
      if (this.els.libraryModal.classList.contains("open")) this.showLibrary(this.libraryState.category);
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

  // ====== 工具 ======

  private escapeHtml(s: string): string {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  private formatPracticeTime(value: number | null): string {
    return value === null ? "—" : `${(value / 1000).toFixed(2)}s`;
  }
}
