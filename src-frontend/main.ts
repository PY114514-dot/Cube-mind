/**
 * src/main.ts
 * CubeMind 应用入口（前端 UI 控制器）
 *
 * 职责：
 *   - 初始化所有模块
 *   - 监听 DOM 事件
 *   - 协调 BLE、打乱、计时、CFOP、AGENT、公式库的数据流
 */

import { scramble333 } from "./scramble/scramble-333.ts";
import { parseCfop, formatCfop, type CfopResult } from "./core/cfop-parser.ts";
import { Timer } from "./core/timer.ts";
import { ganCube, type CubeMove } from "./ble/gan-cube-protocol.ts";
import { moyuCube } from "./ble/moyu-cube-protocol.ts";
import { analyzeWithDeepSeek } from "./agent/deepseek.ts";
import type { AnalysisInput, AnalysisResult } from "./agent/types.ts";
import { recommendFormulas, listByCategory, getLibraryStats, getFormulaById } from "./formula/formula-library.ts";
import type { Formula, FormulaCategory, FormulaVariant } from "./formula/types.ts";
import { createCaseFacelets, createFormulaTopViewState, getCubieFaceletIndexesWithColor, getUnsolvedCubieFaceletIndexes, getFace, invertAlgorithm } from "./formula/cube-case-diagram.ts";
import { getFormulaSetupMoves, isFormulaDevicePracticeSafe } from "./formula/setup-validation.ts";
import { recognizeF2lCase, recognizeF2lPracticeCase } from "./core/f2l-case-recognizer.ts";
import { applyScrambleMove, createScrambleProgress, invertMove, type ScrambleProgress } from "./core/scramble-tracker.ts";
import { isScrambleStateVerified } from "./core/scramble-verification.ts";
import { CubeVisualizer } from "./ui/cube-visualizer.ts";
import { SolveReplayPlayer } from "./ui/solve-replay-player.ts";
import { HistoryDetailController } from "./ui/history-detail-controller.ts";
import { isMoveStreamReliable, isSolveEligible, validateSolve } from "./core/solve-validation.ts";
import { calculateWcaAverage, formatWcaAverage, formatWcaSolveTime, getWcaScore } from "./core/wca-average.ts";
import { getInspectionOutcome, type InspectionPenalty } from "./core/inspection-rules.ts";
import { HistoryStore } from "./core/history-store.ts";
import { formatHistoryCsv, formatHistoryJson } from "./core/history-export.ts";
import { analyzeSolveSteps, type SolveReview } from "./core/solve-review.ts";
import { analyzeF2lSlots, formatF2lSlotAnalysis } from "./core/f2l-slot-tracker.ts";
import { createHistoryAnalysisInput, extractBottleneck } from "./agent/analysis-input.ts";
import { bindAnalysisController } from "./agent/analysis-controller.ts";
import { convertSolutionForWhiteDown, solveCross, solveXCross } from "./core/cross-solver.ts";
import { getCfopPhase } from "./core/cstimer-cfop.ts";
import { getFormulaMastery, getPracticeSummary, selectPracticeFormula, type PracticeRecord } from "./core/practice-stats.ts";
import { calculateCrossMetrics } from "./core/cross-metrics.ts";
import { findMoveLossWarning, summarizePrettyReconstruction } from "./core/move-reconstruction.ts";
import { presentSolveQuality } from "./core/data-quality.ts";
import { loadAppSettings, normalizeAppSettings, saveAppSettings, type AppSettings } from "./core/app-settings.ts";
import { sendDiagnosticEvent, type DiagnosticMode } from "./core/diagnostics-client.ts";
import { F2L_CASE_COLORS } from "./utils/cube-colors.ts";

// ====== DOM 引用 ======
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

const els = {
  scrambleText: $("scramble-text") as HTMLDivElement,
  btnScramble: $("btn-scramble") as HTMLButtonElement,
  btnSolveCross: $("btn-solve-cross") as HTMLButtonElement,
  btnSolveXCross: $("btn-solve-xcross") as HTMLButtonElement,
  crossSolution: $("cross-solution") as HTMLDivElement,
  xcrossSolution: $("xcross-solution") as HTMLDivElement,
  btnOpenLibrary: $("btn-open-library") as HTMLButtonElement,
  btnOpenPracticeMode: $("btn-open-practice-mode") as HTMLButtonElement,
  btnOpenSettings: $("btn-open-settings") as HTMLButtonElement,
  settingsModal: $("settings-modal") as HTMLDivElement,
  btnCloseSettings: $("btn-close-settings") as HTMLButtonElement,
  btnSaveSettings: $("btn-save-settings") as HTMLButtonElement,
  settingCrossSteps: $("setting-cross-steps") as HTMLInputElement,
  settingInspectionEnabled: $("setting-inspection-enabled") as HTMLInputElement,
  settingInspectionSeconds: $("setting-inspection-seconds") as HTMLInputElement,
  settingTheme: $("setting-theme") as HTMLSelectElement,
  practiceModeModal: $("practice-mode-modal") as HTMLDivElement,
  btnClosePracticeMode: $("btn-close-practice-mode") as HTMLButtonElement,
  btnStartDailyPractice: $("btn-start-daily-practice") as HTMLButtonElement,
  formulaPracticeOrder: $("formula-practice-order") as HTMLSelectElement,
  formulaPracticeDifficulty: $("formula-practice-difficulty") as HTMLSelectElement,
  formulaPracticeUnmastered: $("formula-practice-unmastered") as HTMLInputElement,
  connectionPanel: $("connection-panel") as HTMLDivElement,
  connectionMenu: $("connection-menu") as HTMLDetailsElement,
  scrambleStage: $("scramble-stage") as HTMLDivElement,
  timerStage: $("timer-stage") as HTMLDivElement,
  historyToday: $("history-today") as HTMLElement,
  historyAo5: $("history-ao5") as HTMLElement,
  historyAo12: $("history-ao12") as HTMLElement,
  historyAo25: $("history-ao25") as HTMLElement,
  historyAo50: $("history-ao50") as HTMLElement,
  historyAo100: $("history-ao100") as HTMLElement,
  historyLastFive: $("history-last-five") as HTMLDivElement,
  deviceHistory: $("device-history") as HTMLDivElement,
  historyGroup: $("history-group") as HTMLSelectElement,
  btnNewHistoryGroup: $("btn-new-history-group") as HTMLButtonElement,
  btnDeleteHistoryGroup: $("btn-delete-history-group") as HTMLButtonElement,
  btnExportHistoryJson: $("btn-export-history-json") as HTMLButtonElement,
  btnExportHistoryCsv: $("btn-export-history-csv") as HTMLButtonElement,
  scoreDisplayMode: $("score-display-mode") as HTMLSelectElement,
  reviewThreshold: $("review-threshold") as HTMLInputElement,
  btnRefreshReview: $("btn-refresh-review") as HTMLButtonElement,
  reviewList: $("review-list") as HTMLDivElement,
  historyModal: $("history-modal") as HTMLDivElement,
  historyDetail: $("history-detail") as HTMLDivElement,
  btnCloseHistory: $("btn-close-history") as HTMLButtonElement,
  btnRetryHistory: $("btn-retry-history") as HTMLButtonElement,
  btnViewHistorySolution: $("btn-view-history-solution") as HTMLButtonElement,
  btnDeleteHistory: $("btn-delete-history") as HTMLButtonElement,
  statusBadge: $("status") as HTMLSpanElement,
  deviceName: $("device-name") as HTMLSpanElement,
  btnConnectGan: $("btn-connect-gan") as HTMLButtonElement,
  ganMacInput: $("gan-mac-input") as HTMLInputElement,
  btnSetGanMac: $("btn-set-gan-mac") as HTMLButtonElement,
  moyuMacInput: $("moyu-mac-input") as HTMLInputElement,
  btnSetMoyuMac: $("btn-set-moyu-mac") as HTMLButtonElement,
  btnConnectMoyu: $("btn-connect-moyu") as HTMLButtonElement,
  btnDisconnect: $("btn-disconnect") as HTMLButtonElement,
  performanceChart: $("performance-chart") as unknown as SVGSVGElement,
  performanceMean: $("performance-mean") as HTMLElement,
  performanceStd: $("performance-std") as HTMLElement,
  cube3d: $("cube-3d") as HTMLDivElement,
  timerDisplay: $("timer-display") as HTMLDivElement,
  inspectionStatus: $("inspection-status") as HTMLParagraphElement,
  btnStart: $("btn-start") as HTMLButtonElement,
  btnStop: $("btn-stop") as HTMLButtonElement,
  btnReset: $("btn-reset") as HTMLButtonElement,
  cfopOutput: $("cfop-output") as HTMLPreElement,
  cfopSummary: $("cfop-summary") as HTMLDivElement,
  resultNextAction: $("result-next-action") as HTMLDivElement,
  agentOutput: $("agent-output") as HTMLDivElement,
  log: $("log") as HTMLDivElement,
  // 公式库相关
  libraryModal: $("library-modal") as HTMLDivElement,
  libraryContent: $("library-content") as HTMLDivElement,
  libraryTitle: $("library-title") as HTMLHeadingElement,
  btnCloseLibrary: $("btn-close-library") as HTMLButtonElement,
  cfopModal: $("cfop-modal") as HTMLDivElement,
  btnCloseCfop: $("btn-close-cfop") as HTMLButtonElement,
  agentModal: $("agent-modal") as HTMLDivElement,
  btnOpenAgent: $("btn-open-agent") as HTMLButtonElement,
  btnCloseAgent: $("btn-close-agent") as HTMLButtonElement,
  analysisCount: $("analysis-count") as HTMLInputElement,
  analysisSampleStatus: $("analysis-sample-status"),
  btnRunAnalysis: $("btn-run-analysis") as HTMLButtonElement,
  practiceBanner: $("practice-banner") as HTMLDivElement,
  practiceInfo: $("practice-info") as HTMLSpanElement,
  practiceFeedback: $("practice-feedback") as HTMLElement,
  btnRetryPractice: $("btn-retry-practice") as HTMLButtonElement,
  btnEndPractice: $("btn-end-practice") as HTMLButtonElement,
  practiceModal: $("practice-modal") as HTMLDivElement,
  practiceFormulaName: $("practice-formula-name") as HTMLElement,
  practiceCount: $("practice-count") as HTMLInputElement,
  btnStartPractice: $("btn-start-practice") as HTMLButtonElement,
  btnCancelPractice: $("btn-cancel-practice") as HTMLButtonElement,
  btnClosePractice: $("btn-close-practice") as HTMLButtonElement,
  blockPracticeStats: $("block-practice-stats") as HTMLDivElement,
};

// ====== 状态 ======
const timer = new Timer();
let appSettings = loadAppSettings(localStorage);
const cubeVisualizer = new CubeVisualizer(els.cube3d);
let analysisPreviewPlayers: SolveReplayPlayer[] = [];
let currentScramble = "";
let scrambleProgress: ScrambleProgress = createScrambleProgress("");
let performedScrambleMoves: string[] = [];
let scrambleStateVerified = false;
const historyStore = HistoryStore.load();
let recentSolves: AnalysisInput[] = historyStore.all;
const GAN_MAC_KEY = "cubemind:gan-mac";
const MOYU_MAC_KEY = "cubemind:moyu-mac";
const FORMULA_MASTERED_KEY = "cubemind:formula-mastered";
const SCORE_DISPLAY_MODE_KEY = "cubemind:score-display-mode";
const REVIEW_THRESHOLD_KEY = "cubemind:review-threshold";
const HISTORY_GROUPS_KEY = "cubemind:history-groups";

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
const SYSTEM_HISTORY_GROUP_IDS = new Set<string>(SYSTEM_HISTORY_GROUPS.map((group) => group.id));

let historyGroups: HistoryGroup[] = [];
let selectedHistoryGroup = "normal";
let blockPracticeMode: "cross" | "f2l" | "cross-f2l" | null = null;
let blockPracticeCompleted = false;

interface FormulaLibraryState {
  category: FormulaCategory;
  search: string;
  difficulty: number | null;
  tag: string;
  hideMastered: boolean;
}

const libraryState: FormulaLibraryState = {
  category: "F2L",
  search: "",
  difficulty: null,
  tag: "",
  hideMastered: false,
};

let masteredFormulaIds = new Set<string>();
const selectedFormulaVariants = new Map<string, number>();
const speedCubeDbVariants = new Map<string, string[][]>();
let isLoadingSpeedCubeDbVariants = false;
let hasLoadedSpeedCubeDbVariants = false;
let currentBottleneck: string = ""; // 用于公式库推荐
let pendingPracticeFormula: Formula | null = null;
let pendingPracticeCandidates: Formula[] = [];
type FormulaPracticeOrder = "random" | "sequential";
let pendingPracticeOrder: FormulaPracticeOrder = "random";
interface FormulaPracticeSession {
  formula: Formula;
  candidates: Formula[];
  order: FormulaPracticeOrder;
  target: number;
  completed: number;
  startedAt: number;
  lastFeedback: string | null;
}
let practiceSession: FormulaPracticeSession | null = null;
let practiceNeedsRetry = false;
let awaitingNextScramble = false;
let postSolveMove: string | null = null;
let selectedHistoryIndex: number | null = null;
let currentSolveEvents: CubeMove[] = [];
let isFinalizingSolve = false;
let lastDeviceMoveCnt: number | undefined;
let inspectionMode: "idle" | "limited" | "free" | "ready" = "idle";
let inspectionEndsAt = 0;
let inspectionInterval: number | null = null;
let inspectionStartedAt = 0;
let pendingInspectionPenalty: InspectionPenalty = "none";
const historyDetailController = new HistoryDetailController({
  detail: els.historyDetail,
  retryButton: els.btnRetryHistory,
  solutionButton: els.btnViewHistorySolution,
}, () => isDetailedScoreMode());

