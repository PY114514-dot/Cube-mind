/**
 * 历史成绩面板控制器
 * 管理 AO 统计、最近记录、设备统计、趋势图、分组和导出。
 * 视图构建（复盘洞察/设备统计/趋势图 SVG）抽到 history-view-helpers.ts。
 */

import type { AnalysisInput } from "../agent/types.ts";
import type { F2lSolutionReview } from "../../src-shared/analysis-types.ts";
import { formatWcaAverage, getWcaScore } from "../core/wca-average.ts";
import { resolvePersistedSolveTrust } from "../core/solve-validation.ts";
import { formatHistoryCsv, formatHistoryJson } from "../core/history-export.ts";
import { HistoryDetailController } from "../ui/history-detail-controller.ts";
import {
  escapeHtml, formatSolveTimeLocal, isPracticeSolve,
  renderDeviceHistoryHtml, renderPerformanceChartSvg,
} from "./history-view-helpers.ts";

// ====== 类型与常量 ======

interface HistoryGroup {
  id: string;
  name: string;
  createdAt: number;
}

const SYSTEM_HISTORY_GROUPS = [
  { id: "normal", name: "普通计时" },
  { id: "all", name: "全部记录（含练习）" },
  { id: "practice", name: "全部练习" },
  { id: "practice-review", name: "原题复习" },
  { id: "practice-formula", name: "公式练习" },
  { id: "practice-cross", name: "Cross 练习" },
  { id: "practice-f2l", name: "F2L 练习" },
  { id: "practice-cross-f2l", name: "Cross + F2L 练习" },
  { id: "practice-xcross", name: "XC 专项" },
] as const;

export const SYSTEM_HISTORY_GROUP_IDS = new Set<string>(SYSTEM_HISTORY_GROUPS.map((g) => g.id));

const HISTORY_GROUPS_KEY = "cubemind:history-groups";
const SCORE_DISPLAY_MODE_KEY = "cubemind:score-display-mode";

export interface HistoryControllerElements {
  historyToday: HTMLElement;
  statLast: HTMLElement;
  statAo5: HTMLElement;
  statCount: HTMLElement;
  historyAo5: HTMLElement;
  historyAo12: HTMLElement;
  historyAo25: HTMLElement;
  historyAo50: HTMLElement;
  historyAo100: HTMLElement;
  historyLastFive: HTMLDivElement;
  deviceHistory: HTMLDivElement;
  historyGroup: HTMLSelectElement;
  btnNewHistoryGroup: HTMLButtonElement;
  btnDeleteHistoryGroup: HTMLButtonElement;
  btnExportHistoryJson: HTMLButtonElement;
  btnExportHistoryCsv: HTMLButtonElement;
  scoreDisplayMode: HTMLSelectElement;
  performanceChart: SVGSVGElement;
  performanceMean: HTMLElement;
  performanceStd: HTMLElement;
  historyModal: HTMLDivElement;
  historyDetail: HTMLDivElement;
  btnCloseHistory: HTMLButtonElement;
  btnRetryHistory: HTMLButtonElement;
  btnViewHistorySolution: HTMLButtonElement;
  btnDeleteHistory: HTMLButtonElement;
}

export interface HistoryControllerCallbacks {
  log: (msg: string, level?: "info" | "move" | "error") => void;
  getRecords: () => AnalysisInput[];
  onRetry: (solve: AnalysisInput) => void;
  getF2lSolutions: (solve: AnalysisInput) => F2lSolutionReview[];
  onDelete: (index: number) => void;
  /** 分组删除修改了记录内容后通知外层持久化 */
  onSave: () => void;
}

// ====== 控制器 ======

export class HistoryController {
  private historyGroups: HistoryGroup[] = [];
  private selectedHistoryGroup = "normal";
  private selectedHistoryIndex: number | null = null;
  private detailController: HistoryDetailController;

