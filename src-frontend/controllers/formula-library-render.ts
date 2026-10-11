/**
 * 公式库渲染器：列表、卡片、case 图与变体控件的 HTML 构建。
 * 通过共享上下文对象读写控制器持有的状态，控制器负责事件绑定与持久化。
 */
import { listByCategory, getLibraryStats, getFormulaById } from "../formula/formula-library.ts";
import type { Formula, FormulaCategory, FormulaVariant } from "../formula/types.ts";
import { groupFormulas } from "../formula/formula-groups.ts";
import { getFormulaSetupMoves, isFormulaDevicePracticeSafe } from "../formula/setup-validation.ts";
import { getFormulaMastery, selectPracticeFormula, type PracticeRecord } from "../core/practice-stats.ts";
import { parseStaticCubePreviewMoves, type StaticCubePreviewAdapter } from "../ui/static-cube-preview.ts";
import { renderFormulaTopView } from "../ui/formula-top-view.ts";
import type { FormulaLibraryCallbacks, FormulaLibraryElements, LibraryState } from "./formula-library-types.ts";

export interface FormulaLibraryRenderContext {
  els: FormulaLibraryElements;
  cb: FormulaLibraryCallbacks;
  libraryState: LibraryState;
  masteredFormulaIds: Set<string>;
  selectedFormulaVariants: Map<string, number>;
  speedCubeDbVariants: Map<string, string[][]>;
  customF2lAlgorithms: Map<string, string[]>;
  expandedVariants: Set<string>;
  collapsedGroups: Set<string>;
  diagramModes: Map<string, "2d" | "3d">;
  staticCubePreviews: StaticCubePreviewAdapter;
  /** 列表重建后重新绑定控制器持有的控件/动作监听（由控制器注入）。 */
  bindControls: () => void;
  bindActions: () => void;
  /** 首次开窗时异步拉取 SpeedCubeDB 备用解（由控制器注入）。 */
  loadSpeedCubeDbVariants: () => void;
}

export class FormulaLibraryRenderer {
  constructor(private readonly ctx: FormulaLibraryRenderContext) {}

  showLibrary(category: FormulaCategory): void {
    this.ctx.libraryState.category = category;
    this.ctx.loadSpeedCubeDbVariants();
    const stats = getLibraryStats();
    // 一次渲染内复用同一份练习记录，避免每个公式卡片重复构建记录数组。
    const records = this.ctx.cb.getPracticeRecords();
    const formulas = this.getVisibleFormulas(category);
    const allInCategory = listByCategory(category);
    const masteredInCategory = allInCategory.filter((f) => this.ctx.masteredFormulaIds.has(f.id)).length;

    this.ctx.staticCubePreviews.destroy();
    this.ctx.els.libraryTitle.textContent = `公式库 · ${stats.total} 个 CASE`;
    this.ctx.els.libraryContent.innerHTML = `
      ${this.renderTodayTrainingQueue(records)}
      <div class="library-tabs">
        <button class="tab-btn ${category === "F2L" ? "active" : ""}" data-cat="F2L">F2L (${stats.F2L})</button>
        <button class="tab-btn ${category === "OLL" ? "active" : ""}" data-cat="OLL">OLL (${stats.OLL})</button>
        <button class="tab-btn ${category === "PLL" ? "active" : ""}" data-cat="PLL">PLL (${stats.PLL})</button>
      </div>
      <div class="library-toolbar">
        <input id="formula-search" type="search" placeholder="搜索 ID、名称、公式、识别点" value="${this.escapeHtml(this.ctx.libraryState.search)}">
        <label class="library-toggle">
          <input id="formula-hide-mastered" type="checkbox" ${this.ctx.libraryState.hideMastered ? "checked" : ""}>
          隐藏已掌握
        </label>
      </div>
      <div class="library-meta">
        <span>显示 ${formulas.length} · 共 ${allInCategory.length} 条</span>
        <span>已掌握 ${masteredInCategory}</span>
        <span>当前 ${category}</span>
      </div>
      <div class="formula-list">
        ${this.renderGroupedFormulaList(category, formulas, records)}
      </div>
      ${formulas.length === 0 ? '<p class="placeholder">没有符合条件的公式，换个筛选条件试试。</p>' : ""}
    `;
    this.ctx.els.libraryModal.classList.add("open");
    this.ctx.bindControls();
    this.ctx.bindActions();
    // 幂等补强：已挂载的场景被 mounted 集合守卫跳过，此处确保开窗同帧即见魔方。
    this.ctx.staticCubePreviews.mountVisibleNow();
  }