// ====== 日志 ======
function log(msg: string, type: "info" | "move" | "error" = "info"): void {
  const time = new Date().toLocaleTimeString();
  const line = document.createElement("div");
  line.className = `log-line ${type}`;
  line.textContent = `[${time}] ${msg}`;
  els.log.appendChild(line);
  els.log.scrollTop = els.log.scrollHeight;
}

function applyAppSettings(settings: AppSettings): void {
  appSettings = normalizeAppSettings(settings);
  document.body.dataset.uiTheme = appSettings.theme;
  els.settingCrossSteps.value = String(appSettings.crossMaxSteps);
  els.settingInspectionEnabled.checked = appSettings.inspectionEnabled;
  els.settingInspectionSeconds.value = String(appSettings.inspectionSeconds);
  els.settingInspectionSeconds.disabled = !appSettings.inspectionEnabled;
  els.settingTheme.value = appSettings.theme;
}

function openSettings(): void {
  applyAppSettings(appSettings);
  els.settingsModal.classList.add("open");
}

function saveSettings(): void {
  const settings = normalizeAppSettings({
    crossMaxSteps: Number(els.settingCrossSteps.value),
    inspectionEnabled: els.settingInspectionEnabled.checked,
    inspectionSeconds: Number(els.settingInspectionSeconds.value),
    theme: els.settingTheme.value as AppSettings["theme"],
  });
  saveAppSettings(localStorage, settings);
  applyAppSettings(settings);
  els.settingsModal.classList.remove("open");
  log(`设置已保存：十字 ${settings.crossMaxSteps} 步，${settings.inspectionEnabled ? `${settings.inspectionSeconds} 秒观察` : "关闭正常观察"}`);
}

// ====== 打乱 ======
function newScramble(): void {
  if (practiceSession) {
    preparePracticeScramble();
    return;
  }
  currentScramble = scramble333(20);
  scrambleProgress = createScrambleProgress(currentScramble);
  performedScrambleMoves = [];
  scrambleStateVerified = false;
  awaitingNextScramble = false;
  postSolveMove = null;
  timer.reset();
  endInspection();
  stopTimerDisplay();
  updateTimerDisplay();
  // 新一把打乱默认从已还原状态开始，避免 3D 状态与当前打乱脱节。
  cubeVisualizer.reset();
  els.btnStart.disabled = true;
  els.btnStop.disabled = true;
  showScrambleStage();
  renderScrambleProgress();
  void sendDiagnosticEvent({ kind: "scramble", occurredAt: Date.now(), scramble: currentScramble, mode: "normal" });
  log(`生成打乱: ${currentScramble.slice(0, 40)}...`);
}

function prepareBlockScramble(mode: "cross" | "f2l" | "cross-f2l"): void {
  blockPracticeMode = mode;
  blockPracticeCompleted = false;
  const baseScramble = scramble333(20);
  const setupMoves = mode === "f2l" ? solveCross(baseScramble, "U") : [];
  currentScramble = [...baseScramble.split(" "), ...setupMoves].join(" ");
  scrambleProgress = createScrambleProgress(currentScramble);
  performedScrambleMoves = [];
  scrambleStateVerified = false;
  awaitingNextScramble = false;
  postSolveMove = null;
  timer.reset();
  endInspection();
  stopTimerDisplay();
  updateTimerDisplay();
  cubeVisualizer.reset();
  els.btnStart.disabled = true;
  els.btnStop.disabled = true;
  showScrambleStage();
  renderScrambleProgress();
  void sendDiagnosticEvent({ kind: "scramble", occurredAt: Date.now(), scramble: currentScramble, mode });
  log(mode === "cross" ? "已生成白面朝下 Cross 专项练习" : mode === "f2l" ? "已生成白色十字完成的 F2L 练习" : "已生成 Cross + F2L 练习");
}

function preparePracticeScramble(): void {
  if (!practiceSession) return;
  currentScramble = getFormulaSetupMoves(practiceSession.formula).join(" ");
  scrambleProgress = createScrambleProgress(currentScramble);
  performedScrambleMoves = [];
  scrambleStateVerified = false;
  awaitingNextScramble = false;
  postSolveMove = null;
  timer.reset();
  endInspection();
  stopTimerDisplay();
  updateTimerDisplay();
  els.btnStart.disabled = true;
  els.btnStop.disabled = true;
  cubeVisualizer.reset();
  practiceNeedsRetry = false;
  showScrambleStage();
  renderScrambleProgress();
  void sendDiagnosticEvent({ kind: "scramble", occurredAt: Date.now(), scramble: currentScramble, mode: "formula", formulaId: practiceSession.formula.id });
  updatePracticeBanner();
}

function startPractice(formula: Formula, target: number, candidates: Formula[], order: FormulaPracticeOrder): void {
  practiceSession = { formula, candidates, order, target, completed: 0, startedAt: Date.now(), lastFeedback: null };
  pendingPracticeFormula = null;
  pendingPracticeCandidates = [];
  els.practiceModal.classList.remove("open");
  els.libraryModal.classList.remove("open");
  closeResultModals();
  preparePracticeScramble();
  window.scrollTo({ top: 0, behavior: "smooth" });
  log(`开始专项练习：${formula.id}，目标 ${target} 次`);
}

function completePracticeAttempt(): boolean {
  if (!practiceSession) return false;
  practiceSession.completed++;
  if (practiceSession.completed >= practiceSession.target) {
    log(`专项练习完成：${practiceSession.formula.id}，共 ${practiceSession.target} 次`);
    finishPractice(true);
    return true;
  }
  if (practiceSession.order === "sequential") {
    practiceSession.formula = practiceSession.candidates[practiceSession.completed % practiceSession.candidates.length];
  } else {
    practiceSession.formula = selectPracticeFormula(practiceSession.candidates, getPracticeRecords()) ?? practiceSession.formula;
  }
  log(`完成第 ${practiceSession.completed} 次，准备下一次`);
  preparePracticeScramble();
  return true;
}

function finishPractice(completed = false): void {
  if (completed && practiceSession) renderPracticeCompletion(practiceSession);
  practiceSession = null;
  endInspection();
  els.practiceBanner.hidden = true;
  awaitingNextScramble = false;
  postSolveMove = null;
  timer.reset();
  stopTimerDisplay();
  updateTimerDisplay();
  showScrambleStage();
}

function renderPracticeCompletion(session: FormulaPracticeSession): void {
  const records = recentSolves.filter((solve) => solve.practiceKind === "formula" && (solve.completedAt ?? 0) >= session.startedAt);
  const successes = records.filter((solve) => solve.practiceOutcome === "success");
  const average = successes.length === 0
    ? null
    : successes.reduce((sum, solve) => sum + solve.totalDuration, 0) / successes.length;
  const successRate = records.length === 0 ? 0 : successes.length / records.length;
  els.resultNextAction.innerHTML = `
    <div class="result-action-card practice-complete-card" aria-live="polite">
      <span>本轮训练完成</span>
      <strong>${session.target} 题已完成</strong>
      <p>成功 ${successes.length}/${records.length} · 成功率 ${(successRate * 100).toFixed(0)}% · 平均用时 ${formatPracticeTime(average)}</p>
    </div>
  `;
}

function updatePracticeBanner(): void {
  if (!practiceSession) {
    els.practiceBanner.hidden = true;
    return;
  }
  els.practiceBanner.hidden = false;
  const next = practiceSession.completed + 1;
  els.practiceInfo.textContent = practiceNeedsRetry
    ? `专项练习 ${practiceSession.formula.id}：本次未还原，请重新开始`
    : `专项练习 ${practiceSession.formula.id} · ${practiceSession.formula.name}：第 ${next} / ${practiceSession.target} 次`;
  els.practiceFeedback.hidden = !practiceSession.lastFeedback;
  els.practiceFeedback.textContent = practiceSession.lastFeedback ?? "";
  els.btnRetryPractice.hidden = !practiceNeedsRetry;
}

function getMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function updateFormulaPracticeFeedback(input: AnalysisInput, succeeded: boolean): void {
  if (!practiceSession) return;
  if (!succeeded) {
    practiceSession.lastFeedback = "本次未完成：先重做同一 case，保持起手观察和执行节奏。";
    return;
  }
  const priorDurations = recentSolves
    .filter((solve) => solve !== input && solve.practiceKind === "formula" && solve.practiceFormulaId === input.practiceFormulaId && solve.practiceOutcome === "success")
    .map((solve) => solve.totalDuration);
  const median = getMedian(priorDurations);
  const recognition = formatPracticeTime(input.recognitionDuration ?? null);
  const execution = formatPracticeTime(input.executionDuration ?? null);
  const comparison = median === null
    ? "这是该 case 的首个有效样本"
    : input.totalDuration < median
      ? `比个人中位数快 ${((median - input.totalDuration) / 1000).toFixed(2)}s`
      : `比个人中位数慢 ${((input.totalDuration - median) / 1000).toFixed(2)}s`;
  practiceSession.lastFeedback = `上题：识别 ${recognition} · 执行 ${execution} · ${comparison}`;
}

function getPracticeRecords(): PracticeRecord[] {
  return recentSolves.flatMap((solve) => {
    if (!solve.practiceKind || !solve.practiceOutcome) return [];
    return [{
      practiceKind: solve.practiceKind,
      formulaId: solve.practiceFormulaId,
      duration: solve.totalDuration,
      outcome: solve.practiceOutcome,
      recognitionDuration: solve.recognitionDuration,
      executionDuration: solve.executionDuration,
      completedAt: solve.completedAt,
    }];
  });
}

function formatPracticeTime(value: number | null): string {
  return value === null ? "—" : `${(value / 1000).toFixed(2)}s`;
}

function isDeviceExecutableFormula(formula: Formula): boolean {
  return isFormulaDevicePracticeSafe(formula);
}

function renderBlockPracticeStats(): void {
  const records = getPracticeRecords();
  const cross = getPracticeSummary(records, "cross");
  const f2l = getPracticeSummary(records, "f2l");
  const crossF2l = getPracticeSummary(records, "cross-f2l");
  const crossSolves = recentSolves.filter((solve) => solve.practiceKind === "cross" && solve.practiceOutcome === "success");
  const mean = (values: number[]): number | null => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  const crossSteps = mean(crossSolves.flatMap((solve) => typeof solve.crossPracticeSteps === "number" ? [solve.crossPracticeSteps] : []));
  const crossPauses = mean(crossSolves.flatMap((solve) => typeof solve.crossPracticePauses === "number" ? [solve.crossPracticePauses] : []));
  const crossTps = mean(crossSolves.flatMap((solve) => typeof solve.crossPracticeTps === "number" ? [solve.crossPracticeTps] : []));
  const render = (label: string, summary: ReturnType<typeof getPracticeSummary>): string =>
    `<div><strong>${label}</strong><span>${summary.successes}/${summary.attempts} 成功 · ${(summary.successRate * 100).toFixed(0)}%</span><span>均值 ${formatPracticeTime(summary.averageDuration)} · AO5 ${summary.ao5} · AO12 ${summary.ao12}</span></div>`;
  const crossDetails = crossSteps === null
    ? "暂无动作指标"
    : `平均 ${crossSteps.toFixed(1)} 步 · 停顿 ${crossPauses?.toFixed(1) ?? "—"} 次 · ${crossTps?.toFixed(2) ?? "—"} TPS`;
  els.blockPracticeStats.innerHTML = `${render("Cross", cross).replace("</div>", `<span>${crossDetails}</span></div>`)}${render("F2L", f2l)}${render("Cross + F2L", crossF2l)}`;
}

function renderScrambleProgress(): void {
  const remaining = scrambleProgress.remaining.map(
    (move, index) => `<span class="scramble-move ${index === 0 ? "next" : ""}">${escapeHtml(move)}</span>`
  );
  // 打乱区只展示尚待执行的一组步骤，避免已执行步骤与完整打乱混在一起而看似出现第二条打乱。
  els.scrambleText.innerHTML = remaining.join(" ");
}

function showScrambleStage(): void {
  els.scrambleStage.hidden = false;
  els.timerStage.hidden = true;
}

function isPracticeObservation(): boolean {
  return practiceSession !== null || blockPracticeMode !== null;
}

function beginInspection(): void {
  showTimerStage();
  els.btnStart.disabled = true;
  pendingInspectionPenalty = "none";
  inspectionStartedAt = 0;
  if (isPracticeObservation()) {
    inspectionMode = "free";
    inspectionEndsAt = 0;
    els.inspectionStatus.hidden = false;
    els.inspectionStatus.textContent = "自由观察 · 转动第一步后开始计时";
    els.timerDisplay.textContent = "观察";
    log("进入练习自由观察：转动第一步开始计时");
    return;
  }
  if (!appSettings.inspectionEnabled || appSettings.inspectionSeconds === 0) {
    inspectionMode = "ready";
    els.inspectionStatus.hidden = false;
    els.inspectionStatus.textContent = "准备就绪 · 转动第一步后开始计时";
    els.timerDisplay.textContent = "0.00s";
    log("打乱完成：转动第一步开始计时");
    return;
  }
  inspectionMode = "limited";
  inspectionStartedAt = Date.now();
  inspectionEndsAt = inspectionStartedAt + appSettings.inspectionSeconds * 1000;
  renderInspectionCountdown();
  inspectionInterval = window.setInterval(renderInspectionCountdown, 50);
  log(`进入 ${appSettings.inspectionSeconds} 秒观察：转动第一步开始计时`);
}