  constructor(
    private readonly els: HistoryControllerElements,
    private readonly cb: HistoryControllerCallbacks,
  ) {
    this.detailController = new HistoryDetailController(
      { detail: els.historyDetail, retryButton: els.btnRetryHistory, solutionButton: els.btnViewHistorySolution },
      cb.getF2lSolutions,
    );
  }

  init(): void {
    this.els.scoreDisplayMode.value = localStorage.getItem(SCORE_DISPLAY_MODE_KEY) === "detailed" ? "detailed" : "simple";
    this.els.historyGroup.onchange = () => {
      this.selectedHistoryGroup = this.els.historyGroup.value;
      this.render();
    };
    this.els.btnNewHistoryGroup.onclick = () => {
      const name = window.prompt("请输入历史分组名称");
      if (!name?.trim()) return;
      const group: HistoryGroup = { id: `group-${Date.now()}`, name: name.trim(), createdAt: Date.now() };
      this.historyGroups.push(group);
      this.selectedHistoryGroup = group.id;
      this.saveHistoryGroups();
      this.render();
    };
    this.els.btnDeleteHistoryGroup.onclick = () => {
      if (SYSTEM_HISTORY_GROUP_IDS.has(this.selectedHistoryGroup)) return;
      const group = this.historyGroups.find((item) => item.id === this.selectedHistoryGroup);
      if (!group || !window.confirm(`删除分组"${group.name}"？其中的成绩会保留，但移到未分组。`)) return;
      this.cb.getRecords().forEach((solve) => {
        if (solve.groupId === group.id) delete solve.groupId;
      });
      this.historyGroups = this.historyGroups.filter((item) => item.id !== group.id);
      this.selectedHistoryGroup = "normal";
      this.saveHistoryGroups();
      this.cb.onSave();
      this.render();
    };
    this.els.btnExportHistoryJson.onclick = () => {
      const records = this.cb.getRecords();
      this.download(formatHistoryJson(records), "cubemind-history.json", "application/json;charset=utf-8");
      this.cb.log(`已导出 ${records.length} 条历史记录（JSON）`);
    };
    this.els.btnExportHistoryCsv.onclick = () => {
      const records = this.cb.getRecords();
      this.download(formatHistoryCsv(records), "cubemind-history.csv", "text/csv;charset=utf-8");
      this.cb.log(`已导出 ${records.length} 条历史记录（CSV）`);
    };
    this.els.scoreDisplayMode.onchange = () => {
      localStorage.setItem(SCORE_DISPLAY_MODE_KEY, this.els.scoreDisplayMode.value);
      this.render();
      if (this.selectedHistoryIndex !== null && this.cb.getRecords()[this.selectedHistoryIndex]) {
        this.detailController.render(this.cb.getRecords()[this.selectedHistoryIndex], false);
      }
    };
    this.els.btnCloseHistory.onclick = () => this.closeModal();
    this.els.btnViewHistorySolution.onclick = () => {
      const solve = this.selectedHistoryIndex === null ? undefined : this.cb.getRecords()[this.selectedHistoryIndex];
      if (solve) this.detailController.render(solve, true);
    };
    this.els.btnRetryHistory.onclick = () => {
      const solve = this.selectedHistoryIndex === null ? undefined : this.cb.getRecords()[this.selectedHistoryIndex];
      if (this.selectedHistoryIndex === null || !solve?.scramble) return;
      this.cb.onRetry(solve);
      this.closeModal();
    };
    this.els.btnDeleteHistory.onclick = () => {
      if (this.selectedHistoryIndex === null) return;
      this.cb.onDelete(this.selectedHistoryIndex);
      this.selectedHistoryIndex = null;
      this.closeModal();
    };

    this.loadHistoryGroups();
    this.render();
  }