  renderRecommendation(rec: { reason: string; formulas: Formula[]; practicePlan: string }): string {
    const records = this.ctx.cb.getPracticeRecords();
    return `
      <div class="recommendation">
        <div class="rec-reason"><strong>推荐理由：</strong>${this.escapeHtml(rec.reason)}</div>
        <div class="rec-plan"><strong>练习计划：</strong>${this.escapeHtml(rec.practicePlan)}</div>
      </div>
      <div class="formula-list">
        ${rec.formulas.map((f) => this.renderFormulaCard(f, records)).join("")}
      </div>
      ${rec.formulas.length === 0 ? '<p class="placeholder">无对应公式库，参考练习计划</p>' : ""}
    `;
  }

  private renderTodayTrainingQueue(records: PracticeRecord[]): string {
    const queue = (["F2L", "OLL", "PLL"] as FormulaCategory[]).flatMap((category) => {
      const candidates = listByCategory(category).filter((f) => isFormulaDevicePracticeSafe(f));
      const formula = selectPracticeFormula(candidates, records);
      return formula ? [formula] : [];
    });
    if (queue.length === 0) return "";
    return `
      <section class="today-training-queue" aria-label="今日训练队列">
        <div class="queue-heading"><span class="eyebrow">今日训练</span><strong class="queue-title"><span>今天练这</span><span class="queue-count">${queue.length}</span><span>条</span></strong><p>优先安排未练习或成功率较低的公式。</p></div>
        <div class="queue-items">${queue.map((formula) => `
          <button class="queue-item" data-practice-formula="${this.escapeHtml(formula.id)}">
            <strong>${this.escapeHtml(formula.id)}</strong>
          </button>
        `).join("")}</div>
      </section>
    `;
  }

  /** 横向卡片：左侧 case 图（2D 顶视图或 3D 预览），右侧公式信息，一屏可见更多内容。 */
  private renderFormulaCard(f: Formula, records: PracticeRecord[]): string {
    const mastered = this.ctx.masteredFormulaIds.has(f.id);
    const mastery = getFormulaMastery(records, f.id);
    const selected = this.withSelectedFormulaMoves(f);
    const moves = selected.moves;
    const algorithm = moves.join(" ");
    const setupMoves = getFormulaSetupMoves(selected);
    const setup = setupMoves.join(" ");

    return `
      <div class="formula-card ${mastered ? "mastered" : ""}">
        <div class="formula-card-side">
          ${this.renderFormulaCaseDiagram(f, setupMoves)}
        </div>
        <div class="formula-card-main">
          <div class="formula-header">
            <span class="formula-id">${this.escapeHtml(f.id)}</span>
          </div>
          <div class="formula-algorithm">
            <div class="algorithm-label">打乱 · Setup <span>从复原状态执行</span></div>
            <code class="algorithm-moves">${this.escapeHtml(setup)}</code>
          </div>
          <div class="formula-algorithm primary">
            <div class="algorithm-label">解法 · Alg <span>${moves.length} 步</span></div>
            <code class="algorithm-moves">${this.escapeHtml(algorithm)}</code>
          </div>
          ${f.source ? `<div class="formula-source">来源：${this.escapeHtml(f.source)}</div>` : ""}
          ${this.renderFormulaVariants(f)}
          ${f.category === "F2L" ? this.renderCustomF2lEditor(f) : ""}
          <div class="formula-actions">
            <button class="ghost" data-copy-setup="${this.escapeHtml(f.id)}">复制打乱</button>
            <button class="ghost" data-copy-formula="${this.escapeHtml(f.id)}">复制公式</button>
            <button class="practice-btn" data-practice-formula="${this.escapeHtml(f.id)}">开始练习</button>
          </div>
          <div class="formula-mastery">练习 ${mastery.attempts} 次 · 成功率 ${(mastery.successRate * 100).toFixed(0)}% · 平均 ${this.formatPracticeTime(mastery.averageDuration)}${mastery.averageRecognitionDuration !== null ? ` · 识别 ${this.formatPracticeTime(mastery.averageRecognitionDuration)} · 执行 ${this.formatPracticeTime(mastery.averageExecutionDuration)}` : ""}</div>
        </div>
      </div>
    `;
  }

  private renderFormulaVariants(formula: Formula): string {
    const variants = this.getFormulaVariants(formula);
    if (variants.length === 0) return "";
    return `<div class="formula-variants" aria-label="${this.escapeHtml(formula.id)} 可选解法">${this.renderVariantControls(formula, variants)}</div>`;
  }