function renderInspectionCountdown(): void {
  if (inspectionMode !== "limited") return;
  const outcome = getInspectionOutcome(Date.now() - inspectionStartedAt, appSettings.inspectionSeconds);
  els.inspectionStatus.hidden = false;
  els.inspectionStatus.textContent = `观察 ${outcome.display} · 转动第一步后开始计时`;
  els.timerDisplay.textContent = outcome.display;
}

function stopInspectionCountdown(): void {
  if (inspectionInterval !== null) {
    clearInterval(inspectionInterval);
    inspectionInterval = null;
  }
}

function endInspection(): void {
  stopInspectionCountdown();
  inspectionMode = "idle";
  inspectionEndsAt = 0;
  inspectionStartedAt = 0;
  els.inspectionStatus.hidden = true;
  els.inspectionStatus.textContent = "";
}

function showTimerStage(): void {
  els.scrambleStage.hidden = true;
  els.timerStage.hidden = false;
}

function resetSessionForSyncedCube(): void {
  timer.reset();
  lastDeviceMoveCnt = undefined;
  stopTimerDisplay();
  updateTimerDisplay();
  els.btnStart.disabled = false;
  els.btnStop.disabled = true;
  cubeVisualizer.reset();
  newScramble();
}

function confirmCubeResetAfterConnect(deviceLabel: string): void {
  const shouldReset = window.confirm(
    `${deviceLabel} 已连接。\n\n请先把实体智能魔方复原到已还原状态。\n点击“确定”后，CubeMind 会把 3D 魔方重置为已还原并生成新打乱。`
  );

  if (shouldReset) {
    resetSessionForSyncedCube();
    log(`${deviceLabel} 已按还原状态同步 3D 魔方`);
  } else {
    log(`${deviceLabel} 未重置，实体魔方和 3D 魔方可能不同步`, "error");
    newScramble();
  }
}

function updateScrambleProgress(move: string): void {
  if (timer.getState().isRunning || scrambleProgress.remaining.length === 0) return;

  const expected = scrambleProgress.remaining[0];
  scrambleProgress = applyScrambleMove(scrambleProgress, move);
  renderScrambleProgress();

  if (scrambleProgress.lastMoveCorrect === true && scrambleProgress.remaining.length === 0) {
    beginInspection();
  } else if (scrambleProgress.lastMoveCorrect === false) {
    log(`打乱转错：期望 ${expected}，已加入纠错步`, "error");
  }
}

function verifyCompletedScramble(): void {
  scrambleStateVerified = isScrambleStateVerified(scrambleProgress.completed, performedScrambleMoves);
  if (scrambleStateVerified) {
    log("打乱状态已核验，可转动第一步开始计时");
    return;
  }
  log("打乱最终状态与目标不一致：请将实体魔方复原后重新生成打乱，本把不会开始计时", "error");
}
els.btnScramble.onclick = newScramble;
els.btnSolveCross.onclick = () => {
  if (!currentScramble) {
    els.crossSolution.hidden = false;
    els.crossSolution.textContent = "请先生成打乱。";
    return;
  }
  els.btnSolveCross.disabled = true;
  els.crossSolution.hidden = false;
  els.crossSolution.textContent = "正在计算十字解法…";
  window.setTimeout(() => {
    try {
      const targetFace = "U";
      const solution = solveCross(currentScramble, targetFace, appSettings.crossMaxSteps);
      const displaySolution = convertSolutionForWhiteDown(solution, "F");
      const difficulty = solution.length <= 4 ? "简单" : solution.length <= 6 ? "中等" : "困难";
      els.crossSolution.innerHTML = solution.length > 0
        ? `白色 Cross（绿面前）：<code>${escapeHtml(displaySolution.join(" "))}</code>（${solution.length} 步，${difficulty}）`
        : `未在 ${appSettings.crossMaxSteps} 步搜索范围内找到十字解法。`;
    } catch (error) {
      console.error("[cross-solver] 求解失败:", error);
      els.crossSolution.textContent = "十字求解失败，请重新生成打乱。";
    } finally {
      els.btnSolveCross.disabled = false;
    }
  }, 0);
};
els.btnSolveXCross.onclick = () => {
  if (!currentScramble) {
    els.xcrossSolution.hidden = false;
    els.xcrossSolution.textContent = "请先生成打乱。";
    return;
  }
  const targetFace = "U";
  els.btnSolveXCross.disabled = true;
  els.xcrossSolution.hidden = false;
  els.xcrossSolution.innerHTML = "正在比较四个 X-Cross 槽位…";
  window.setTimeout(() => {
    try {
      const colorNames: Record<string, string> = { U: "白", R: "红", F: "绿", D: "黄", L: "橙", B: "蓝" };
      const slotNames: Record<string, Record<string, string>> = {
        D: { F: "绿-红", R: "红-蓝", B: "蓝-橙", L: "橙-绿" },
        U: { F: "绿-橙", R: "红-绿", B: "蓝-红", L: "橙-蓝" },
      };
      const frontOrder = ["R", "B", "L", "F"];
      const holdOrder = ["F", "R", "B", "L"];
      const holdNames: Record<string, string> = {
        F: "白底绿前",
        R: "白底红前",
        B: "白底蓝前",
        L: "白底橙前",
      };
      const candidates = frontOrder.map((frontFace) => ({
        frontFace,
        solution: solveXCross(currentScramble, targetFace, frontFace),
      }));
      const best = [...candidates].filter((item) => item.solution.length > 0)
        .sort((a, b) => a.solution.length - b.solution.length)[0];
      const bestPair = best ? (slotNames[targetFace]?.[best.frontFace] ?? `${colorNames[targetFace]}-${colorNames[best.frontFace]}`) : "未找到";
      const heading = best
        ? `<div class="xcross-recommendation"><strong>推荐：${bestPair} X-Cross</strong><span>${best.solution.length} 步，优先做${bestPair}槽</span></div>`
        : `<div class="xcross-recommendation"><strong>暂未找到 X-Cross</strong><span>可尝试更短的打乱或普通 Cross</span></div>`;
      const candidateSummary = candidates.map(({ frontFace, solution }) => {
        const slotName = slotNames[targetFace]?.[frontFace] ?? `${colorNames[targetFace]}-${colorNames[frontFace]}`;
        return `${slotName}${solution.length > 0 ? ` ${solution.length}步` : " 未找到"}`;
      }).join(" · ");
      const rows = best
        ? holdOrder.map((holdFace) => {
          const formula = convertSolutionForWhiteDown(best.solution, holdFace).join(" ");
          return `<div class="xcross-row"><strong>${holdNames[holdFace]}</strong><code>${formula}</code><span>${best.solution.length} 步</span></div>`;
        })
        : [];
      els.xcrossSolution.innerHTML = heading
        + (rows.length > 0 ? `<div class="xcross-directions">${rows.join("")}</div>` : "")
        + `<div class="xcross-meta">后台比较：${candidateSummary}</div>`;
    } catch (error) {
      console.error("[cross-solver] X-Cross 求解失败:", error);
      els.xcrossSolution.textContent = "X-Cross 求解失败，请重新生成打乱。";
    } finally {
      els.btnSolveXCross.disabled = false;
    }
  }, 0);
};
els.scoreDisplayMode.value = localStorage.getItem(SCORE_DISPLAY_MODE_KEY) === "detailed" ? "detailed" : "simple";
const savedReviewThreshold = Number(localStorage.getItem(REVIEW_THRESHOLD_KEY));
if (Number.isFinite(savedReviewThreshold) && savedReviewThreshold >= 0) {
  els.reviewThreshold.value = String(savedReviewThreshold);
}
els.scoreDisplayMode.onchange = () => {
  localStorage.setItem(SCORE_DISPLAY_MODE_KEY, els.scoreDisplayMode.value);
  renderHistory();
  if (selectedHistoryIndex !== null && recentSolves[selectedHistoryIndex]) {
    renderHistoryDetail(recentSolves[selectedHistoryIndex], false);
  }
};
els.reviewThreshold.onchange = () => {
  localStorage.setItem(REVIEW_THRESHOLD_KEY, els.reviewThreshold.value);
  renderReviewCandidates();
};
els.btnRefreshReview.onclick = () => {
  localStorage.setItem(REVIEW_THRESHOLD_KEY, els.reviewThreshold.value);
  renderReviewCandidates();
};
els.historyGroup.onchange = () => {
  selectedHistoryGroup = els.historyGroup.value;
  renderHistory();
};
els.btnNewHistoryGroup.onclick = () => {
  const name = window.prompt("请输入历史分组名称");
  if (!name?.trim()) return;
  const group: HistoryGroup = { id: `group-${Date.now()}`, name: name.trim(), createdAt: Date.now() };
  historyGroups.push(group);
  selectedHistoryGroup = group.id;
  saveHistoryGroups();
  renderHistory();
};
els.btnDeleteHistoryGroup.onclick = () => {
  if (SYSTEM_HISTORY_GROUP_IDS.has(selectedHistoryGroup)) return;
  const group = historyGroups.find((item) => item.id === selectedHistoryGroup);
  if (!group || !window.confirm(`删除分组“${group.name}”？其中的成绩会保留，但移到未分组。`)) return;
  recentSolves.forEach((solve) => {
    if (solve.groupId === group.id) delete solve.groupId;
  });
  historyGroups = historyGroups.filter((item) => item.id !== group.id);
  selectedHistoryGroup = "normal";
  saveHistoryGroups();
  historyStore.save();
  renderHistory();
};