  render(): void {
    this.renderHistoryGroupOptions();
    const records = this.cb.getRecords();
    const visibleHistory = this.getVisibleHistory();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayCount = visibleHistory.filter(({ solve }) => (solve.completedAt ?? 0) >= todayStart.getTime()).length;
    this.els.historyToday.textContent = `${todayCount} 次`;
    const scoredSolves = visibleHistory
      .map(({ solve }) => solve)
      .filter((solve) => resolvePersistedSolveTrust(solve).scoreEligible && solve.practiceKind !== "review");
    const averages: Array<[HTMLElement, number]> = [
      [this.els.historyAo5, 5], [this.els.historyAo12, 12], [this.els.historyAo25, 25],
      [this.els.historyAo50, 50], [this.els.historyAo100, 100],
    ];
    for (const [element, size] of averages) element.textContent = this.formatAverage(scoredSolves, size);
    const lastScore = scoredSolves[scoredSolves.length - 1];
    this.els.statLast.textContent = lastScore ? `${formatSolveTimeLocal(lastScore)}${lastScore.penalty === "dnf" ? "" : "s"}` : "—";
    this.els.statAo5.textContent = this.els.historyAo5.textContent;
    this.els.statCount.textContent = String(visibleHistory.length);

    const latest = visibleHistory
      .slice(-10)
      .map((entry, visibleIndex) => ({ ...entry, visibleIndex: Math.max(0, visibleHistory.length - 10) + visibleIndex }))
      .reverse();
    this.els.historyLastFive.innerHTML = latest.length === 0
      ? "暂无完成记录"
      : latest.map(({ solve, index: historyIndex, visibleIndex }) => {
        const practiceLabel = this.getPracticeLabel(solve);
        const detail = this.isDetailedMode()
          ? `TPS ${(solve.tps ?? 0).toFixed(2)} · Cross ${(solve.crossDuration / 1000).toFixed(2)}s · F2L ${(solve.f2lDuration / 1000).toFixed(2)}s · OLL ${(solve.ollDuration / 1000).toFixed(2)}s · PLL ${(solve.pllDuration / 1000).toFixed(2)}s`
          : `${(solve.tps ?? 0).toFixed(2)} TPS`;
        return `<button class="history-entry" data-history-index="${historyIndex}"><span>#${visibleIndex + 1}${practiceLabel ? ` · ${escapeHtml(practiceLabel)}` : ""}</span><strong>${formatSolveTimeLocal(solve)}${solve.penalty === "dnf" ? "" : "s"}</strong><em>${detail}</em></button>`;
      }).join("");
    this.els.historyLastFive.querySelectorAll<HTMLButtonElement>("[data-history-index]").forEach((entry) => {
      entry.addEventListener("click", () => {
        const index = Number(entry.dataset.historyIndex);
        if (!Number.isInteger(index) || !records[index]) return;
        this.selectedHistoryIndex = index;
        this.detailController.render(records[index], false);
        this.els.historyModal.classList.add("open");
      });
    });
    this.renderDeviceHistory(visibleHistory.map(({ solve }) => solve));
    this.renderPerformanceChart(scoredSolves.map((solve) => getWcaScore({ duration: solve.totalDuration, penalty: solve.penalty })).filter(Number.isFinite));
  }

  animateRefresh(): void {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const metrics = [this.els.historyToday, this.els.historyAo5, this.els.historyAo12, this.els.historyAo25, this.els.historyAo50, this.els.historyAo100];
    for (const metric of metrics) {
      metric.classList.remove("score-updated");
      void metric.offsetWidth;
      metric.classList.add("score-updated");
    }
  }

  getSelectedGroup(): string {
    return this.selectedHistoryGroup;
  }

  isDetailedMode(): boolean {
    return this.els.scoreDisplayMode.value === "detailed";
  }

  openDetail(solve: AnalysisInput, showSolution: boolean): void {
    this.selectedHistoryIndex = this.cb.getRecords().indexOf(solve);
    this.detailController.render(solve, showSolution);
    this.els.historyModal.classList.add("open");
  }

  closeModal(): void {
    this.detailController.close();
    this.els.historyModal.classList.remove("open");
  }

  // ====== 私有方法 ======

  private getVisibleHistory(): Array<{ solve: AnalysisInput; index: number }> {
    return this.cb.getRecords()
      .map((solve, index) => ({ solve, index }))
      .filter(({ solve }) => this.isInSelectedGroup(solve));
  }