  private renderCustomF2lEditor(formula: Formula): string {
    const saved = this.ctx.customF2lAlgorithms.get(formula.id);
    const id = this.escapeHtml(formula.id);
    return `<details class="formula-custom-editor" data-custom-editor="${id}">
      <summary>${saved ? "编辑我的解法" : "+ 添加我的解法"}</summary>
      <form data-custom-f2l-form="${id}">
        <label for="custom-alg-${id}">我的 ${id} 解法</label>
        <textarea id="custom-alg-${id}" name="algorithm" rows="2" maxlength="1000" required spellcheck="false" aria-describedby="custom-hint-${id}" placeholder="例如：R U R'">${this.escapeHtml(saved?.join(" ") ?? "")}</textarea>
        <p id="custom-hint-${id}">空格分隔，支持 U R F D L B 及 2 / '。按本 case 的主解打乱验证；每个 case 保存一条，仅存在本机。</p>
        <p class="custom-formula-message" data-custom-message role="status" aria-live="polite"></p>
        <div class="custom-formula-actions"><button type="submit">保存并使用</button>${saved ? `<button type="button" class="ghost" data-delete-custom-f2l="${id}">删除我的解法</button>` : ""}</div>
      </form>
    </details>`;
  }

  /** 折叠态只渲染当前解法 + 展开按钮，减少每个卡片的 DOM 体量。 */
  renderVariantControls(formula: Formula, variants: FormulaVariant[] = this.getFormulaVariants(formula)): string {
    const selectedIndex = this.ctx.selectedFormulaVariants.get(formula.id) ?? 0;
    const activeIndex = variants[selectedIndex] ? selectedIndex : 0;
    const expanded = this.ctx.expandedVariants.has(formula.id);
    const buttons = expanded
      ? variants.map((variant, index) => this.renderVariantButton(formula.id, variant, index, index === activeIndex))
      : [this.renderVariantButton(formula.id, variants[activeIndex], activeIndex, true)];
    if (variants.length > 1) {
      buttons.push(
        `<button class="formula-variants-toggle" type="button" data-toggle-variants="${this.escapeHtml(formula.id)}">${
          expanded ? "收起解法" : `查看全部 ${variants.length} 个解法`
        }</button>`,
      );
    }
    return buttons.join("");
  }

  private renderVariantButton(id: string, variant: FormulaVariant, index: number, active: boolean): string {
    return `
      <button
        class="formula-variant ${active ? "active" : ""}"
        data-select-formula-variant="${this.escapeHtml(id)}"
        data-variant-index="${index}"
        type="button"
      >
        <span class="variant-name">${this.escapeHtml(variant.name)}</span>
        <code>${this.escapeHtml(variant.moves.join(" "))}</code>
        <span class="variant-meta">${variant.moves.length} 步${variant.note ? ` · ${this.escapeHtml(variant.note)}` : ""}</span>
      </button>
    `;
  }

  /** case 图：F2L 恒为 3D（顶视图表达不了槽内朝向，3D 从上方展示顶层对块）；OLL/PLL 默认 2D 顶视图、可切 3D。 */
  private renderFormulaCaseDiagram(formula: Formula, setup: string[]): string {
    const setupText = setup.join(" ");
    if (formula.category === "F2L") {
      return `
        <div class="formula-case-diagram" aria-label="${this.escapeHtml(formula.id)} 3D case">
          <div class="formula-case-view" data-case-setup="${this.escapeHtml(setupText)}">${this.renderCaseCubeScene(formula, setupText)}</div>
        </div>
      `;
    }
    const is2d = (this.ctx.diagramModes.get(formula.id) ?? "2d") === "2d";
    return `
      <div class="formula-case-diagram" aria-label="${this.escapeHtml(formula.id)} case">
        <div class="formula-case-view" data-case-setup="${this.escapeHtml(setupText)}">
          ${is2d ? renderFormulaTopView(setup, formula.category) : this.renderCaseCubeScene(formula, setupText)}
        </div>
        <div class="formula-case-modes" role="group" aria-label="case 图显示模式">
          <button type="button" class="case-mode-btn ${is2d ? "active" : ""}" data-case-mode="2d" data-formula-id="${this.escapeHtml(formula.id)}">2D</button>
          <button type="button" class="case-mode-btn ${is2d ? "" : "active"}" data-case-mode="3d" data-formula-id="${this.escapeHtml(formula.id)}">3D</button>
        </div>
      </div>
    `;
  }