function downloadHistory(content: string, filename: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

els.btnExportHistoryJson.onclick = () => {
  downloadHistory(formatHistoryJson(recentSolves), "cubemind-history.json", "application/json;charset=utf-8");
  log(`已导出 ${recentSolves.length} 条历史记录（JSON）`);
};
els.btnExportHistoryCsv.onclick = () => {
  downloadHistory(formatHistoryCsv(recentSolves), "cubemind-history.csv", "text/csv;charset=utf-8");
  log(`已导出 ${recentSolves.length} 条历史记录（CSV）`);
};
els.btnOpenLibrary.onclick = () => showLibrary(libraryState.category);

function startDailyPractice(): void {
  const candidates = (["F2L", "OLL", "PLL"] as FormulaCategory[])
    .flatMap((category) => listByCategory(category))
    .filter(isDeviceExecutableFormula)
    .sort((a, b) => a.id.localeCompare(b.id));
  const formula = selectPracticeFormula(candidates, getPracticeRecords());
  if (!formula) {
    log("今日训练没有可用于智能魔方的公式", "error");
    return;
  }
  els.practiceModeModal.classList.remove("open");
  startPractice(formula, 10, candidates, "random");
  log(`开始今日智能训练：${formula.id}，共 10 题`);
}

function openCategoryPractice(category: "OLL" | "PLL" | "OLL-PLL"): void {
  const allFormulas = category === "OLL-PLL"
    ? [...listByCategory("OLL"), ...listByCategory("PLL")]
    : listByCategory(category);
  const maxDifficulty = Number(els.formulaPracticeDifficulty.value);
  const onlyUnmastered = els.formulaPracticeUnmastered.checked;
  const formulas = allFormulas.filter((formula) =>
    formula.difficulty <= maxDifficulty
    && (!onlyUnmastered || !masteredFormulaIds.has(formula.id))
    && isDeviceExecutableFormula(formula));
  const order = els.formulaPracticeOrder.value as FormulaPracticeOrder;
  const sorted = [...formulas].sort((a, b) => a.id.localeCompare(b.id));
  const formula = order === "sequential" ? sorted[0] : selectPracticeFormula(sorted, getPracticeRecords());
  if (formulas.length === 0) {
    log("没有符合当前筛选且适合智能魔方记录的公式", "error");
    return;
  }
  if (!formula) return;
  pendingPracticeFormula = formula;
  pendingPracticeCandidates = sorted;
  pendingPracticeOrder = order;
  els.practiceModeModal.classList.remove("open");
  els.practiceFormulaName.textContent = `${formula.id} · ${getFormulaDisplayName(formula)}（${order === "random" ? "智能随机" : "顺序"}，${sorted.length} 个公式）`;
  els.practiceModal.classList.add("open");
  log(`准备${category === "OLL-PLL" ? "OLL + PLL" : category} 练习：${formula.id}`);
}
els.btnOpenPracticeMode.onclick = () => {
  renderBlockPracticeStats();
  els.practiceModeModal.classList.add("open");
};
els.btnClosePracticeMode.onclick = () => els.practiceModeModal.classList.remove("open");
els.btnStartDailyPractice.onclick = startDailyPractice;
els.practiceModeModal.querySelectorAll<HTMLButtonElement>("[data-practice-mode]").forEach((button) => {
  button.onclick = () => openCategoryPractice(button.dataset.practiceMode as "OLL" | "PLL" | "OLL-PLL");
});
els.practiceModeModal.querySelectorAll<HTMLButtonElement>("[data-block-practice-mode]").forEach((button) => {
  button.onclick = () => {
    const mode = button.dataset.blockPracticeMode as "cross" | "f2l" | "cross-f2l" | undefined;
    if (!mode) return;
    els.practiceModeModal.classList.remove("open");
    prepareBlockScramble(mode);
  };
});

// ====== 计时器 UI ======
function updateTimerDisplay(): void {
  const ms = timer.getDuration();
  const sec = (ms / 1000).toFixed(2);
  els.timerDisplay.textContent = `${sec}s`;
}

let displayInterval: number | null = null;
function startTimerDisplay(): void {
  if (displayInterval) return;
  displayInterval = window.setInterval(updateTimerDisplay, 50);
}
function stopTimerDisplay(): void {
  if (displayInterval) {
    clearInterval(displayInterval);
    displayInterval = null;
  }
}

function startSolveTimer(fromMove = false): void {
  if (timer.getState().isRunning) return;
  if (scrambleProgress.remaining.length > 0) {
    log("请先按提示完成打乱，再开始计时", "error");
    return;
  }
  if (!scrambleStateVerified) {
    log("打乱状态未通过核验，请复原实体魔方后重新生成打乱", "error");
    return;
  }
  if (!fromMove) {
    log("请通过转动第一步开始计时", "error");
    return;
  }
  if (inspectionMode === "limited" && inspectionStartedAt > 0) {
    const outcome = getInspectionOutcome(Date.now() - inspectionStartedAt, appSettings.inspectionSeconds);
    pendingInspectionPenalty = outcome.penalty;
    if (outcome.penalty === "plus2") log("观察超时：本把成绩将加 2 秒", "error");
    if (outcome.penalty === "dnf") log("观察超过 DNF 时限：本把将记录为 DNF", "error");
  }
  endInspection();
  timer.start();
  currentSolveEvents = [];
  lastDeviceMoveCnt = undefined;
  els.btnStart.disabled = true;
  els.btnStop.disabled = false;
  startTimerDisplay();
  log("Timer started");
}

async function stopSolveTimerAndAnalyze(waitForLateMove = false): Promise<void> {
  if (!timer.getState().isRunning || isFinalizingSolve) return;
  isFinalizingSolve = true;
  const stopRequestedAt = Date.now();
  if (waitForLateMove) {
    // 蓝牙通知可能比用户按下结束键晚一个事件循环；保留极短窗口以收齐最后一步。
    await new Promise<void>((resolve) => window.setTimeout(resolve, 180));
  }
  timer.stop(stopRequestedAt);
  els.btnStart.disabled = false;
  els.btnStop.disabled = true;
  stopTimerDisplay();
  updateTimerDisplay();
  log("Timer stopped");
  try {
    await onSolveComplete();
    blockPracticeMode = null;
  } finally {
    isFinalizingSolve = false;
  }
}

els.btnStart.onclick = () => {
  startSolveTimer();
};

els.btnOpenSettings.onclick = openSettings;
els.btnCloseSettings.onclick = () => els.settingsModal.classList.remove("open");
els.btnSaveSettings.onclick = saveSettings;
els.settingInspectionEnabled.onchange = () => {
  els.settingInspectionSeconds.disabled = !els.settingInspectionEnabled.checked;
};

els.btnStop.onclick = () => {
  void stopSolveTimerAndAnalyze(true);
};

els.btnReset.onclick = () => {
  timer.reset();
  endInspection();
  blockPracticeMode = null;
  awaitingNextScramble = false;
  postSolveMove = null;
  showScrambleStage();
  updateTimerDisplay();
  els.btnStart.disabled = false;
  els.btnStop.disabled = true;
  els.cfopOutput.textContent = "（等待本次解法）";
  els.agentOutput.innerHTML = "<p class=\"placeholder\">完成一次解法后，AI 分析会显示在这里</p>";
  cubeVisualizer.reset();
  log("已重置");
};

// ====== Move 事件处理 ======
function onCubeMove(move: CubeMove): void {
  const lossWarning = findMoveLossWarning(lastDeviceMoveCnt, move.moveCnt);
  if (lossWarning) {
    log(`疑似丢步：设备计数从 ${lossWarning.previousMoveCnt} 跳到 ${lossWarning.currentMoveCnt}，中间缺 ${lossWarning.missing} 步`, "error");
  }
  if (move.moveCnt !== undefined && move.moveCnt >= 0) {
    lastDeviceMoveCnt = move.moveCnt;
  }

  cubeVisualizer.applyMove(move.move);

  if (awaitingNextScramble) {
    if (postSolveMove && invertMove(postSolveMove) === move.move) {
      log("检测到相反动作，生成下一条打乱");
      closeResultModals();
      newScramble();
    } else {
      postSolveMove = move.move;
    }
    return;
  }

  const shouldStartSolve = !timer.getState().isRunning && scrambleProgress.remaining.length === 0 && scrambleStateVerified;
  const wasCompletingScramble = scrambleProgress.remaining.length > 0;
  if (wasCompletingScramble) performedScrambleMoves.push(move.move);
  updateScrambleProgress(move.move);

  if (wasCompletingScramble && scrambleProgress.remaining.length === 0) verifyCompletedScramble();

  if (practiceSession?.formula.category === "F2L" && wasCompletingScramble && scrambleProgress.remaining.length === 0) {
    const facelets = cubeVisualizer.getFacelets();
    const match = recognizeF2lPracticeCase(facelets, practiceSession.formula) ?? recognizeF2lCase(facelets);
    if (match?.formulaId === practiceSession.formula.id) {
      log(`F2L 识别：${match.formulaId} · ${match.name}（精确匹配）`);
    } else if (match) {
      log(`F2L 起始 case 不匹配：期望 ${practiceSession.formula.id}，识别为 ${match.formulaId}`, "error");
    } else {
      log(`F2L 起始 case 未能可靠匹配：期望 ${practiceSession.formula.id}`, "error");
    }
  }

  if (shouldStartSolve) {
    startSolveTimer(true);
  }

  if (timer.getState().isRunning) {
    timer.addMove(move.move);
    currentSolveEvents.push(move);
  }
  log(`#${timer.getState().moves.length + 1} ${move.move}`, "move");

  const blockPhase = getCfopPhase(cubeVisualizer.getFacelets());
  const shouldStopCross = blockPracticeMode === "cross" && cubeVisualizer.isCrossSolved("U");
  const shouldStopBlock = (blockPracticeMode === "f2l" || blockPracticeMode === "cross-f2l") && timer.getState().moves.length > 0 && blockPhase === "f2l";
  const shouldStopFormulaF2l = practiceSession?.formula.category === "F2L" && timer.getState().moves.length > 0 && blockPhase === "f2l";
  if (timer.getState().isRunning && timer.getState().moves.length > 0 && (cubeVisualizer.isSolved() || shouldStopBlock || shouldStopCross || shouldStopFormulaF2l)) {
    if (shouldStopBlock || shouldStopCross) blockPracticeCompleted = true;
    void stopSolveTimerAndAnalyze();
  }
}

// ====== 解法完成处理 ======
async function onSolveComplete(): Promise<void> {
  const state = timer.getState();
  const isFormulaAttempt = practiceSession !== null;
  if (state.moves.length === 0) {
    log("无 move 数据，无法分析", "error");
    return;
  }

  const moveStrs = state.moves.map((m) => m.move);
  const moveTimes = state.moves.map((m) => m.timestamp);
  const validation = validateSolve(scrambleProgress.completed, currentSolveEvents);
  const prettySummary = summarizePrettyReconstruction(currentSolveEvents);
  if (prettySummary) log(prettySummary);

  log("🔍 开始 CFOP 阶段识别...");
  const cfopResult: CfopResult = parseCfop(
    moveStrs,
    moveTimes,
    scrambleProgress.completed,
    state.startTime,
    state.endTime,
  );
  const stepReview = analyzeSolveSteps(
    moveStrs,
    state.moves.map((move) => move.gapFromPrev),
    cfopResult.segments,
  );
  const f2lSlotAnalysis = analyzeF2lSlots(
    scrambleProgress.completed,
    moveStrs,
    moveTimes,
    state.moves.map((move) => move.gapFromPrev),
    state.startTime,
    stepReview.pauseThreshold,
  );
  els.cfopOutput.textContent = `总用时: ${(timer.getDuration() / 1000).toFixed(2)}s\n${formatCfop(cfopResult)}\n\n${formatF2lSlotAnalysis(f2lSlotAnalysis)}`;
  els.cfopModal.classList.add("open");
  log(`CFOP 识别完成: ${cfopResult.segments.length} 个阶段`);

  const cross = cfopResult.segments.find((s) => s.stage === "cross");
  const f2l = cfopResult.segments.find((s) => s.stage === "f2l");
  const oll = cfopResult.segments.find((s) => s.stage === "oll");
  const pll = cfopResult.segments.find((s) => s.stage === "pll");
  const previousSolve = recentSolves[recentSolves.length - 1];
  const totalDuration = timer.getDuration();
  const moveCount = state.moves.length;
  const crossMetrics = blockPracticeMode === "cross" ? calculateCrossMetrics(state.moves, totalDuration) : undefined;
  const practiceKind = practiceSession ? "formula" : blockPracticeMode ?? undefined;
  const reliableMoveStream = isMoveStreamReliable(validation);
  const finalPhase = getCfopPhase(validation.finalFacelets);
  const formulaPracticeSucceeded = reliableMoveStream && (practiceSession?.formula.category === "F2L"
    ? finalPhase === "f2l" || finalPhase === "oll" || finalPhase === "solved"
    : validation.isSolved);
  const blockPracticeSucceeded = reliableMoveStream && blockPracticeCompleted;

  const input: AnalysisInput = {
    completedAt: Date.now(),
    deviceName: els.deviceName.textContent?.trim() || "未标识魔方",
    deviceId: ganCube.getMacAddress() ?? moyuCube.getMacAddress() ?? undefined,
    groupId: !practiceKind && !SYSTEM_HISTORY_GROUP_IDS.has(selectedHistoryGroup) ? selectedHistoryGroup : undefined,
    practiceMode: blockPracticeMode ?? undefined,
    practiceKind,
    practiceFormulaId: practiceSession?.formula.id,
    practiceOutcome: practiceSession
      ? (formulaPracticeSucceeded ? "success" : "failed")
      : blockPracticeMode ? (blockPracticeSucceeded ? "success" : "failed") : undefined,
    recognitionDuration: practiceSession && state.moves[0]
      ? Math.max(0, state.moves[0].timestamp - state.startTime) : undefined,
    executionDuration: practiceSession && state.moves[0]
      ? Math.max(0, state.endTime - state.moves[0].timestamp) : undefined,
    crossPracticeSteps: crossMetrics?.steps,
    crossPracticePauses: crossMetrics?.pauses,
    crossPracticeTps: crossMetrics?.tps,
    totalDuration,
    moveCount,
    tps: totalDuration > 0 ? moveCount / (totalDuration / 1000) : 0,
    scramble: scrambleProgress.completed.join(" "),
    moves: moveStrs,
    crossDuration: cross?.duration ?? 0,
    f2lDuration: f2l?.duration ?? 0,
    ollDuration: oll?.duration ?? 0,
    pllDuration: pll?.duration ?? 0,
    crossMoves: cross?.moves.length ?? 0,
    f2lMoves: f2l?.moves.length ?? 0,
    ollMoves: oll?.moves.length ?? 0,
    pllMoves: pll?.moves.length ?? 0,
    qualityStatus: validation.status,
    qualityAnomalies: validation.anomalies,
    penalty: pendingInspectionPenalty,
    moveGaps: state.moves.map((move) => move.gapFromPrev),
    f2lSlots: f2lSlotAnalysis?.slots.map((slot) => ({
      slot: slot.slot,
      completionOrder: slot.completionOrder,
      duration: slot.duration,
      moves: slot.moves,
      pauseCount: slot.pauseCount,
      maxGap: slot.maxGap,
      breakCount: slot.breakCount,
      repairCount: slot.repairCount,
      completedWithCross: slot.completedWithCross,
    })),
    stepReview,
  };

  renderSolveSummary(input, previousSolve);
  renderStepReview(stepReview);
  recordSolve(input);
  const diagnosticMode: DiagnosticMode = practiceSession ? "formula" : blockPracticeMode ?? "normal";
  void sendDiagnosticEvent({
    kind: "solve",
    occurredAt: input.completedAt ?? Date.now(),
    scramble: input.scramble ?? scrambleProgress.completed.join(" "),
    mode: diagnosticMode,
    formulaId: practiceSession?.formula.id,
    moves: moveStrs,
    totalDuration: input.totalDuration,
    qualityStatus: input.qualityStatus,
    qualityAnomalies: input.qualityAnomalies,
  });
  if (practiceSession) {
    if (formulaPracticeSucceeded) {
      updateFormulaPracticeFeedback(input, true);
      completePracticeAttempt();
    } else {
      practiceNeedsRetry = true;
      updateFormulaPracticeFeedback(input, false);
      updatePracticeBanner();
      log(`专项练习失败：${practiceSession.formula.id}，可重新开始本次`, "error");
    }
  }
  if (validation.isSolved && reliableMoveStream) {
    log("状态回放确认已还原；成绩可用于 AO 与 AI");
  } else if (formulaPracticeSucceeded || blockPracticeSucceeded) {
    log("状态回放确认专项目标完成；已仅计入专项统计");
  } else {
    log(`成绩已保存但未通过状态校验：${validation.anomalies.join("、")}`, "error");
  }
  awaitingNextScramble = !isFormulaAttempt;
  postSolveMove = null;

  log("成绩已保存；点击右下角 AI 可按需分析历史成绩");
}

function renderStepReview(review: SolveReview): void {
  if (review.pauses.length === 0) {
    els.agentOutput.innerHTML = '<p class="placeholder">本次没有发现明显长停顿，继续保持节奏。</p>';
    return;
  }
  const pauses = review.pauses.map((pause) =>
    `<li><strong>#${pause.index + 1} ${escapeHtml(pause.move)}</strong> · ${escapeHtml(pause.stage)} · 间隔 ${(pause.gap / 1000).toFixed(2)}s</li>`
  ).join("");
  els.agentOutput.innerHTML = `
    <div class="analysis-card">
      <div class="analysis-item bottleneck">
        <div class="label">逐步复盘：长停顿</div>
        <div class="value">平均间隔 ${(review.averageGap / 1000).toFixed(2)}s，最长 ${(review.maxGap / 1000).toFixed(2)}s</div>
      </div>
      <div class="analysis-item advice"><ul>${pauses}</ul></div>
      <p class="placeholder">点击右下角 AI，可基于这些停顿和最近历史生成训练建议。</p>
    </div>
  `;
}

function renderAgentResult(result: AnalysisResult, input: AnalysisInput): void {
  currentBottleneck = extractBottleneck(result.bottleneck);
  analysisPreviewPlayers.forEach((player) => player.destroy());
  analysisPreviewPlayers = [];
  const scrambleMoves = input.scramble?.trim().split(/\s+/).filter(Boolean) ?? [];
  const solutionMoves = input.moves ?? [];
  const hasReplay = scrambleMoves.length > 0 && solutionMoves.length > 0;
  els.agentOutput.innerHTML = `
    <div class="analysis-card">
      <div class="analysis-item bottleneck">
        <div class="label">🎯 瓶颈识别</div>
        <div class="value">${escapeHtml(result.bottleneck)}</div>
      </div>
      <div class="analysis-item advice">
        <div class="label">📋 训练建议</div>
        <div class="value">${escapeHtml(result.trainingAdvice)}</div>
      </div>
      <div class="analysis-item encourage">
        <div class="label">💪 鼓励</div>
        <div class="value">${escapeHtml(result.encouragement)}</div>
      </div>
      <div class="analysis-item practice-link">
        <button id="btn-practice" class="practice-btn">📖 跳转到公式库练习</button>
      </div>
      <section class="analysis-replay" aria-label="本次 3D 解法预览">
        <div class="analysis-replay-head">
          <div><span>AI 解法洞察</span><strong>最近一把的 3D 动作预览</strong></div>
          <em>${hasReplay ? "拖拽魔方调整视角" : "本次记录缺少动作数据"}</em>
        </div>
        <div class="analysis-replay-grid" ${hasReplay ? "" : "hidden"}>
          <article class="analysis-replay-card">
            <div class="analysis-replay-label"><span>打乱</span><small>从复原状态执行</small></div>
            <code>${escapeHtml(input.scramble ?? "")}</code>
            <div data-analysis-scramble-preview></div>
          </article>
          <article class="analysis-replay-card">
            <div class="analysis-replay-label"><span>完整解法</span><small>从打乱状态还原</small></div>
            <code>${escapeHtml(solutionMoves.join(" "))}</code>
            <div data-analysis-solution-preview></div>
          </article>
        </div>
      </section>
    </div>
  `;

  if (hasReplay) {
    const scramblePreview = els.agentOutput.querySelector<HTMLElement>("[data-analysis-scramble-preview]");
    const solutionPreview = els.agentOutput.querySelector<HTMLElement>("[data-analysis-solution-preview]");
    if (scramblePreview) analysisPreviewPlayers.push(new SolveReplayPlayer(scramblePreview, "", scrambleMoves, { title: "打乱 · 3D 预览", emphasizeChanges: true }));
    if (solutionPreview) analysisPreviewPlayers.push(new SolveReplayPlayer(solutionPreview, input.scramble ?? "", solutionMoves, { title: "完整解法 · 3D 演示", emphasizeChanges: true }));
  }

  // 绑定跳转按钮
  document.getElementById("btn-practice")?.addEventListener("click", () => {
    openLibraryForBottleneck(currentBottleneck, input);
  });

  log(`AI 分析完成：最近 ${input.analysisScope ?? 1} 把；${result.bottleneck}`);
}

/** 从 bottleneck 字符串中提取阶段名 */
function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function applyGanMac(showSuccessLog: boolean): Promise<void> {
  const mac = els.ganMacInput.value.trim();
  if (!mac) {
    log("请输入 GAN MAC 地址，例如 AA:BB:CC:DD:EE:FF", "error");
    return;
  }

  try {
    await ganCube.updateMacAddress(mac);
    const normalized = ganCube.getMacAddress() ?? mac;
    els.ganMacInput.value = normalized;
    localStorage.setItem(GAN_MAC_KEY, normalized);
    if (showSuccessLog) log(`GAN MAC 已设置：${normalized}`);
  } catch (err) {
    log(`GAN MAC 无效：${formatError(err)}`, "error");
  }
}

async function applyMoyuMac(showSuccessLog: boolean): Promise<void> {
  const mac = els.moyuMacInput.value.trim();
  if (!mac) {
    log("请输入魔域 WCU MAC 地址，例如 CF:30:16:01:D1:37", "error");
    return;
  }
  try {
    await moyuCube.setMacAddress(mac);
    const normalized = moyuCube.getMacAddress() ?? mac;
    els.moyuMacInput.value = normalized;
    localStorage.setItem(MOYU_MAC_KEY, normalized);
    if (showSuccessLog) log(`魔域 MAC 已保存：${normalized}`);
  } catch (err) {
    log(`魔域 MAC 无效：${formatError(err)}`, "error");
  }
}

// ====== 公式库 ======
function openLibraryForBottleneck(bottleneck: string, input: AnalysisInput): void {
  if (!bottleneck) {
    log("瓶颈不明确，打开公式库总览", "info");
    showLibrary("F2L");
    return;
  }

  // 根据瓶颈推荐公式
  const rec = recommendFormulas(bottleneck, getStageDuration(input, bottleneck), input.totalDuration);

  els.libraryTitle.textContent = `${bottleneck} 公式练习推荐`;
  els.libraryContent.innerHTML = renderRecommendation(rec);
  bindFormulaActions();
  els.libraryModal.classList.add("open");
  log(`📖 打开公式库：${bottleneck}`);
}

function getStageDuration(input: AnalysisInput, stage: string): number {
  if (stage === "Cross") return input.crossDuration;
  if (stage === "F2L") return input.f2lDuration;
  if (stage === "OLL") return input.ollDuration;
  if (stage === "PLL") return input.pllDuration;
  return 0;
}

function renderRecommendation(rec: { reason: string; formulas: Formula[]; practicePlan: string }): string {
  return `
    <div class="recommendation">
      <div class="rec-reason">
        <strong>推荐理由：</strong>${escapeHtml(rec.reason)}
      </div>
      <div class="rec-plan">
        <strong>📅 练习计划：</strong>${escapeHtml(rec.practicePlan)}
      </div>
    </div>
    <div class="formula-list">
      ${rec.formulas.map(renderFormulaCard).join("")}
    </div>
    ${rec.formulas.length === 0 ? '<p class="placeholder">无对应公式库，参考练习计划</p>' : ''}
  `;
}

function showLibrary(category: FormulaCategory): void {
  libraryState.category = category;
  void loadSpeedCubeDbVariants();
  const stats = getLibraryStats();
  const formulas = getVisibleFormulas(category);
  const allInCategory = listByCategory(category);
  const tags = getCategoryTags(category);
  const masteredInCategory = allInCategory.filter((f) => masteredFormulaIds.has(f.id)).length;

  els.libraryTitle.textContent = `Formula Library (${stats.total})`;
  els.libraryContent.innerHTML = `
    ${renderTodayTrainingQueue()}
    <div class="library-tabs">
      <button class="tab-btn ${category === "F2L" ? "active" : ""}" data-cat="F2L">F2L (${stats.F2L})</button>
      <button class="tab-btn ${category === "OLL" ? "active" : ""}" data-cat="OLL">OLL (${stats.OLL})</button>
      <button class="tab-btn ${category === "PLL" ? "active" : ""}" data-cat="PLL">PLL (${stats.PLL})</button>
    </div>
    <div class="library-toolbar">
      <input id="formula-search" type="search" placeholder="搜索 ID、名称、公式、识别点" value="${escapeHtml(libraryState.search)}">
      <select id="formula-difficulty">
        <option value="0" ${libraryState.difficulty === null ? "selected" : ""}>全部星级</option>
        ${[1, 2, 3, 4, 5].map((level) => `
          <option value="${level}" ${libraryState.difficulty === level ? "selected" : ""}>${"★".repeat(level)}${"☆".repeat(5 - level)}</option>
        `).join("")}
      </select>
      <select id="formula-tag">
        <option value="" ${libraryState.tag === "" ? "selected" : ""}>全部标签</option>
        ${tags.map((tag) => `
          <option value="${escapeHtml(tag)}" ${libraryState.tag === tag ? "selected" : ""}>${escapeHtml(tag)}</option>
        `).join("")}
      </select>
      <label class="library-toggle">
        <input id="formula-hide-mastered" type="checkbox" ${libraryState.hideMastered ? "checked" : ""}>
        隐藏已掌握
      </label>
    </div>
    <div class="library-meta">
      <span>显示 ${formulas.length} / ${allInCategory.length}</span>
      <span>已掌握 ${masteredInCategory}</span>
      <span>当前 ${category}</span>
    </div>
    <div class="formula-list">
      ${formulas.map(renderFormulaCard).join("")}
    </div>
    ${formulas.length === 0 ? '<p class="placeholder">没有符合条件的公式，换个筛选条件试试。</p>' : ""}
  `;
  els.libraryModal.classList.add("open");
  bindLibraryControls();
  bindFormulaActions();
}

function renderTodayTrainingQueue(): string {
  const records = getPracticeRecords();
  const queue = (["F2L", "OLL", "PLL"] as FormulaCategory[]).flatMap((category) => {
    const candidates = listByCategory(category).filter(isDeviceExecutableFormula);
    const formula = selectPracticeFormula(candidates, records);
    return formula ? [formula] : [];
  });
  if (queue.length === 0) return "";
  return `
    <section class="today-training-queue" aria-label="今日训练队列">
      <div><span class="eyebrow">Today’s Queue</span><strong class="queue-title"><span>今天练这</span><span class="queue-count">3</span><span>条</span></strong><p>优先安排未练习或成功率较低的公式。</p></div>
      <div class="queue-items">${queue.map((formula) => `
        <button class="queue-item" data-practice-formula="${escapeHtml(formula.id)}">
          <span>${formula.category}</span><strong>${escapeHtml(formula.id)}</strong><em>${escapeHtml(getFormulaDisplayName(formula))}</em>
        </button>
      `).join("")}</div>
    </section>
  `;
}

function getVisibleFormulas(category: FormulaCategory): Formula[] {
  const search = libraryState.search.trim().toLowerCase();

  return listByCategory(category).filter((formula) => {
    if (libraryState.difficulty !== null && formula.difficulty !== libraryState.difficulty) return false;
    if (libraryState.tag && !formula.tags.includes(libraryState.tag)) return false;
    if (libraryState.hideMastered && masteredFormulaIds.has(formula.id)) return false;
    if (!search) return true;

    const haystack = [
      formula.id,
      formula.name,
      formula.moves.join(" "),
      formula.tags.join(" "),
    ].join(" ").toLowerCase();
    return haystack.includes(search);
  });
}

function getCategoryTags(category: FormulaCategory): string[] {
  return [...new Set(listByCategory(category).flatMap((formula) => formula.tags))].sort();
}

function bindLibraryControls(): void {
  els.libraryContent.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cat = btn.dataset.cat as FormulaCategory | undefined;
      if (cat) showLibrary(cat);
    });
  });

  els.libraryContent.querySelector<HTMLInputElement>("#formula-search")?.addEventListener("input", (event) => {
    libraryState.search = (event.target as HTMLInputElement).value;
    showLibrary(libraryState.category);
  });

  els.libraryContent.querySelector<HTMLSelectElement>("#formula-difficulty")?.addEventListener("change", (event) => {
    const difficulty = Number((event.target as HTMLSelectElement).value);
    libraryState.difficulty = difficulty === 0 ? null : difficulty;
    showLibrary(libraryState.category);
  });

  els.libraryContent.querySelector<HTMLSelectElement>("#formula-tag")?.addEventListener("change", (event) => {
    libraryState.tag = (event.target as HTMLSelectElement).value;
    showLibrary(libraryState.category);
  });

  els.libraryContent.querySelector<HTMLInputElement>("#formula-hide-mastered")?.addEventListener("change", (event) => {
    libraryState.hideMastered = (event.target as HTMLInputElement).checked;
    showLibrary(libraryState.category);
  });
}