  private isInSelectedGroup(solve: AnalysisInput): boolean {
    if (this.selectedHistoryGroup === "all") return true;
    if (this.selectedHistoryGroup === "normal") return !isPracticeSolve(solve);
    if (this.selectedHistoryGroup === "practice") return isPracticeSolve(solve);
    if (this.selectedHistoryGroup === "practice-review") return solve.practiceKind === "review";
    if (this.selectedHistoryGroup === "practice-formula") return solve.practiceKind === "formula";
    if (this.selectedHistoryGroup === "practice-cross") return solve.practiceKind === "cross";
    if (this.selectedHistoryGroup === "practice-f2l") return solve.practiceKind === "f2l";
    if (this.selectedHistoryGroup === "practice-cross-f2l") return solve.practiceKind === "cross-f2l";
    if (this.selectedHistoryGroup === "practice-xcross") return solve.practiceKind === "xcross";
    return solve.groupId === this.selectedHistoryGroup;
  }

  private getPracticeLabel(solve: AnalysisInput): string {
    if (solve.practiceKind === "review") return "原题复习";
    if (solve.practiceKind === "formula") return solve.practiceFormulaId ? `公式 ${solve.practiceFormulaId}` : "公式练习";
    if (solve.practiceKind === "cross") return "Cross 练习";
    if (solve.practiceKind === "f2l") return "F2L 练习";
    if (solve.practiceKind === "cross-f2l") return "Cross+F2L";
    if (solve.practiceKind === "xcross") return "XC 专项";
    return "";
  }

  private renderHistoryGroupOptions(): void {
    const systemOptions = SYSTEM_HISTORY_GROUPS
      .map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}</option>`)
      .join("");
    const customOptions = this.historyGroups
      .map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}</option>`)
      .join("");
    this.els.historyGroup.innerHTML = `${systemOptions}${customOptions ? `<option disabled>────────</option>${customOptions}` : ""}`;
    if (!SYSTEM_HISTORY_GROUP_IDS.has(this.selectedHistoryGroup) && !this.historyGroups.some((group) => group.id === this.selectedHistoryGroup)) {
      this.selectedHistoryGroup = "normal";
    }
    this.els.historyGroup.value = this.selectedHistoryGroup;
  }

  private renderDeviceHistory(solves: AnalysisInput[]): void {
    this.els.deviceHistory.innerHTML = renderDeviceHistoryHtml(solves);
  }

  private renderPerformanceChart(durations: number[]): void {
    const { mean, std, svg } = renderPerformanceChartSvg(durations);
    this.els.performanceMean.textContent = mean;
    this.els.performanceStd.textContent = std;
    this.els.performanceChart.innerHTML = svg;
  }

  private formatAverage(solves: AnalysisInput[], size: number): string {
    if (solves.length < size) return "—";
    return formatWcaAverage(solves.slice(-size).map((solve) => ({ duration: solve.totalDuration, penalty: solve.penalty })));
  }

  private loadHistoryGroups(): void {
    const saved = localStorage.getItem(HISTORY_GROUPS_KEY);
    if (!saved) return;
    try {
      const parsed: unknown = JSON.parse(saved);
      if (!Array.isArray(parsed)) return;
      this.historyGroups = parsed.filter((item): item is HistoryGroup => {
        if (typeof item !== "object" || item === null) return false;
        const group = item as Partial<HistoryGroup>;
        return typeof group.id === "string" && typeof group.name === "string" && typeof group.createdAt === "number";
      });
    } catch (error) {
      console.error("[history-groups] 无法加载分组:", error);
      localStorage.removeItem(HISTORY_GROUPS_KEY);
    }
  }

  private saveHistoryGroups(): void {
    localStorage.setItem(HISTORY_GROUPS_KEY, JSON.stringify(this.historyGroups));
  }

  private download(content: string, filename: string, mimeType: string): void {
    const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}
