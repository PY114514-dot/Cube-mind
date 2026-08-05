/**
 * 历史成绩面板控制器
 * 管理 AO 统计、最近记录、设备统计、趋势图、复盘候选、分组和导出。
 */

import type { AnalysisInput } from "../agent/types.ts";
import { formatWcaAverage, formatWcaSolveTime, getWcaScore } from "../core/wca-average.ts";
import { isScoreEligible } from "../core/solve-validation.ts";
import { formatHistoryCsv, formatHistoryJson } from "../core/history-export.ts";
import { HistoryDetailController } from "../ui/history-detail-controller.ts";

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
  { id: "practice-formula", name: "公式练习" },
  { id: "practice-cross", name: "Cross 练习" },
  { id: "practice-f2l", name: "F2L 练习" },
  { id: "practice-cross-f2l", name: "Cross + F2L 练习" },
] as const;

export const SYSTEM_HISTORY_GROUP_IDS = new Set<string>(SYSTEM_HISTORY_GROUPS.map((g) => g.id));

const HISTORY_GROUPS_KEY = "cubemind:history-groups";
const SCORE_DISPLAY_MODE_KEY = "cubemind:score-display-mode";
const REVIEW_THRESHOLD_KEY = "cubemind:review-threshold";

export interface HistoryControllerElements {
  historyToday: HTMLElement;
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
  reviewThreshold: HTMLInputElement;
  btnRefreshReview: HTMLButtonElement;
  reviewList: HTMLDivElement;
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
  onRetry: (scramble: string) => void;
  onDelete: (index: number) => void;
  /** 分组删除修改了记录内容后通知外层持久化 */
  onSave: () => void;
  renderBlockPracticeStats: () => void;
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
      () => this.isDetailedMode(),
    );
  }

  init(): void {
    this.els.scoreDisplayMode.value = localStorage.getItem(SCORE_DISPLAY_MODE_KEY) === "detailed" ? "detailed" : "simple";
    const savedThreshold = Number(localStorage.getItem(REVIEW_THRESHOLD_KEY));
    if (Number.isFinite(savedThreshold) && savedThreshold >= 0) {
      this.els.reviewThreshold.value = String(savedThreshold);
    }

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
    this.els.reviewThreshold.onchange = () => {
      localStorage.setItem(REVIEW_THRESHOLD_KEY, this.els.reviewThreshold.value);
      this.renderReviewCandidates();
    };
    this.els.btnRefreshReview.onclick = () => {
      localStorage.setItem(REVIEW_THRESHOLD_KEY, this.els.reviewThreshold.value);
      this.renderReviewCandidates();
    };
    this.els.btnCloseHistory.onclick = () => this.closeModal();
    this.els.btnViewHistorySolution.onclick = () => {
      const solve = this.selectedHistoryIndex === null ? undefined : this.cb.getRecords()[this.selectedHistoryIndex];
      if (solve) this.detailController.render(solve, true);
    };
    this.els.btnRetryHistory.onclick = () => {
      const solve = this.selectedHistoryIndex === null ? undefined : this.cb.getRecords()[this.selectedHistoryIndex];
      if (this.selectedHistoryIndex === null || !solve?.scramble) return;
      this.cb.onRetry(solve.scramble);
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
      .filter((solve) => isScoreEligible(solve.physicalState, solve.qualityStatus));
    const averages: Array<[HTMLElement, number]> = [
      [this.els.historyAo5, 5], [this.els.historyAo12, 12], [this.els.historyAo25, 25],
      [this.els.historyAo50, 50], [this.els.historyAo100, 100],
    ];
    for (const [element, size] of averages) element.textContent = this.formatAverage(scoredSolves, size);

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
    this.cb.renderBlockPracticeStats();
    this.renderReviewCandidates();
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
    if (this.selectedHistoryGroup === "practice-formula") return solve.practiceKind === "formula";
    if (this.selectedHistoryGroup === "practice-cross") return solve.practiceKind === "cross";
    if (this.selectedHistoryGroup === "practice-f2l") return solve.practiceKind === "f2l";
    if (this.selectedHistoryGroup === "practice-cross-f2l") return solve.practiceKind === "cross-f2l";
    return solve.groupId === this.selectedHistoryGroup;
  }

  private getPracticeLabel(solve: AnalysisInput): string {
    if (solve.practiceKind === "formula") return solve.practiceFormulaId ? `公式 ${solve.practiceFormulaId}` : "公式练习";
    if (solve.practiceKind === "cross") return "Cross 练习";
    if (solve.practiceKind === "f2l") return "F2L 练习";
    if (solve.practiceKind === "cross-f2l") return "Cross+F2L";
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
    const groups = new Map<string, AnalysisInput[]>();
    for (const solve of solves) {
      if (!isScoreEligible(solve.physicalState, solve.qualityStatus)) continue;
      const key = solve.deviceId?.trim() || solve.deviceName?.trim() || "未标识魔方";
      const records = groups.get(key) ?? [];
      records.push(solve);
      groups.set(key, records);
    }
    const stats = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
    this.els.deviceHistory.innerHTML = stats.length === 0
      ? "暂无设备成绩"
      : stats.map(([, records]) => {
        const name = records[0].deviceName?.trim() || "未标识魔方";
        const scores = records.map((solve) => getWcaScore({ duration: solve.totalDuration, penalty: solve.penalty })).filter(Number.isFinite);
        const average = scores.reduce((sum, value) => sum + value, 0) / scores.length;
        const best = Math.min(...scores);
        const latest = Math.max(...records.map((record) => record.completedAt ?? 0));
        const latestLabel = latest > 0 ? new Date(latest).toLocaleDateString() : "—";
        return `<div class="device-history-entry">
          <strong>${escapeHtml(name)}</strong>
          <span>${records.length} 把</span>
          <span>平均 ${scores.length ? `${(average / 1000).toFixed(2)}s` : "DNF"}</span>
          <span>最佳 ${scores.length ? `${(best / 1000).toFixed(2)}s` : "DNF"}</span>
          <em>最近 ${latestLabel}</em>
        </div>`;
      }).join("");
  }

  private renderReviewCandidates(): void {
    const records = this.cb.getRecords();
    const eligible = records
      .map((solve, index) => ({ solve, index }))
      .filter(({ solve }) => isScoreEligible(solve.physicalState, solve.qualityStatus) && !isPracticeSolve(solve));
    const recent = eligible.slice(-100);
    const scoreOf = (solve: AnalysisInput): number => getWcaScore({ duration: solve.totalDuration, penalty: solve.penalty });
    const slowest = [...recent].sort((a, b) => scoreOf(b.solve) - scoreOf(a.solve)).slice(0, 10);
    const thresholdSeconds = Math.max(0, Number(this.els.reviewThreshold.value) || 0);
    const selected = new Map<number, { solve: AnalysisInput; index: number }>();
    for (const item of slowest) selected.set(item.index, item);
    for (const item of recent) {
      if (scoreOf(item.solve) / 1000 >= thresholdSeconds) selected.set(item.index, item);
    }

    const candidates = [...selected.values()].sort((a, b) => scoreOf(b.solve) - scoreOf(a.solve));
    this.els.reviewList.innerHTML = candidates.length === 0
      ? "当前没有符合条件的成绩。"
      : candidates.map(({ solve, index }) => {
        const insight = getReviewInsight(solve);
        return `
        <button class="review-entry" data-review-index="${index}">
          <span>#${index + 1}</span>
          <strong>${formatSolveTimeLocal(solve)}${solve.penalty === "dnf" ? "" : "s"}</strong>
          <em>${(solve.tps ?? 0).toFixed(2)} TPS</em>
          <small><b>${insight.bottleneck}</b>：${insight.reason}<br>${insight.advice}</small>
        </button>
      `;
      }).join("");
    this.els.reviewList.querySelectorAll<HTMLButtonElement>("[data-review-index]").forEach((entry) => {
      entry.addEventListener("click", () => {
        const index = Number(entry.dataset.reviewIndex);
        if (!Number.isInteger(index) || !records[index]) return;
        this.selectedHistoryIndex = index;
        this.detailController.render(records[index], false);
        this.els.historyModal.classList.add("open");
      });
    });
  }

  private renderPerformanceChart(durations: number[]): void {
    if (durations.length === 0) {
      this.els.performanceMean.textContent = "—";
      this.els.performanceStd.textContent = "—";
      this.els.performanceChart.innerHTML = '<text x="300" y="92" text-anchor="middle" fill="var(--warm-gray)" font-size="14">完成一把后显示成绩趋势</text>';
      return;
    }

    const values = durations.slice(-30).map((duration) => duration / 1000);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    this.els.performanceMean.textContent = `${mean.toFixed(2)}s`;
    this.els.performanceStd.textContent = `${Math.sqrt(variance).toFixed(2)}s`;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(0.5, max - min);
    const points = values.map((value, index) => {
      const x = values.length === 1 ? 300 : 36 + (index * 528) / (values.length - 1);
      const y = 150 - ((value - min) / range) * 112;
      return { x, y, value };
    });
    const line = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
    const dots = points.map((point) => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4" fill="var(--gold)"><title>${point.value.toFixed(2)}s</title></circle>`).join("");
    const meanY = 150 - ((mean - min) / range) * 112;
    this.els.performanceChart.innerHTML = `
      <line x1="36" y1="150" x2="564" y2="150" stroke="var(--rule)" />
      <line x1="36" y1="38" x2="36" y2="150" stroke="var(--rule)" />
      <line x1="36" y1="${meanY.toFixed(1)}" x2="564" y2="${meanY.toFixed(1)}" stroke="var(--gold-light)" stroke-dasharray="5 5" />
      <polyline points="${line}" fill="none" stroke="var(--gold)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      ${dots}
      <text x="8" y="42" fill="var(--warm-gray)" font-size="11">${max.toFixed(2)}s</text>
      <text x="8" y="152" fill="var(--warm-gray)" font-size="11">${min.toFixed(2)}s</text>
    `;
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

// ====== 模块级辅助 ======

function isPracticeSolve(solve: AnalysisInput): boolean {
  return Boolean(solve.practiceKind || solve.practiceMode || solve.practiceFormulaId);
}

function formatSolveTimeLocal(solve: AnalysisInput): string {
  return formatWcaSolveTime({ duration: solve.totalDuration, penalty: solve.penalty });
}

function getReviewInsight(solve: AnalysisInput): { bottleneck: string; reason: string; advice: string } {
  const stages: Array<[string, number]> = [
    ["Cross", solve.crossDuration], ["F2L", solve.f2lDuration],
    ["OLL", solve.ollDuration], ["PLL", solve.pllDuration],
  ];
  const [bottleneck, duration] = stages.reduce((slowest, current) => current[1] > slowest[1] ? current : slowest);
  const longestPause = solve.stepReview?.pauses.reduce(
    (longest, pause) => pause.gap > longest.gap ? pause : longest,
    { gap: 0, move: "", stage: "" },
  );
  const slotInsight = getF2lSlotInsight(solve);
  if (slotInsight) return slotInsight;
  if (longestPause && longestPause.gap >= 1000) {
    return {
      bottleneck,
      reason: `${longestPause.stage || bottleneck} 在 ${longestPause.move || "动作间"} 停顿 ${(longestPause.gap / 1000).toFixed(2)}s`,
      advice: `先练习 ${longestPause.stage || bottleneck} 的连续识别，目标是把停顿压到 1 秒以内。`,
    };
  }
  return {
    bottleneck,
    reason: `${bottleneck} 用时 ${(duration / 1000).toFixed(2)}s，占本次成绩主要比例`,
    advice: `建立 ${bottleneck} 专项训练，优先减少观察和启动前停顿。`,
  };
}

function getF2lSlotInsight(solve: AnalysisInput): { bottleneck: string; reason: string; advice: string } | null {
  const completedSlots = (solve.f2lSlots ?? []).filter((slot) => !slot.completedWithCross && slot.duration !== undefined);
  if (completedSlots.length === 0) return null;
  const target = completedSlots.reduce((worst, slot) => {
    const worstScore = (worst.duration ?? 0) + worst.maxGap * 1.5 + worst.repairCount * 1000 + worst.breakCount * 1000;
    const score = (slot.duration ?? 0) + slot.maxGap * 1.5 + slot.repairCount * 1000 + slot.breakCount * 1000;
    return score > worstScore ? slot : worst;
  });
  const slotDuration = ((target.duration ?? 0) / 1000).toFixed(2);
  const pauseText = target.maxGap >= 800 ? `，最长停顿 ${(target.maxGap / 1000).toFixed(2)}s` : "";
  const recoveryText = target.repairCount > 0 || target.breakCount > 0
    ? `，修复 ${target.repairCount} 次、回退 ${target.breakCount} 次`
    : "";
  return {
    bottleneck: `F2L · ${target.slot}`,
    reason: `第 ${target.completionOrder ?? "—"} 对 ${target.slot} 用时 ${slotDuration}s、${target.moves ?? 0} 步${pauseText}${recoveryText}`,
    advice: target.maxGap >= 800
      ? `专项练 ${target.slot} 槽位的连续观察：本对插入前先锁定下一对，优先把这次 ${(target.maxGap / 1000).toFixed(2)}s 停顿压低。`
      : `专项练 ${target.slot} 槽位：保持本对 ${target.moves ?? 0} 步的执行节奏，减少重做和回退。`,
  };
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