function renderFormulaCard(f: Formula): string {
  const mastered = masteredFormulaIds.has(f.id);
  const mastery = getFormulaMastery(getPracticeRecords(), f.id);
  const moves = getSelectedFormulaMoves(f);
  const algorithm = moves.join(" ");
  const setupMoves = getFormulaSetupMoves({ ...f, moves });
  const setup = setupMoves.join(" ");

  return `
    <div class="formula-card ${mastered ? "mastered" : ""}">
      <div class="formula-header">
        <span class="formula-id">${escapeHtml(f.id)}</span>
        <span class="formula-name">${escapeHtml(getFormulaDisplayName(f))}</span>
        <span class="formula-difficulty">${"★".repeat(f.difficulty)}</span>
      </div>
      ${renderFormulaCaseDiagram(f, setupMoves)}
      <div class="formula-algorithm">
        <div class="algorithm-label">打乱 / Setup <span>从复原状态执行</span></div>
        <code class="algorithm-moves">${escapeHtml(setup)}</code>
      </div>
      <div class="formula-algorithm primary">
        <div class="algorithm-label">解法 / Alg <span>${f.moves.length} 步</span></div>
        <code class="algorithm-moves">${escapeHtml(algorithm)}</code>
      </div>
      ${f.source ? `<div class="formula-source">来源：${escapeHtml(f.source)}</div>` : ""}
      ${renderFormulaVariants(f)}
      <div class="formula-actions">
        <button class="ghost" data-copy-setup="${escapeHtml(f.id)}">复制打乱</button>
        <button class="ghost" data-copy-formula="${escapeHtml(f.id)}">复制公式</button>
        <button class="practice-btn" data-practice-formula="${escapeHtml(f.id)}">开始练习</button>
      </div>
      <div class="formula-mastery">练习 ${mastery.attempts} 次 · 成功率 ${(mastery.successRate * 100).toFixed(0)}% · 平均 ${formatPracticeTime(mastery.averageDuration)}${mastery.averageRecognitionDuration !== null ? ` · 识别 ${formatPracticeTime(mastery.averageRecognitionDuration)} / 执行 ${formatPracticeTime(mastery.averageExecutionDuration)}` : ""}</div>
    </div>
  `;
}