  private renderCaseCubeScene(formula: Formula, setupText: string): string {
    const targetSlot = formula.tags.includes("left-slot") ? "left" : "right";
    return `<div class="formula-cube-scene" data-static-cube-preview="${this.escapeHtml(setupText)}" data-static-cube-category="${formula.category}" data-static-cube-target-slot="${targetSlot}"></div>`;
  }

  /** 2D/3D 切换：原地替换 case 视图内容，3D 走按需挂载队列，不重建整张卡片。 */
  switchCaseDiagram(id: string, mode: "2d" | "3d"): void {
    this.ctx.diagramModes.set(id, mode);
    const card = this.ctx.els.libraryContent.querySelector<HTMLElement>(`.formula-card [data-case-mode][data-formula-id="${CSS.escape(id)}"]`)?.closest<HTMLElement>(".formula-card");
    const view = card?.querySelector<HTMLElement>(".formula-case-view");
    const formula = getFormulaById(id);
    if (!card || !view || !formula || formula.category === "F2L") return;
    const setupText = view.dataset.caseSetup ?? "";
    if (mode === "3d") {
      view.innerHTML = this.renderCaseCubeScene(formula, setupText);
      const scene = view.querySelector<HTMLElement>("[data-static-cube-preview]");
      if (scene) this.ctx.staticCubePreviews.mountNow(scene);
    } else {
      view.querySelectorAll<HTMLElement>("[data-static-cube-preview]").forEach((scene) => this.ctx.staticCubePreviews.unmountScene(scene));
      view.innerHTML = renderFormulaTopView(parseStaticCubePreviewMoves(setupText), formula.category);
    }
    card.querySelectorAll<HTMLButtonElement>("[data-case-mode]").forEach((btn) => btn.classList.toggle("active", btn.dataset.caseMode === mode));
  }

  /** 分组渲染：每组一个可折叠的组头，组内卡片保持单列网格。 */
  private renderGroupedFormulaList(category: FormulaCategory, formulas: Formula[], records: PracticeRecord[]): string {
    return groupFormulas(category, formulas).map(({ definition, formulas: members }) => {
      const collapsed = this.ctx.collapsedGroups.has(definition.id);
      const masteredCount = members.filter((f) => this.ctx.masteredFormulaIds.has(f.id)).length;
      return `
        <section class="formula-group ${collapsed ? "collapsed" : ""}" data-group-id="${this.escapeHtml(definition.id)}">
          <button type="button" class="formula-group-header" data-toggle-group="${this.escapeHtml(definition.id)}" aria-expanded="${collapsed ? "false" : "true"}">
            <span class="formula-group-name">${this.escapeHtml(definition.label)}</span>
            <span class="formula-group-stats">${masteredCount} 已掌握 · ${members.length} 条</span>
            <span class="formula-group-chevron" aria-hidden="true">▾</span>
          </button>
          <div class="formula-group-items">${members.map((f) => this.renderFormulaCard(f, records)).join("")}</div>
        </section>
      `;
    }).join("");
  }

  // ====== 筛选与变体 ======

  private getVisibleFormulas(category: FormulaCategory): Formula[] {
    const search = this.ctx.libraryState.search.trim().toLowerCase();
    return listByCategory(category).filter((formula) => {
      if (this.ctx.libraryState.hideMastered && this.ctx.masteredFormulaIds.has(formula.id)) return false;
      if (!search) return true;
      const haystack = [formula.id, formula.name, this.ctx.customF2lAlgorithms.get(formula.id)?.join(" ") ?? "", formula.moves.join(" "), formula.tags.join(" ")].join(" ").toLowerCase();
      return haystack.includes(search);
    });
  }

  getFormulaVariants(formula: Formula): FormulaVariant[] {
    const customMoves = this.ctx.customF2lAlgorithms.get(formula.id);
    const sourceVariants: FormulaVariant[] = [
      ...(customMoves ? [{ name: "我的解法", moves: customMoves, setupMoves: getFormulaSetupMoves(formula), note: "本机保存" }] : []),
      { name: "主解", moves: formula.moves, note: "默认角度" },
      ...(formula.variants ?? []),
      ...(this.ctx.speedCubeDbVariants.get(formula.id) ?? []).map((moves, index) => ({
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
    const index = this.ctx.selectedFormulaVariants.get(formula.id) ?? 0;
    return variants[index] ?? variants[0];
  }

  getSelectedFormulaMoves(formula: Formula): string[] {
    return this.getSelectedFormulaVariant(formula).moves;
  }

  withSelectedFormulaMoves(formula: Formula): Formula {
    const variant = this.getSelectedFormulaVariant(formula);
    return { ...formula, moves: variant.moves, setupMoves: variant.setupMoves ?? formula.setupMoves };
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