function getFormulaVariants(formula: Formula): FormulaVariant[] {
  const sourceVariants: FormulaVariant[] = [
    { name: "主解", moves: formula.moves, note: "默认角度" },
    ...(formula.variants ?? []),
    ...(speedCubeDbVariants.get(formula.id) ?? []).map((moves, index) => ({
      name: `备用解 ${index + 1}`,
      moves,
      note: "SpeedCubeDB",
    })),
  ];
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

interface SpeedCubeDbAlternativesResponse {
  alternatives: Record<string, string[][]>;
  source: "SpeedCubeDB";
}

function isSpeedCubeDbAlternativesResponse(value: unknown): value is SpeedCubeDbAlternativesResponse {
  if (!value || typeof value !== "object" || !("alternatives" in value)) return false;
  const alternatives = value.alternatives;
  return typeof alternatives === "object" && alternatives !== null;
}

async function loadSpeedCubeDbVariants(): Promise<void> {
  if (hasLoadedSpeedCubeDbVariants || isLoadingSpeedCubeDbVariants) return;
  isLoadingSpeedCubeDbVariants = true;
  try {
    const response = await fetch("/api/formula-alternatives");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload: unknown = await response.json();
    if (!isSpeedCubeDbAlternativesResponse(payload)) throw new Error("响应格式无效");
    for (const [id, alternatives] of Object.entries(payload.alternatives)) {
      if (!Array.isArray(alternatives) || !alternatives.every((moves) => Array.isArray(moves) && moves.every((move) => typeof move === "string"))) continue;
      speedCubeDbVariants.set(id, alternatives);
    }
    hasLoadedSpeedCubeDbVariants = true;
    if (els.libraryModal.classList.contains("open")) showLibrary(libraryState.category);
  } catch (error) {
    console.error("[formula-library] SpeedCubeDB 备用解加载失败:", error);
  } finally {
    isLoadingSpeedCubeDbVariants = false;
  }
}

function getSelectedFormulaVariant(formula: Formula): FormulaVariant {
  const variants = getFormulaVariants(formula);
  const index = selectedFormulaVariants.get(formula.id) ?? 0;
  return variants[index] ?? variants[0];
}

function getSelectedFormulaMoves(formula: Formula): string[] {
  return getSelectedFormulaVariant(formula).moves;
}

function withSelectedFormulaMoves(formula: Formula): Formula {
  return { ...formula, moves: getSelectedFormulaMoves(formula) };
}

function renderFormulaVariants(formula: Formula): string {
  const variants = getFormulaVariants(formula);
  const selectedIndex = selectedFormulaVariants.get(formula.id) ?? 0;
  return `
    <div class="formula-variants" aria-label="${escapeHtml(formula.id)} 可选解法">
      ${variants.map((variant, index) => `
        <button
          class="formula-variant ${index === selectedIndex ? "active" : ""}"
          data-select-formula-variant="${escapeHtml(formula.id)}"
          data-variant-index="${index}"
          type="button"
        >
          <span class="variant-name">${escapeHtml(variant.name)}</span>
          <code>${escapeHtml(variant.moves.join(" "))}</code>
          <span class="variant-meta">${variant.moves.length} 步${variant.note ? ` · ${escapeHtml(variant.note)}` : ""}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function getFormulaDisplayName(formula: Formula): string {
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

function renderFormulaCaseDiagram(formula: Formula, setup: string[]): string {
  const facelets = createCaseFacelets(setup);
  if (formula.category !== "F2L") {
    return `
      <div class="formula-case-diagram formula-case-diagram-top" aria-label="${escapeHtml(formula.id)} top preview">
        ${renderFormulaTopView(facelets, formula.category)}
      </div>
    `;
  }
  const topColor = facelets[4];
  const hiddenTopCubieFacelets = getCubieFaceletIndexesWithColor(facelets, topColor);
  const focusCubieFacelets = getUnsolvedCubieFaceletIndexes(facelets);
  return `
    <div class="formula-case-diagram formula-case-diagram-f2l" aria-label="${escapeHtml(formula.id)} case preview">
      <div class="formula-cube-scene">
        <div class="formula-cube3d">
          ${renderFormulaCubeFace("u", getFace(facelets, "U"), hiddenTopCubieFacelets, focusCubieFacelets, 0)}
          ${renderFormulaCubeFace("r", getFace(facelets, "R"), hiddenTopCubieFacelets, focusCubieFacelets, 1)}
          ${renderFormulaCubeFace("f", getFace(facelets, "F"), hiddenTopCubieFacelets, focusCubieFacelets, 2)}
          ${renderFormulaCubeFace("d", getFace(facelets, "D"), hiddenTopCubieFacelets, focusCubieFacelets, 3)}
          ${renderFormulaCubeFace("l", getFace(facelets, "L"), hiddenTopCubieFacelets, focusCubieFacelets, 4)}
          ${renderFormulaCubeFace("b", getFace(facelets, "B"), hiddenTopCubieFacelets, focusCubieFacelets, 5)}
        </div>
      </div>
      <div class="formula-case-meta">
        <strong>Case 图</strong>
        <span>白底 / 红前 / 蓝左；黄色层隐藏，待配对角块与棱块高亮</span>
      </div>
    </div>
  `;
}

function renderFormulaTopView(facelets: string[], category: "OLL" | "PLL"): string {
  const state = createFormulaTopViewState(facelets, category);
  return `
    <div class="formula-top-view formula-top-view-${category.toLowerCase()}" aria-label="${category} 顶面状态">
      ${state.map((sticker) => renderFormulaTopSticker(sticker)).join("")}
    </div>
  `;
}

function renderFormulaTopSticker(sticker: string | null): string {
  if (sticker === null) return '<span class="formula-top-empty" aria-hidden="true"></span>';
  const color = sticker === "N" ? "#4b5563" : F2L_CASE_COLORS[sticker] ?? "#e5e7eb";
  return `<span style="background:${color}"></span>`;
}

function renderFormulaCubeFace(face: string, stickers: string[], hiddenFacelets: Set<number>, focusFacelets: Set<number>, faceIndex: number): string {
  return `
    <div class="formula-cube-face formula-cube-face-${face}">
      ${stickers.map((sticker, index) => {
        const faceletIndex = faceIndex * 9 + index;
        const classes = [
          hiddenFacelets.has(faceletIndex) ? "formula-sticker-hidden" : "",
          focusFacelets.has(faceletIndex) ? "formula-sticker-focus" : "",
        ].filter(Boolean).join(" ");
        return `<span class="${classes}" style="--formula-sticker:${F2L_CASE_COLORS[sticker] ?? "#94a3b8"}"></span>`;
      }).join("")}
    </div>
  `;
}


function bindFormulaActions(): void {
  bindFormulaCubeControls();
  els.libraryContent.querySelectorAll<HTMLButtonElement>("[data-select-formula-variant]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.selectFormulaVariant;
      const variantIndex = Number(btn.dataset.variantIndex ?? "0");
      if (!id || !Number.isFinite(variantIndex)) return;
      selectedFormulaVariants.set(id, variantIndex);
      showLibrary(libraryState.category);
    });
  });
  els.libraryContent.querySelectorAll<HTMLButtonElement>("[data-copy-setup]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.copySetup;
      const formula = id ? getFormulaById(id) : undefined;
      if (!formula) return;
      try {
        await navigator.clipboard?.writeText(getFormulaSetupMoves(withSelectedFormulaMoves(formula)).join(" "));
        log(`已复制打乱：${formula.id}`);
      } catch (err) {
        console.error(err);
        log(`复制失败：${formatError(err)}`, "error");
      }
    });
  });

  els.libraryContent.querySelectorAll<HTMLButtonElement>("[data-copy-formula]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.copyFormula;
      const formula = id ? getFormulaById(id) : undefined;
      if (!formula) return;
      try {
        await navigator.clipboard?.writeText(getSelectedFormulaMoves(formula).join(" "));
        log(`已复制公式：${formula.id}`);
      } catch (err) {
        console.error(err);
        log(`复制失败：${formatError(err)}`, "error");
      }
    });
  });

  els.libraryContent.querySelectorAll<HTMLButtonElement>("[data-practice-formula]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.practiceFormula;
      const formula = id ? getFormulaById(id) : undefined;
      if (!formula) return;
      const practiceFormula = withSelectedFormulaMoves(formula);
      if (!isDeviceExecutableFormula(practiceFormula)) {
        log(`该公式包含 M / 宽转 / 转体，暂不进入智能魔方专项计时：${formula.id}`, "error");
        return;
      }
      pendingPracticeFormula = practiceFormula;
      pendingPracticeCandidates = [practiceFormula];
      pendingPracticeOrder = "sequential";
      els.practiceFormulaName.textContent = `${formula.id} · ${getFormulaDisplayName(formula)}`;
      els.practiceCount.value = "10";
      els.practiceModal.classList.add("open");
    });
  });
}

function bindFormulaCubeControls(): void {
  els.libraryContent.querySelectorAll<HTMLElement>(".formula-cube-scene").forEach((scene) => {
    const cube = scene.querySelector<HTMLElement>(".formula-cube3d");
    if (!cube) return;
    let rotationX = -28;
    let rotationY = -38;
    let startX = 0;
    let startY = 0;
    let initialX = 0;
    let initialY = 0;
    let dragging = false;
    const render = (): void => {
      cube.style.transform = `rotateX(${rotationX}deg) rotateY(${rotationY}deg)`;
    };
    render();

    scene.addEventListener("pointerdown", (event) => {
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      initialX = rotationX;
      initialY = rotationY;
      scene.setPointerCapture(event.pointerId);
      scene.classList.add("is-dragging");
    });
    scene.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      rotationY = initialY + (event.clientX - startX) * 0.7;
      rotationX = Math.max(-82, Math.min(82, initialX - (event.clientY - startY) * 0.7));
      render();
    });
    const stop = (event: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      scene.classList.remove("is-dragging");
      if (scene.hasPointerCapture(event.pointerId)) scene.releasePointerCapture(event.pointerId);
    };
    scene.addEventListener("pointerup", stop);
    scene.addEventListener("pointercancel", stop);
  });
}

function toggleFormulaMastered(id: string): void {
  if (masteredFormulaIds.has(id)) {
    masteredFormulaIds.delete(id);
  } else {
    masteredFormulaIds.add(id);
  }
  saveMasteredFormulas();
  updateQuickStats();
}

function saveMasteredFormulas(): void {
  localStorage.setItem(FORMULA_MASTERED_KEY, JSON.stringify([...masteredFormulaIds]));
}

function loadMasteredFormulas(): void {
  const saved = localStorage.getItem(FORMULA_MASTERED_KEY);
  if (!saved) return;

  try {
    const ids = JSON.parse(saved);
    if (Array.isArray(ids)) {
      masteredFormulaIds = new Set(ids.filter((id): id is string => typeof id === "string"));
    }
  } catch (err) {
    console.error(err);
    localStorage.removeItem(FORMULA_MASTERED_KEY);
  }
}

function updateQuickStats(): void {
  renderHistory();
}

function recordSolve(input: AnalysisInput): void {
  historyStore.add(input);
  recentSolves = historyStore.all;
  renderHistory();
  if (isSolveEligible(input.qualityStatus)) animateHistoryRefresh();
}

function animateHistoryRefresh(): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const metrics = [els.historyToday, els.historyAo5, els.historyAo12, els.historyAo25, els.historyAo50, els.historyAo100];
  for (const metric of metrics) {
    metric.classList.remove("score-updated");
    void metric.offsetWidth;
    metric.classList.add("score-updated");
  }
}

function isDetailedScoreMode(): boolean {
  return els.scoreDisplayMode.value === "detailed";
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
  const duration = ((target.duration ?? 0) / 1000).toFixed(2);
  const pauseText = target.maxGap >= 800 ? `，最长停顿 ${(target.maxGap / 1000).toFixed(2)}s` : "";
  const recoveryText = target.repairCount > 0 || target.breakCount > 0
    ? `，修复 ${target.repairCount} 次、回退 ${target.breakCount} 次`
    : "";
  return {
    bottleneck: `F2L · ${target.slot}`,
    reason: `第 ${target.completionOrder ?? "—"} 对 ${target.slot} 用时 ${duration}s、${target.moves ?? 0} 步${pauseText}${recoveryText}`,
    advice: target.maxGap >= 800
      ? `专项练 ${target.slot} 槽位的连续观察：本对插入前先锁定下一对，优先把这次 ${(target.maxGap / 1000).toFixed(2)}s 停顿压低。`
      : `专项练 ${target.slot} 槽位：保持本对 ${target.moves ?? 0} 步的执行节奏，减少重做和回退。`,
  };
}

function renderDeviceHistory(solves: AnalysisInput[] = recentSolves): void {
  const groups = new Map<string, AnalysisInput[]>();
  for (const solve of solves) {
    if (!isSolveEligible(solve.qualityStatus)) continue;
    const key = solve.deviceId?.trim() || solve.deviceName?.trim() || "未标识魔方";
    const records = groups.get(key) ?? [];
    records.push(solve);
    groups.set(key, records);
  }
  const stats = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  els.deviceHistory.innerHTML = stats.length === 0
    ? "暂无设备成绩"
    : stats.map(([, records]) => {
      const name = records[0].deviceName?.trim() || "未标识魔方";
      const scores = records.map(getSolveScore).filter(Number.isFinite);
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

function loadHistoryGroups(): void {
  const saved = localStorage.getItem(HISTORY_GROUPS_KEY);
  if (!saved) return;
  try {
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return;
    historyGroups = parsed.filter((item): item is HistoryGroup => {
      if (typeof item !== "object" || item === null) return false;
      const group = item as Partial<HistoryGroup>;
      return typeof group.id === "string" && typeof group.name === "string" && typeof group.createdAt === "number";
    });
  } catch (error) {
    console.error("[history-groups] 无法加载分组:", error);
    localStorage.removeItem(HISTORY_GROUPS_KEY);
  }
}

function saveHistoryGroups(): void {
  localStorage.setItem(HISTORY_GROUPS_KEY, JSON.stringify(historyGroups));
}

function renderHistoryGroupOptions(): void {
  const systemOptions = SYSTEM_HISTORY_GROUPS
    .map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}</option>`)
    .join("");
  const customOptions = historyGroups
    .map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}</option>`)
    .join("");
  els.historyGroup.innerHTML = `${systemOptions}${customOptions ? `<option disabled>────────</option>${customOptions}` : ""}`;
  if (!SYSTEM_HISTORY_GROUP_IDS.has(selectedHistoryGroup) && !historyGroups.some((group) => group.id === selectedHistoryGroup)) {
    selectedHistoryGroup = "normal";
  }
  els.historyGroup.value = selectedHistoryGroup;
}

function getVisibleHistory(): Array<{ solve: AnalysisInput; index: number }> {
  return recentSolves
    .map((solve, index) => ({ solve, index }))
    .filter(({ solve }) => isSolveInSelectedHistoryGroup(solve));
}

function isSolveInSelectedHistoryGroup(solve: AnalysisInput): boolean {
  if (selectedHistoryGroup === "all") return true;
  if (selectedHistoryGroup === "normal") return !isPracticeSolve(solve);
  if (selectedHistoryGroup === "practice") return isPracticeSolve(solve);
  if (selectedHistoryGroup === "practice-formula") return solve.practiceKind === "formula";
  if (selectedHistoryGroup === "practice-cross") return solve.practiceKind === "cross";
  if (selectedHistoryGroup === "practice-f2l") return solve.practiceKind === "f2l";
  if (selectedHistoryGroup === "practice-cross-f2l") return solve.practiceKind === "cross-f2l";
  return solve.groupId === selectedHistoryGroup;
}

function isPracticeSolve(solve: AnalysisInput): boolean {
  return Boolean(solve.practiceKind || solve.practiceMode || solve.practiceFormulaId);
}

function getHistoryPracticeLabel(solve: AnalysisInput): string {
  if (solve.practiceKind === "formula") return solve.practiceFormulaId ? `公式 ${solve.practiceFormulaId}` : "公式练习";
  if (solve.practiceKind === "cross") return "Cross 练习";
  if (solve.practiceKind === "f2l") return "F2L 练习";
  if (solve.practiceKind === "cross-f2l") return "Cross+F2L";
  return "";
}

function renderReviewCandidates(): void {
  const eligible = recentSolves
    .map((solve, index) => ({ solve, index }))
    .filter(({ solve }) => isSolveEligible(solve.qualityStatus) && !isPracticeSolve(solve));
  const recent = eligible.slice(-100);
  const slowest = [...recent].sort((a, b) => getSolveScore(b.solve) - getSolveScore(a.solve)).slice(0, 10);
  const thresholdSeconds = Math.max(0, Number(els.reviewThreshold.value) || 0);
  const selected = new Map<number, { solve: AnalysisInput; index: number }>();
  for (const item of slowest) selected.set(item.index, item);
  for (const item of recent) {
    if (getSolveScore(item.solve) / 1000 >= thresholdSeconds) selected.set(item.index, item);
  }

  const candidates = [...selected.values()].sort((a, b) => getSolveScore(b.solve) - getSolveScore(a.solve));
  els.reviewList.innerHTML = candidates.length === 0
    ? "当前没有符合条件的成绩。"
    : candidates.map(({ solve, index }) => {
      const insight = getReviewInsight(solve);
      return `
      <button class="review-entry" data-review-index="${index}">
        <span>#${index + 1}</span>
        <strong>${formatSolveTime(solve)}${solve.penalty === "dnf" ? "" : "s"}</strong>
        <em>${(solve.tps ?? 0).toFixed(2)} TPS</em>
        <small><b>${insight.bottleneck}</b>：${insight.reason}<br>${insight.advice}</small>
      </button>
    `;
    }).join("");
  els.reviewList.querySelectorAll<HTMLButtonElement>("[data-review-index]").forEach((entry) => {
    entry.addEventListener("click", () => {
      const index = Number(entry.dataset.reviewIndex);
      if (!Number.isInteger(index) || !recentSolves[index]) return;
      selectedHistoryIndex = index;
      renderHistoryDetail(recentSolves[index], false);
      els.historyModal.classList.add("open");
    });
  });
}

function renderHistory(): void {
  renderHistoryGroupOptions();
  const visibleHistory = getVisibleHistory();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayCount = visibleHistory.filter(({ solve }) => (solve.completedAt ?? 0) >= todayStart.getTime()).length;
  els.historyToday.textContent = `${todayCount} 次`;
  const scoredSolves = visibleHistory
    .map(({ solve }) => solve)
    .filter((solve) => isSolveEligible(solve.qualityStatus));
  const averages: Array<[HTMLElement, number]> = [
    [els.historyAo5, 5], [els.historyAo12, 12], [els.historyAo25, 25],
    [els.historyAo50, 50], [els.historyAo100, 100],
  ];
  for (const [element, size] of averages) element.textContent = formatAverage(scoredSolves, size);

  const latest = visibleHistory
    .slice(-10)
    .map((entry, visibleIndex) => ({ ...entry, visibleIndex: Math.max(0, visibleHistory.length - 10) + visibleIndex }))
    .reverse();
  els.historyLastFive.innerHTML = latest.length === 0
    ? "暂无完成记录"
    : latest.map(({ solve, index: historyIndex, visibleIndex }) => {
      const practiceLabel = getHistoryPracticeLabel(solve);
      const detail = isDetailedScoreMode()
        ? `TPS ${(solve.tps ?? 0).toFixed(2)} · Cross ${(solve.crossDuration / 1000).toFixed(2)}s · F2L ${(solve.f2lDuration / 1000).toFixed(2)}s · OLL ${(solve.ollDuration / 1000).toFixed(2)}s · PLL ${(solve.pllDuration / 1000).toFixed(2)}s`
        : `${(solve.tps ?? 0).toFixed(2)} TPS`;
      return `<button class="history-entry" data-history-index="${historyIndex}"><span>#${visibleIndex + 1}${practiceLabel ? ` · ${escapeHtml(practiceLabel)}` : ""}</span><strong>${formatSolveTime(solve)}${solve.penalty === "dnf" ? "" : "s"}</strong><em>${detail}</em></button>`;
    }).join("");
  els.historyLastFive.querySelectorAll<HTMLButtonElement>("[data-history-index]").forEach((entry) => {
    entry.addEventListener("click", () => {
      const index = Number(entry.dataset.historyIndex);
      if (!Number.isInteger(index) || !recentSolves[index]) return;
      selectedHistoryIndex = index;
      renderHistoryDetail(recentSolves[index], false);
      els.historyModal.classList.add("open");
    });
  });
  renderDeviceHistory(visibleHistory.map(({ solve }) => solve));
  renderBlockPracticeStats();
  renderReviewCandidates();
  renderPerformanceChart(scoredSolves.map(getSolveScore).filter(Number.isFinite));
}

function renderHistoryDetail(solve: AnalysisInput, showSolution: boolean): void {
  historyDetailController.render(solve, showSolution);
}

function formatAverage(solves: AnalysisInput[], size: number): string {
  if (solves.length < size) return "—";
  return formatWcaAverage(solves.slice(-size).map((solve) => ({ duration: solve.totalDuration, penalty: solve.penalty })));
}

function renderPerformanceChart(durations: number[]): void {
  if (durations.length === 0) {
    els.performanceMean.textContent = "—";
    els.performanceStd.textContent = "—";
    els.performanceChart.innerHTML = '<text x="300" y="92" text-anchor="middle" fill="var(--warm-gray)" font-size="14">完成一把后显示成绩趋势</text>';
    return;
  }

  const values = durations.slice(-30).map((duration) => duration / 1000);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  els.performanceMean.textContent = `${mean.toFixed(2)}s`;
  els.performanceStd.textContent = `${Math.sqrt(variance).toFixed(2)}s`;

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
  els.performanceChart.innerHTML = `
    <line x1="36" y1="150" x2="564" y2="150" stroke="var(--rule)" />
    <line x1="36" y1="38" x2="36" y2="150" stroke="var(--rule)" />
    <line x1="36" y1="${meanY.toFixed(1)}" x2="564" y2="${meanY.toFixed(1)}" stroke="var(--gold-light)" stroke-dasharray="5 5" />
    <polyline points="${line}" fill="none" stroke="var(--gold)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    ${dots}
    <text x="8" y="42" fill="var(--warm-gray)" font-size="11">${max.toFixed(2)}s</text>
    <text x="8" y="152" fill="var(--warm-gray)" font-size="11">${min.toFixed(2)}s</text>
  `;
}

interface SolveResultFeedback {
  label: string;
  detail: string;
  isPersonalBest: boolean;
}

function getSolveScore(solve: AnalysisInput): number {
  return getWcaScore({ duration: solve.totalDuration, penalty: solve.penalty });
}

function formatSolveTime(solve: AnalysisInput): string {
  return formatWcaSolveTime({ duration: solve.totalDuration, penalty: solve.penalty });
}

function getComparableSolveHistory(current: AnalysisInput): AnalysisInput[] {
  const isPractice = isPracticeSolve(current);
  return recentSolves.filter((solve) => {
    if (!isSolveEligible(solve.qualityStatus) || isPracticeSolve(solve) !== isPractice) return false;
    return !isPractice || solve.practiceKind === current.practiceKind;
  });
}

function getSolveResultFeedback(current: AnalysisInput): SolveResultFeedback {
  if (!isSolveEligible(current.qualityStatus)) {
    return { label: "本把不计入成绩", detail: "设备数据未通过校验，不参与 PB 和 AO 统计。", isPersonalBest: false };
  }
  if (current.penalty === "dnf") {
    return { label: "DNF", detail: "观察超过 DNF 时限；本把保留在历史中，并按 WCA 规则参与 AO。", isPersonalBest: false };
  }
  const history = getComparableSolveHistory(current);
  const currentScore = getSolveScore(current);
  const isPersonalBest = history.every((solve) => currentScore < getSolveScore(solve));
  const rank = history.filter((solve) => getSolveScore(solve) < currentScore).length + 1;
  const ao5 = history.length >= 5
    ? calculateWcaAverage(history.slice(-5).map((solve) => ({ duration: solve.totalDuration, penalty: solve.penalty }))).value
    : null;
  if (isPersonalBest) {
    return { label: history.length === 0 ? "首个有效成绩" : "新的个人最佳", detail: `本组第 ${rank} 快`, isPersonalBest: history.length > 0 };
  }
  if (ao5 !== null) {
    const delta = currentScore - ao5;
    const direction = delta < 0 ? "快" : "慢";
    return { label: `较上一组 AO5 ${direction} ${Math.abs(delta / 1000).toFixed(2)}s`, detail: `本组第 ${rank} 快`, isPersonalBest: false };
  }
  return { label: `本组第 ${rank} 快`, detail: `再完成 ${Math.max(0, 4 - history.length)} 把解锁 AO5 对比`, isPersonalBest: false };
}

function getPracticeResultAction(current: AnalysisInput): string {
  if (!current.practiceKind) return "";
  const isSuccess = current.practiceOutcome === "success";
  const title = isSuccess ? "本题完成" : "本题需要重做";
  const formula = current.practiceFormulaId ? ` · ${escapeHtml(current.practiceFormulaId)}` : "";
  const timing = current.practiceKind === "formula"
    ? `识别 ${formatPracticeTime(current.recognitionDuration ?? null)} · 执行 ${formatPracticeTime(current.executionDuration ?? null)}`
    : `本次用时 ${(current.totalDuration / 1000).toFixed(2)}s`;
  const hint = isSuccess ? "下一题已准备好，完成打乱后转动第一步开始。" : "使用“重新开始本次”保持同一 case，先确认识别再执行。";
  return `
    <div class="result-action-card">
      <span>专项练习${formula}</span>
      <strong>${title}</strong>
      <p>${timing}。${hint}</p>
    </div>
  `;
}

function renderSolveSummary(current: AnalysisInput, previous?: AnalysisInput): void {
  const feedback = getSolveResultFeedback(current);
  const metrics: { label: string; value: string; current: number; previous?: number; unit: string }[] = [
    { label: "TPS", value: (current.tps ?? 0).toFixed(2), current: current.tps ?? 0, previous: previous?.tps, unit: "" },
    { label: "Cross", value: `${(current.crossDuration / 1000).toFixed(2)}s`, current: current.crossDuration, previous: previous?.crossDuration, unit: "s" },
    { label: "F2L", value: `${(current.f2lDuration / 1000).toFixed(2)}s`, current: current.f2lDuration, previous: previous?.f2lDuration, unit: "s" },
    { label: "OLL", value: `${(current.ollDuration / 1000).toFixed(2)}s`, current: current.ollDuration, previous: previous?.ollDuration, unit: "s" },
    { label: "PLL", value: `${(current.pllDuration / 1000).toFixed(2)}s`, current: current.pllDuration, previous: previous?.pllDuration, unit: "s" },
  ];
  const metricMarkup = metrics.map((metric) => {
    const delta = metric.previous === undefined ? "" : formatDelta(metric.current, metric.previous, metric.unit);
    return `<div><span>${metric.label}</span><strong>${metric.value}</strong><em>${delta}</em></div>`;
  }).join("");
  els.cfopSummary.innerHTML = `
    <section class="solve-result-hero${feedback.isPersonalBest ? " is-personal-best" : ""}" aria-live="polite">
      <span>本把成绩</span>
      <strong><span class="solve-result-time">${formatSolveTime(current)}</span>${current.penalty === "dnf" ? "" : "<small>s</small>"}</strong>
      <p><b>${feedback.label}</b>${feedback.detail ? ` · ${feedback.detail}` : ""}</p>
    </section>
    <div class="solve-stage-metrics">${metricMarkup}</div>
  `;
  const stages = [
    { name: "Cross", duration: current.crossDuration },
    { name: "F2L", duration: current.f2lDuration },
    { name: "OLL", duration: current.ollDuration },
    { name: "PLL", duration: current.pllDuration },
  ].filter((stage) => stage.duration > 0);
  const bottleneck = stages.reduce((slowest, stage) => stage.duration > slowest.duration ? stage : slowest, stages[0]);
  const quality = presentSolveQuality(current.qualityStatus, current.qualityAnomalies);
  const practiceAction = getPracticeResultAction(current);
  const defaultAction = !isSolveEligible(current.qualityStatus) ? `
    <div class="result-action-card">
      <span>本把不计入成绩</span>
      <strong>${escapeHtml(quality.label)}</strong>
      <p>${escapeHtml(quality.description)} 请重新生成打乱并从提示的第一步开始执行。</p>
    </div>
  ` : bottleneck ? `
    <div class="result-action-card">
      <span>下一步训练</span>
      <strong>先练 ${bottleneck.name}</strong>
      <p>${bottleneck.name} 用时 ${(bottleneck.duration / 1000).toFixed(2)}s；${quality.label}。</p>
      <button id="btn-result-practice" class="practice-btn">进入 ${bottleneck.name} 训练</button>
    </div>
  ` : "";
  els.resultNextAction.innerHTML = practiceAction || defaultAction;
  els.resultNextAction.querySelector<HTMLButtonElement>("#btn-result-practice")?.addEventListener("click", () => {
    els.cfopModal.classList.remove("open");
    openLibraryForBottleneck(bottleneck.name, current);
  });
}

function formatDelta(current: number, previous: number, unit: string): string {
  const divisor = unit === "s" ? 1000 : 1;
  const delta = (current - previous) / divisor;
  const sign = delta >= 0 ? "+" : "";
  return `(${sign}${delta.toFixed(2)}${unit})`;
}

els.btnCloseLibrary.onclick = () => {
  els.libraryModal.classList.remove("open");
};

function closeResultModals(): void {
  els.cfopModal.classList.remove("open");
  els.agentModal.classList.remove("open");
}

els.btnCloseCfop.onclick = closeResultModals;
els.btnCloseAgent.onclick = closeResultModals;
els.btnOpenAgent.onclick = () => {
  const validCount = recentSolves.filter((solve) => isSolveEligible(solve.qualityStatus)).length;
  els.analysisCount.max = String(Math.max(1, validCount));
  els.analysisCount.value = String(Math.min(12, validCount || 1));
  els.agentModal.classList.add("open");
};
els.btnRunAnalysis.onclick = async () => {
  const validCount = recentSolves.filter((solve) => isSolveEligible(solve.qualityStatus)).length;
  const scope = Math.min(validCount, Math.max(1, Math.floor(Number(els.analysisCount.value)) || 1));
  const input = createHistoryAnalysisInput(recentSolves, scope);
  if (!input) {
    els.agentOutput.innerHTML = '<p class="placeholder">请先完成至少一把，才可以分析历史数据。</p>';
    return;
  }
  els.analysisCount.value = String(scope);
  els.btnRunAnalysis.disabled = true;
  els.btnRunAnalysis.textContent = "分析中…";
  els.agentOutput.innerHTML = `<p class="placeholder">正在分析最近 ${scope} 把成绩…</p>`;
  log(`调用 DeepSeek：分析最近 ${scope} 把`);
  try {
    renderAgentResult(await analyzeWithDeepSeek(input), input);
  } finally {
    els.btnRunAnalysis.disabled = false;
    els.btnRunAnalysis.textContent = "开始分析";
  }
};
els.btnCloseHistory.onclick = () => {
  historyDetailController.close();
  els.historyModal.classList.remove("open");
};
bindAnalysisController({
  elements: {
    btnOpenAgent: els.btnOpenAgent,
    analysisCount: els.analysisCount,
    analysisSampleStatus: els.analysisSampleStatus,
    btnRunAnalysis: els.btnRunAnalysis,
    agentModal: els.agentModal,
    agentOutput: els.agentOutput,
  },
  getRecords: () => recentSolves,
  renderResult: renderAgentResult,
  log: (message) => log(message),
});
els.btnViewHistorySolution.onclick = () => {
  const solve = selectedHistoryIndex === null ? undefined : recentSolves[selectedHistoryIndex];
  if (solve) renderHistoryDetail(solve, true);
};
els.btnRetryHistory.onclick = () => {
  const historyIndex = selectedHistoryIndex;
  const solve = historyIndex === null ? undefined : recentSolves[historyIndex];
  if (historyIndex === null || !solve?.scramble) return;
  currentScramble = solve.scramble;
  scrambleProgress = createScrambleProgress(currentScramble);
  performedScrambleMoves = [];
  scrambleStateVerified = false;
  awaitingNextScramble = false;
  postSolveMove = null;
  timer.reset();
  stopTimerDisplay();
  updateTimerDisplay();
  els.btnStart.disabled = false;
  els.btnStop.disabled = true;
  cubeVisualizer.reset();
  showScrambleStage();
  renderScrambleProgress();
  els.historyModal.classList.remove("open");
  window.scrollTo({ top: 0, behavior: "smooth" });
  log(`重试历史打乱 #${historyIndex + 1}`);
};
els.btnDeleteHistory.onclick = () => {
  if (selectedHistoryIndex === null) return;
  historyStore.remove(selectedHistoryIndex);
  // remove() 会以新数组提交记录，页面引用也必须同步到该快照。
  recentSolves = historyStore.all;
  selectedHistoryIndex = null;
  renderHistory();
  els.historyModal.classList.remove("open");
  log("已删除历史记录");
};
els.btnCancelPractice.onclick = () => {
  pendingPracticeFormula = null;
  pendingPracticeCandidates = [];
  els.practiceModal.classList.remove("open");
};
els.btnClosePractice.onclick = els.btnCancelPractice.onclick;
els.btnStartPractice.onclick = () => {
  if (!pendingPracticeFormula) return;
  const target = Math.max(1, Math.min(100, Math.floor(Number(els.practiceCount.value) || 1)));
  startPractice(pendingPracticeFormula, target, pendingPracticeCandidates.length > 0 ? pendingPracticeCandidates : [pendingPracticeFormula], pendingPracticeOrder);
};
els.btnEndPractice.onclick = () => {
  if (!practiceSession) return;
  log(`已终止专项练习：${practiceSession.formula.id}`);
  finishPractice();
};
els.btnRetryPractice.onclick = () => {
  if (!practiceSession) return;
  preparePracticeScramble();
  log(`重新开始专项练习：${practiceSession.formula.id}`);
};

// ====== BLE 连接 ======
function setBleStatus(state: "disconnected" | "connecting" | "connected", name = ""): void {
  els.statusBadge.className = `status ${state}`;
  els.statusBadge.textContent =
    state === "connected" ? "已连接" :
    state === "connecting" ? "连接中..." : "未连接";
  els.deviceName.textContent = name;
  els.btnDisconnect.disabled = state !== "connected";
  if (state === "connected") {
    els.connectionMenu.open = false;
  }
}

function setConnectionMacMode(brand: "gan" | "moyu"): void {
  els.connectionPanel.dataset.activeBrand = brand;
}

els.btnConnectGan.onclick = async () => {
  setConnectionMacMode("gan");
  setBleStatus("connecting");
  try {
    let hasReceivedGanGyro = false;
    ganCube.onMove(onCubeMove);
    ganCube.onGyro((event) => {
      cubeVisualizer.setDeviceOrientation(event.quaternion);
      if (!hasReceivedGanGyro) {
        hasReceivedGanGyro = true;
        log("GAN 姿态跟随已启用");
      }
    });
    ganCube.onConnect(() => {
      setBleStatus("connected", ganCube.getName() || "GAN");
      cubeVisualizer.resetDeviceOrientation();
      log(`GAN 已连接: ${ganCube.getName()}`);
      const normalizedMac = ganCube.getMacAddress();
      if (normalizedMac) {
        els.ganMacInput.value = normalizedMac;
        localStorage.setItem(GAN_MAC_KEY, normalizedMac);
      }
      window.setTimeout(() => confirmCubeResetAfterConnect("GAN"), 0);
    });
    ganCube.onDisconnect(() => {
      cubeVisualizer.resetDeviceOrientation();
      setBleStatus("disconnected");
      log("GAN 已断开", "error");
    });
    ganCube.onBattery((level) => {
      if (Number.isFinite(level)) {
        log(`🔋 GAN 电量: ${level}%`);
      } else {
      log("GAN 电量解析失败，请检查 MAC 地址是否正确", "error");
      }
    });
    await ganCube.connect(els.ganMacInput.value.trim() || undefined);
  } catch (err: unknown) {
    setBleStatus("disconnected");
    log(`GAN 连接失败: ${formatError(err)}`, "error");
  }
};

els.btnSetGanMac.onclick = () => {
  setConnectionMacMode("gan");
  void applyGanMac(true);
};
els.btnSetMoyuMac.onclick = () => {
  setConnectionMacMode("moyu");
  void applyMoyuMac(true);
};

els.btnConnectMoyu.onclick = async () => {
  setConnectionMacMode("moyu");
  setBleStatus("connecting");
  try {
    let hasReceivedMoyuGyro = false;
    moyuCube.onMove(onCubeMove);
    moyuCube.onGyroRaw(() => {
      if (hasReceivedMoyuGyro) return;
      hasReceivedMoyuGyro = true;
      log("魔域陀螺仪通知已接收，已纳入协议诊断");
    });
    moyuCube.onConnect(() => {
      setBleStatus("connected", moyuCube.getName() || "魔域");
      log(`魔域已连接: ${moyuCube.getName()}`);
      const normalizedMac = moyuCube.getMacAddress();
      if (normalizedMac) {
        els.moyuMacInput.value = normalizedMac;
        localStorage.setItem(MOYU_MAC_KEY, normalizedMac);
      }
      window.setTimeout(() => confirmCubeResetAfterConnect("魔域"), 0);
    });
    moyuCube.onDisconnect(() => {
      setBleStatus("disconnected");
      log("魔域已断开", "error");
    });
    await moyuCube.connect(els.moyuMacInput.value.trim() || undefined);
  } catch (err: unknown) {
    setBleStatus("disconnected");
    log(`魔域连接失败: ${formatError(err)}`, "error");
  }
};

els.btnDisconnect.onclick = async () => {
  await ganCube.disconnect();
  await moyuCube.disconnect();
};

// ====== 键盘快捷键 ======
document.addEventListener("keydown", (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) {
    // 带修饰键的组合键不应触发计时器快捷操作，Alt+A 等组合键交由浏览器或系统处理。
    return;
  }
  if (e.code === "Space" && !els.btnStart.disabled && !els.btnStop.disabled) {
    e.preventDefault();
    if (timer.getState().isRunning) els.btnStop.click();
    else els.btnStart.click();
  }
  if (e.code === "Escape") {
    els.libraryModal.classList.remove("open");
    closeResultModals();
    els.practiceModeModal.classList.remove("open");
    els.practiceModal.classList.remove("open");
    historyDetailController.close();
    els.historyModal.classList.remove("open");
  }
});

// ====== 启动 ======
applyAppSettings(appSettings);
newScramble();
loadMasteredFormulas();
els.ganMacInput.value = localStorage.getItem(GAN_MAC_KEY) ?? "";
els.moyuMacInput.value = localStorage.getItem(MOYU_MAC_KEY) ?? "";
setConnectionMacMode("gan");
if (recentSolves.length > 0) log(`📂 已加载 ${recentSolves.length} 把历史`);
loadHistoryGroups();
updateQuickStats();
log("CubeMind 已启动");
log(`当前时间: ${new Date().toLocaleString()}`);
const stats = getLibraryStats();
log(`📚 公式库：F2L ${stats.F2L} + OLL ${stats.OLL} + PLL ${stats.PLL} = ${stats.total} 个公式`);
