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
import type { CubeMove } from "./ble/cube-driver.ts";
import type { AnalysisInput, AnalysisResult, AnalysisIssue, AnalysisDrill } from "./agent/types.ts";
import { listByCategory, getLibraryStats } from "./formula/formula-library.ts";
import type { Formula, FormulaCategory } from "./formula/types.ts";
import { getFormulaSetupMoves, isFormulaDevicePracticeSafe } from "./formula/setup-validation.ts";
import { recognizeF2lCase, recognizeFormulaPracticeCase } from "./core/f2l-case-recognizer.ts";
import { applyScrambleMove, createScrambleProgress, invertMove, type ScrambleProgress } from "./core/scramble-tracker.ts";
import { isScrambleStateVerified } from "./core/scramble-verification.ts";
import { CubeVisualizer } from "./ui/cube-visualizer.ts";
import { SolveReplayPlayer } from "./ui/solve-replay-player.ts";
import { renderSolveTimeline } from "./ui/solve-timeline.ts";
import { HistoryController, SYSTEM_HISTORY_GROUP_IDS } from "./controllers/history-controller.ts";
import { isAnalysisEligible, isMoveStreamReliable, isScoreEligible as isScoreEligibleByState, isSolveEligible, validateSolve } from "./core/solve-validation.ts";
import { calculateWcaAverage, formatWcaSolveTime, getWcaScore } from "./core/wca-average.ts";
import type { InspectionPenalty } from "./core/inspection-rules.ts";
import { HistoryStore } from "./core/history-store.ts";
import { analyzeSolveSteps, type SolveReview } from "./core/solve-review.ts";
import { analyzeF2lSlots, formatF2lSlotAnalysis } from "./core/f2l-slot-tracker.ts";
import { extractBottleneck } from "./agent/analysis-input.ts";
import { loadSessionContext, appendSessionEntry } from "./core/session-context.ts";
import { aggregateIssues, generatePlan, updatePlanProgress, getTodayTask } from "./core/training-plan-engine.ts";
import { loadPlan, savePlan, appendAnalysisSnapshot, loadAnalysisHistory, snapshotsToResults } from "./core/training-plan-store.ts";
import type { TrainingPlan } from "../src-shared/training-plan-types.ts";
import { bindAnalysisController } from "./agent/analysis-controller.ts";
import { BleConnectionController } from "./controllers/ble-connection-controller.ts";
import { ganCube } from "./ble/gan-cube-protocol.ts";
import { moyuCube } from "./ble/moyu-cube-protocol.ts";
import { TimerDisplayController } from "./controllers/timer-display-controller.ts";
import { FormulaLibraryController } from "./controllers/formula-library-controller.ts";
import { convertSolutionForWhiteDown, solveCross, solveXCross } from "./core/cross-solver.ts";
import { getCfopPhase } from "./core/cstimer-cfop.ts";
import { getPracticeSummary, selectPracticeFormula, type PracticeRecord } from "./core/practice-stats.ts";
import { calculateCrossMetrics } from "./core/cross-metrics.ts";
import { findMoveLossWarning, summarizePrettyReconstruction } from "./core/move-reconstruction.ts";
import { presentSolveQuality } from "./core/data-quality.ts";
import { SOLVED_FACELET } from "./utils/mathlib.ts";
import { SettingsController } from "./controllers/settings-controller.ts";
import { sendDiagnosticEvent, type DiagnosticMode } from "./core/diagnostics-client.ts";
import { CubeEditorController } from "./controllers/cube-editor-controller.ts";
import { canBeginInspection } from "./core/scramble-ready-gate.ts";
import { validateCubeEditorFacelets } from "./agent/cube-state-tools.ts";

// ====== DOM 引用 ======
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

const els = {
  scrambleText: $("scramble-text") as HTMLDivElement,
  btnNextScramble: $("btn-next-scramble") as HTMLButtonElement,
  btnToggleScrambleSteps: $("btn-toggle-scramble-steps") as HTMLButtonElement,
  btnToggleCrossSettings: $("btn-toggle-cross-settings") as HTMLButtonElement,
  crossTrainingSettings: $("cross-training-settings") as HTMLDivElement,
  crossStepSelector: $("cross-step-selector") as HTMLDivElement,
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
  btnToggleBleDiagnostics: $("btn-toggle-ble-diagnostics") as HTMLButtonElement,
  btnExportBleDiagnostics: $("btn-export-ble-diagnostics") as HTMLButtonElement,
  bleDiagnosticsStatus: $("ble-diagnostics-status") as HTMLElement,
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
  solveTimeline: $("solve-timeline") as HTMLDivElement,
  agentOutput: $("agent-output") as HTMLDivElement,
  trainingPlanContainer: $("training-plan-container") as HTMLDivElement,
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
  cubeEditorPreview: $("cube-editor-preview") as HTMLDivElement,
  cubeEditorPalette: $("cube-editor-palette") as HTMLDivElement,
  cubeEditorStatus: $("cube-editor-status"),
  cubeAgentPrompt: $("cube-agent-prompt") as HTMLTextAreaElement,
  btnCubeEditorReset: $("btn-cube-editor-reset") as HTMLButtonElement,
  btnCubeEditorSolved: $("btn-cube-editor-solved") as HTMLButtonElement,
  btnAskCubeAgent: $("btn-ask-cube-agent") as HTMLButtonElement,
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
const settingsController = new SettingsController({
  btnOpenSettings: els.btnOpenSettings,
  settingsModal: els.settingsModal,
  btnCloseSettings: els.btnCloseSettings,
  btnSaveSettings: els.btnSaveSettings,
  settingCrossSteps: els.settingCrossSteps,
  settingInspectionEnabled: els.settingInspectionEnabled,
  settingInspectionSeconds: els.settingInspectionSeconds,
  settingTheme: els.settingTheme,
}, (msg) => log(msg));
const formulaLibrary = new FormulaLibraryController({
  libraryModal: els.libraryModal,
  libraryContent: els.libraryContent,
  libraryTitle: els.libraryTitle,
  btnCloseLibrary: els.btnCloseLibrary,
  btnOpenLibrary: els.btnOpenLibrary,
  practiceModal: els.practiceModal,
  practiceFormulaName: els.practiceFormulaName,
  practiceCount: els.practiceCount,
}, {
  log: (msg, level) => log(msg, level),
  onStartPractice: (formula, target, candidates, order) => startPractice(formula, target, candidates, order),
  getPracticeRecords: () => getPracticeRecords(),
});
const historyController = new HistoryController({
  historyToday: els.historyToday,
  historyAo5: els.historyAo5,
  historyAo12: els.historyAo12,
  historyAo25: els.historyAo25,
  historyAo50: els.historyAo50,
  historyAo100: els.historyAo100,
  historyLastFive: els.historyLastFive,
  deviceHistory: els.deviceHistory,
  historyGroup: els.historyGroup,
  btnNewHistoryGroup: els.btnNewHistoryGroup,
  btnDeleteHistoryGroup: els.btnDeleteHistoryGroup,
  btnExportHistoryJson: els.btnExportHistoryJson,
  btnExportHistoryCsv: els.btnExportHistoryCsv,
  scoreDisplayMode: els.scoreDisplayMode,
  reviewThreshold: els.reviewThreshold,
  btnRefreshReview: els.btnRefreshReview,
  reviewList: els.reviewList,
  performanceChart: els.performanceChart,
  performanceMean: els.performanceMean,
  performanceStd: els.performanceStd,
  historyModal: els.historyModal,
  historyDetail: els.historyDetail,
  btnCloseHistory: els.btnCloseHistory,
  btnRetryHistory: els.btnRetryHistory,
  btnViewHistorySolution: els.btnViewHistorySolution,
  btnDeleteHistory: els.btnDeleteHistory,
}, {
  log: (msg, level) => log(msg, level),
  getRecords: () => recentSolves,
  onRetry: (scramble) => {
    currentScramble = scramble;
    scrambleProgress = createScrambleProgress(currentScramble);
    performedScrambleMoves = [];
    scrambleStateVerified = false;
    awaitingNextScramble = false;
    postSolveMove = null;
    timer.reset();
    timerDisplay.stopDisplay();
    timerDisplay.updateDisplay();
    els.btnStart.disabled = false;
    els.btnStop.disabled = true;
    cubeVisualizer.reset();
    showScrambleStage();
    renderScrambleProgress();
    window.scrollTo({ top: 0, behavior: "smooth" });
    log("重试历史打乱");
  },
  onDelete: (index) => {
    historyStore.remove(index);
    recentSolves = historyStore.all;
    historyController.render();
    log("已删除历史记录");
  },
  onSave: () => historyStore.save(),
  renderBlockPracticeStats: () => renderBlockPracticeStats(),
});
const cubeVisualizer = new CubeVisualizer(els.cube3d);
const timerDisplay = new TimerDisplayController(timer, {
  timerDisplay: els.timerDisplay,
  inspectionStatus: els.inspectionStatus,
  btnStart: els.btnStart,
}, {
  isPracticeObservation: () => isPracticeObservation(),
  getInspectionSettings: () => { const s = settingsController.getSettings(); return { enabled: s.inspectionEnabled, seconds: s.inspectionSeconds }; },
  onShowTimerStage: () => showTimerStage(),
  log: (msg, level) => log(msg, level),
});
let analysisPreviewPlayers: SolveReplayPlayer[] = [];
let currentScramble = "";
let selectedCrossSteps: number | null = null;
let showFullScramble = false;
let activeCrossScrambleWorker: Worker | null = null;
let scrambleGenerationId = 0;
let scrambleProgress: ScrambleProgress = createScrambleProgress("");
let performedScrambleMoves: string[] = [];
let scrambleStateVerified = false;
const historyStore = HistoryStore.load();
let recentSolves: AnalysisInput[] = historyStore.all;
let blockPracticeMode: "cross" | "f2l" | "cross-f2l" | null = null;
let blockPracticeCompleted = false;

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
let practiceCaseVerified = false;
let awaitingNextScramble = false;
let postSolveMove: string | null = null;
let currentSolveEvents: CubeMove[] = [];
let isFinalizingSolve = false;
let lastDeviceMoveCnt: number | undefined;
let pendingInspectionPenalty: InspectionPenalty = "none";
let pendingInspectionDuration: number = 0;

// ====== 日志 ======
function log(msg: string, type: "info" | "move" | "error" = "info"): void {
  const time = new Date().toLocaleTimeString();
  const line = document.createElement("div");
  line.className = `log-line ${type}`;
  line.textContent = `[${time}] ${msg}`;
  els.log.appendChild(line);
  els.log.scrollTop = els.log.scrollHeight;
}

// ====== 打乱 ======
function setScrambleGenerationPending(pending: boolean): void {
  els.btnNextScramble.disabled = pending;
  els.btnNextScramble.textContent = pending ? "生成中…" : "新打乱";
  els.crossStepSelector.querySelectorAll<HTMLButtonElement>("[data-cross-steps]").forEach((button) => {
    button.disabled = pending;
  });
}

function generateCrossScrambleInWorker(targetSteps: number): Promise<string> {
  activeCrossScrambleWorker?.terminate();
  const worker = new Worker("./cross-scramble-worker.js");
  activeCrossScrambleWorker = worker;
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<{ scramble?: string; error?: string }>) => {
      worker.terminate();
      if (activeCrossScrambleWorker === worker) activeCrossScrambleWorker = null;
      if (event.data.scramble) resolve(event.data.scramble);
      else reject(new Error(event.data.error ?? "Cross 打乱生成失败"));
    };
    worker.onerror = (event) => {
      worker.terminate();
      if (activeCrossScrambleWorker === worker) activeCrossScrambleWorker = null;
      reject(new Error(event.message || "Cross 打乱 Worker 无法启动"));
    };
    worker.postMessage({ targetFace: "U", targetSteps });
  });
}

function generatePreferredScramble(): Promise<string> {
  if (selectedCrossSteps === null) return Promise.resolve(scramble333(20));
  return generateCrossScrambleInWorker(selectedCrossSteps);
}

function loadGeneratedScramble(scramble: string): void {
  currentScramble = scramble.trim();
  scrambleProgress = createScrambleProgress(currentScramble);
  performedScrambleMoves = [];
  scrambleStateVerified = false;
  awaitingNextScramble = false;
  postSolveMove = null;
  timer.reset();
  timerDisplay.endInspection();
  timerDisplay.stopDisplay();
  timerDisplay.updateDisplay();
  // 新一把打乱默认从已还原状态开始，避免 3D 状态与当前打乱脱节。
  cubeVisualizer.reset();
  els.btnStart.disabled = true;
  els.btnStop.disabled = true;
  showScrambleStage();
  renderScrambleProgress();
  void sendDiagnosticEvent({ kind: "scramble", occurredAt: Date.now(), scramble: currentScramble, mode: "normal" });
  log(`生成打乱: ${currentScramble.slice(0, 40)}${currentScramble.length > 40 ? "..." : ""}`);
}

async function newScramble(): Promise<void> {
  if (practiceSession) {
    preparePracticeScramble();
    return;
  }
  const generationId = ++scrambleGenerationId;
  activeCrossScrambleWorker?.terminate();
  activeCrossScrambleWorker = null;
  setScrambleGenerationPending(selectedCrossSteps !== null);
  try {
    const scramble = await generatePreferredScramble();
    if (generationId === scrambleGenerationId) loadGeneratedScramble(scramble);
  } catch (error) {
    console.error("[scramble] 指定 Cross 打乱失败:", error);
    if (generationId === scrambleGenerationId) {
      log("指定 Cross 暂时未生成，已回退为 WCA 随机打乱", "error");
      loadGeneratedScramble(scramble333(20));
    }
  } finally {
    if (generationId === scrambleGenerationId) setScrambleGenerationPending(false);
  }
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
  timerDisplay.endInspection();
  timerDisplay.stopDisplay();
  timerDisplay.updateDisplay();
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
  timerDisplay.endInspection();
  timerDisplay.stopDisplay();
  timerDisplay.updateDisplay();
  els.btnStart.disabled = true;
  els.btnStop.disabled = true;
  cubeVisualizer.reset();
  practiceNeedsRetry = false;
  practiceCaseVerified = false;
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
  practiceCaseVerified = false;
  timerDisplay.endInspection();
  els.practiceBanner.hidden = true;
  awaitingNextScramble = false;
  postSolveMove = null;
  timer.reset();
  timerDisplay.stopDisplay();
  timerDisplay.updateDisplay();
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
  if (showFullScramble) {
    const completedCount = scrambleProgress.completed.length;
    const allMoves = scrambleProgress.completed.concat(scrambleProgress.remaining);
    els.scrambleText.innerHTML = allMoves.map((move, index) => {
      const isCompleted = index < completedCount;
      const isNext = !isCompleted && index === completedCount;
      return `<span class="scramble-move ${isCompleted ? "completed" : ""} ${isNext ? "next" : ""}">${escapeHtml(move)}</span>`;
    }).join(" ");
    return;
  }

  // 默认只展示尚待执行的一组步骤，避免已执行步骤与完整打乱混在一起。
  els.scrambleText.innerHTML = scrambleProgress.remaining.map(
    (move, index) => `<span class="scramble-move ${index === 0 ? "next" : ""}">${escapeHtml(move)}</span>`
  ).join(" ");
}

function showScrambleStage(): void {
  // 训练舞台布局：打乱与计时器始终同屏可见，无需切换
}

function isPracticeObservation(): boolean {
  return practiceSession !== null || blockPracticeMode !== null;
}

function showTimerStage(): void {
  // 训练舞台布局：打乱与计时器始终同屏可见，无需切换
}

function resetSessionForSyncedCube(): void {
  timer.reset();
  lastDeviceMoveCnt = undefined;
  timerDisplay.stopDisplay();
  timerDisplay.updateDisplay();
  els.btnStart.disabled = false;
  els.btnStop.disabled = true;
  cubeVisualizer.reset();
  newScramble();
}

function confirmCubeResetAfterConnect(deviceLabel: string): void {
  const shouldReset = window.confirm(
    `${deviceLabel} 已连接。\n\n请先把实体智能魔方复原到已还原状态。\n点击"确定"后，CubeMind 会把 3D 魔方重置为已还原并生成新打乱。`
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

  if (scrambleProgress.lastMoveCorrect === false) {
    log(`打乱转错：期望 ${expected}，已加入纠错步`, "error");
  }
}

function verifyCompletedScramble(): void {
  scrambleStateVerified = isScrambleStateVerified(scrambleProgress.completed, performedScrambleMoves);
  if (scrambleStateVerified) {
    log("打乱状态已核验，可转动第一步开始计时");
    return;
  }
  log("打乱终态回放校验异常，已记录诊断；仍可转动第一步开始计时", "error");
}
els.crossStepSelector.querySelectorAll<HTMLButtonElement>("[data-cross-steps]").forEach((button) => {
  button.onclick = () => {
    const rawValue = button.dataset.crossSteps;
    selectedCrossSteps = rawValue && rawValue !== "random" ? Number(rawValue) : null;
    els.crossStepSelector.querySelectorAll<HTMLButtonElement>("[data-cross-steps]").forEach((item) => {
      item.classList.toggle("active", item === button);
    });
    log(selectedCrossSteps === null ? "已选择随机 Cross 打乱" : `已选择白色 Cross ${selectedCrossSteps} 步打乱`);
    newScramble();
  };
});
els.btnNextScramble.onclick = newScramble;
els.btnToggleScrambleSteps.onclick = () => {
  showFullScramble = !showFullScramble;
  els.btnToggleScrambleSteps.textContent = showFullScramble ? "仅看剩余" : "显示完整";
  renderScrambleProgress();
};
els.btnToggleCrossSettings.onclick = () => {
  const isExpanded = els.btnToggleCrossSettings.getAttribute("aria-expanded") === "true";
  els.btnToggleCrossSettings.setAttribute("aria-expanded", String(!isExpanded));
  els.btnToggleCrossSettings.textContent = isExpanded ? "＋" : "−";
  els.crossTrainingSettings.hidden = isExpanded;
};
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
      const solution = solveCross(currentScramble, targetFace, settingsController.getSettings().crossMaxSteps);
      const displaySolution = convertSolutionForWhiteDown(solution, "F");
      const difficulty = solution.length <= 4 ? "简单" : solution.length <= 6 ? "中等" : "困难";
      els.crossSolution.innerHTML = solution.length > 0
        ? `白色 Cross（绿面前）：<code>${escapeHtml(displaySolution.join(" "))}</code>（${solution.length} 步，${difficulty}）`
        : `未在 ${settingsController.getSettings().crossMaxSteps} 步搜索范围内找到十字解法。`;
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
function startDailyPractice(): void {
  const candidates = (["F2L", "OLL", "PLL"] as FormulaCategory[])
    .flatMap((category) => listByCategory(category))
    .filter(isFormulaDevicePracticeSafe)
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

function getFormulaDisplayName(formula: Formula): string {
  if (formula.category !== "F2L") return formula.name;
  const match = /^f2l-(\d+)$/i.exec(formula.id);
  if (!match) return formula.name;
  return `F2L 第 ${Number(match[1])} 例`;
}

function openCategoryPractice(category: "OLL" | "PLL" | "OLL-PLL"): void {
  const allFormulas = category === "OLL-PLL"
    ? [...listByCategory("OLL"), ...listByCategory("PLL")]
    : listByCategory(category);
  const maxDifficulty = Number(els.formulaPracticeDifficulty.value);
  const onlyUnmastered = els.formulaPracticeUnmastered.checked;
  const formulas = allFormulas.filter((formula) =>
    formula.difficulty <= maxDifficulty
    && (!onlyUnmastered || !formulaLibrary.isMastered(formula.id))
    && isFormulaDevicePracticeSafe(formula));
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

// ====== 计时器 ======
function startSolveTimer(fromMove = false): void {
  if (timer.getState().isRunning) {
    log("计时器已在运行中", "error");
    return;
  }
  if (scrambleProgress.remaining.length > 0) {
    log(`打乱未完成，剩余 ${scrambleProgress.remaining.length} 步`, "error");
    return;
  }
  if (!fromMove) {
    log("请通过转动第一步开始计时", "error");
    return;
  }
  pendingInspectionPenalty = timerDisplay.consumePenalty();
  pendingInspectionDuration = timerDisplay.getInspectionDuration();
  timer.start();
  currentSolveEvents = [];
  lastDeviceMoveCnt = undefined;
  els.btnStart.disabled = true;
  els.btnStop.disabled = false;
  timerDisplay.startDisplay();
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
  timerDisplay.stopDisplay();
  timerDisplay.updateDisplay();
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

/** 蓝牙断连时若正在计时，中止当前 solve 并提示用户（不完整数据不做分析） */
function handleBleDisconnectMidSolve(deviceName: string): void {
  if (!timer.getState().isRunning) return;
  timer.stop();
  timerDisplay.stopDisplay();
  timerDisplay.updateDisplay();
  els.btnStart.disabled = false;
  els.btnStop.disabled = true;
  isFinalizingSolve = false;
  log(`⚠ ${deviceName} 在计时过程中断开，本把成绩已作废。请重连后重新开始。`, "error");
}

els.btnStop.onclick = () => {
  void stopSolveTimerAndAnalyze(true);
};

els.btnReset.onclick = () => {
  timer.reset();
  timerDisplay.endInspection();
  blockPracticeMode = null;
  awaitingNextScramble = false;
  postSolveMove = null;
  showScrambleStage();
  timerDisplay.updateDisplay();
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

  const shouldStartSolve = !timer.getState().isRunning && scrambleProgress.remaining.length === 0;
  const wasCompletingScramble = scrambleProgress.remaining.length > 0;
  if (wasCompletingScramble) performedScrambleMoves.push(move.move);
  updateScrambleProgress(move.move);

  if (wasCompletingScramble && scrambleProgress.remaining.length === 0) {
    verifyCompletedScramble();
    if (canBeginInspection(scrambleProgress.remaining.length, scrambleStateVerified)) {
      if (!scrambleStateVerified) log("打乱动作序列已完成；终态回放校验异常已记录，但不会阻止本把计时", "error");
      timerDisplay.beginInspection();
    }
  }

  if (practiceSession && wasCompletingScramble && scrambleProgress.remaining.length === 0) {
    const facelets = cubeVisualizer.getFacelets();
    const match = recognizeFormulaPracticeCase(facelets, practiceSession.formula);
    practiceCaseVerified = match?.formulaId === practiceSession.formula.id;
    if (match?.formulaId === practiceSession.formula.id) {
      log(`${practiceSession.formula.category} 识别：${match.formulaId} · ${match.name}（精确匹配）`);
    } else {
      const fallback = practiceSession.formula.category === "F2L" ? recognizeF2lCase(facelets) : null;
      log(fallback
        ? `${practiceSession.formula.category} 起始 case 不匹配：期望 ${practiceSession.formula.id}，识别为 ${fallback.formulaId}`
        : `${practiceSession.formula.category} 起始 case 未能可靠匹配：期望 ${practiceSession.formula.id}`, "error");
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
  const shouldStopFormulaOll = practiceSession?.formula.category === "OLL" && timer.getState().moves.length > 0 && blockPhase === "oll";
  if (timer.getState().isRunning && timer.getState().moves.length > 0 && (cubeVisualizer.isSolved() || shouldStopBlock || shouldStopCross || shouldStopFormulaF2l || shouldStopFormulaOll)) {
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
  const hardwareFacelets = await bleController.requestCurrentFacelets();
  const physicalState = hardwareFacelets === null
    ? "unavailable"
    : hardwareFacelets === SOLVED_FACELET ? "confirmed-solved" : "confirmed-unsolved";
  const validation = validateSolve(scrambleProgress.completed, currentSolveEvents);
  const reliableMoveStream = isMoveStreamReliable(validation);
  const analysisEligible = validation.isSolved && reliableMoveStream;
  if (physicalState === "confirmed-solved" && !analysisEligible) {
    log("实体魔方已确认复原；本把计入成绩，但动作流不完整，不生成 CFOP/AI 分析", "error");
  } else if (physicalState === "confirmed-unsolved") {
    log("设备状态回读确认未复原，本把不计入成绩", "error");
  }
  const prettySummary = summarizePrettyReconstruction(currentSolveEvents);
  if (prettySummary) log(prettySummary);

  const cfopResult: CfopResult | null = analysisEligible ? parseCfop(
    moveStrs, moveTimes, scrambleProgress.completed, state.startTime, state.endTime,
  ) : null;
  const stepReview = cfopResult ? analyzeSolveSteps(
    moveStrs, state.moves.map((move) => move.gapFromPrev), cfopResult.segments,
  ) : undefined;
  const f2lSlotAnalysis = stepReview ? analyzeF2lSlots(
    scrambleProgress.completed, moveStrs, moveTimes, state.moves.map((move) => move.gapFromPrev), state.startTime, stepReview.pauseThreshold,
  ) : undefined;
  els.cfopOutput.textContent = cfopResult && f2lSlotAnalysis
    ? `总用时: ${(timer.getDuration() / 1000).toFixed(2)}s\n${formatCfop(cfopResult)}\n\n${formatF2lSlotAnalysis(f2lSlotAnalysis)}`
    : "实体复原已确认，但动作流不完整。\n本把已计入 PB/AO；不生成 CFOP、F2L 槽位、停顿或 AI 分析。";
  els.cfopModal.classList.add("open");
  if (cfopResult) log(`CFOP 识别完成: ${cfopResult.segments.length} 个阶段`);

  const cross = cfopResult?.segments.find((s) => s.stage === "cross");
  const f2l = cfopResult?.segments.find((s) => s.stage === "f2l");
  const oll = cfopResult?.segments.find((s) => s.stage === "oll");
  const pll = cfopResult?.segments.find((s) => s.stage === "pll");
  const previousSolve = recentSolves[recentSolves.length - 1];
  const totalDuration = timer.getDuration();
  const moveCount = state.moves.length;
  const crossMetrics = blockPracticeMode === "cross" ? calculateCrossMetrics(state.moves, totalDuration) : undefined;
  const practiceKind = practiceSession ? "formula" : blockPracticeMode ?? undefined;
  const finalPhase = getCfopPhase(validation.finalFacelets);
  const formulaPracticeSucceeded = reliableMoveStream && practiceCaseVerified && (practiceSession?.formula.category === "F2L"
    ? finalPhase === "f2l" || finalPhase === "oll" || finalPhase === "solved"
    : practiceSession?.formula.category === "OLL"
      ? finalPhase === "oll" || finalPhase === "solved"
      : validation.isSolved);
  const blockPracticeSucceeded = reliableMoveStream && blockPracticeCompleted;

  const input: AnalysisInput = {
    completedAt: Date.now(),
    deviceName: els.deviceName.textContent?.trim() || "未标识魔方",
    deviceId: bleController.getDeviceId(),
    groupId: !practiceKind && !SYSTEM_HISTORY_GROUP_IDS.has(historyController.getSelectedGroup()) ? historyController.getSelectedGroup() : undefined,
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
    inspectionDuration: pendingInspectionDuration > 0 ? pendingInspectionDuration : undefined,
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
      physicalState,
      analysisEligible,
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
  if (stepReview) renderStepReview(stepReview);
  else els.agentOutput.innerHTML = '<p class="placeholder">实体已确认复原；动作流不完整，本把仅保留成绩和 BLE 诊断，不生成复盘建议。</p>';
  renderSolveTimeline(els.solveTimeline, input);
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
  if (analysisEligible) {
    log("状态回放确认已还原；成绩可用于 AO 与 AI");
  } else if (physicalState === "confirmed-solved") {
    log("实体状态确认已复原；成绩已计入 AO，动作流仅保留诊断用途");
  } else if (formulaPracticeSucceeded || blockPracticeSucceeded) {
    log("状态回放确认专项目标完成；已仅计入专项统计");
  } else {
    log(`成绩已保存但未通过状态校验：${validation.anomalies.join("、")}`, "error");
  }
  awaitingNextScramble = !isFormulaAttempt;
  postSolveMove = null;
  pendingInspectionDuration = 0;

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

function renderAnalysisInsight(input: AnalysisInput): string {
  const stages = [
    { label: "Cross", duration: input.crossDuration, moves: input.crossMoves },
    { label: "F2L", duration: input.f2lDuration, moves: input.f2lMoves },
    { label: "OLL", duration: input.ollDuration, moves: input.ollMoves },
    { label: "PLL", duration: input.pllDuration, moves: input.pllMoves },
  ];
  const maxDuration = Math.max(...stages.map((stage) => stage.duration), 1);
  const stageMarkup = stages.map((stage) => `
    <div class="ai-stage-insight">
      <div class="ai-stage-insight-head"><span>${stage.label}</span><strong>${(stage.duration / 1000).toFixed(2)}s</strong></div>
      <div class="ai-stage-bar"><i style="width:${Math.max(4, Math.round((stage.duration / maxDuration) * 100))}%"></i></div>
      <small>${stage.moves} 步</small>
    </div>`).join("");

  const slotMarkup = (input.f2lSlots ?? []).map((slot) => {
    const duration = slot.duration === undefined ? "—" : `${(slot.duration / 1000).toFixed(2)}s`;
    const pauses = slot.pauseCount > 0 ? `停顿 ${slot.pauseCount} 次` : "无长停顿";
    const repairs = slot.repairCount > 0 ? ` · 修复 ${slot.repairCount}` : "";
    return `<div class="ai-slot-insight"><strong>${slot.slot}</strong><span>${duration} · ${slot.moves ?? 0} 步</span><small>${pauses}${repairs}</small></div>`;
  }).join("");
  const slotSection = slotMarkup
    ? `<div class="ai-slot-insights"><div class="ai-insight-label">F2L 四槽位</div><div class="ai-slot-grid">${slotMarkup}</div></div>`
    : "";

  return `
    <section class="ai-insight-panel" aria-label="阶段与槽位数据">
      <div class="ai-insight-heading"><div><span>本把数据画像</span><strong>阶段用时与动作密度</strong></div><em>${(input.tps ?? 0).toFixed(2)} TPS · ${input.moveCount ?? input.moves?.length ?? 0} 步</em></div>
      <div class="ai-stage-insight-grid">${stageMarkup}</div>
      ${slotSection}
    </section>`;
}

function renderAgentResult(result: AnalysisResult, input: AnalysisInput): void {
  const currentBottleneck = extractBottleneck(result.bottleneck, result);
  analysisPreviewPlayers.forEach((player) => player.destroy());
  analysisPreviewPlayers = [];
  const scrambleMoves = input.scramble?.trim().split(/\s+/).filter(Boolean) ?? [];
  const solutionMoves = input.moves ?? [];
  const hasReplay = scrambleMoves.length > 0 && solutionMoves.length > 0;

  const severityBadge = (severity: string): string => {
    const labels: Record<string, string> = { high: "严重", medium: "中等", low: "轻微" };
    return `<span class="severity-badge severity-${severity}">${labels[severity] ?? severity}</span>`;
  };

  const issuesHtml = (result.issues ?? []).map((issue: AnalysisIssue) => `
    <li class="coaching-issue">
      ${severityBadge(issue.severity)}
      <span class="issue-stage">${escapeHtml(issue.stage)}</span>
      <span class="issue-desc">${escapeHtml(issue.description)}</span>
      ${issue.evidence ? `<small class="issue-evidence">${escapeHtml(issue.evidence)}</small>` : ""}
    </li>`).join("");

  const drillsHtml = (result.drills ?? []).map((drill: AnalysisDrill) => `
    <li class="coaching-drill">
      <strong>${escapeHtml(drill.title)}</strong>
      <span>${escapeHtml(drill.detail)}</span>
      ${drill.reps ? `<em class="drill-reps">${escapeHtml(drill.reps)}</em>` : ""}
    </li>`).join("");

  const nextFocusHtml = result.nextFocus
    ? `<div class="coaching-focus"><span class="focus-label">下一把聚焦</span>${escapeHtml(result.nextFocus)}</div>`
    : "";

  const trendHtml = result.trend
    ? `<div class="coaching-trend"><span class="trend-label">趋势</span>${escapeHtml(result.trend)}</div>`
    : "";

  const sourceTag = result.source === "fallback" ? '<span class="source-tag">本地规则</span>' : "";

  els.agentOutput.innerHTML = `
    <div class="analysis-card coaching-card">
      ${renderAnalysisInsight(input)}
      ${nextFocusHtml}
      ${trendHtml}
      ${issuesHtml ? `<div class="analysis-item"><div class="label">问题诊断 ${sourceTag}</div><ul class="coaching-issues">${issuesHtml}</ul></div>` : ""}
      ${drillsHtml ? `<div class="analysis-item"><div class="label">训练处方</div><ul class="coaching-drills">${drillsHtml}</ul></div>` : ""}
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
    const stageDuration = getStageDurationForLibrary(input, currentBottleneck);
    formulaLibrary.openForBottleneck(currentBottleneck, stageDuration, input.totalDuration);
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

function getStageDurationForLibrary(input: AnalysisInput, stage: string): number {
  if (stage === "Cross") return input.crossDuration;
  if (stage === "F2L") return input.f2lDuration;
  if (stage === "OLL") return input.ollDuration;
  if (stage === "PLL") return input.pllDuration;
  return 0;
}

function recordSolve(input: AnalysisInput): void {
  historyStore.add(input);
  recentSolves = historyStore.all;
  historyController.render();
  if (isScoreEligible(input)) historyController.animateRefresh();
}

/** 成绩以实体状态优先；CFOP 与 Agent 则必须使用完整且可回放的动作流。 */
function isScoreEligible(solve: AnalysisInput): boolean {
  return isScoreEligibleByState(solve.physicalState, solve.qualityStatus);
}

function isPracticeSolve(solve: AnalysisInput): boolean {
  return Boolean(solve.practiceKind || solve.practiceMode || solve.practiceFormulaId);
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
    if (!isScoreEligible(solve) || isPracticeSolve(solve) !== isPractice) return false;
    return !isPractice || solve.practiceKind === current.practiceKind;
  });
}

function getSolveResultFeedback(current: AnalysisInput): SolveResultFeedback {
  if (!isScoreEligible(current)) {
    return { label: "本把不计入成绩", detail: "设备数据未通过校验，不参与 PB 和 AO 统计。", isPersonalBest: false };
  }
  if (current.physicalState === "confirmed-solved" && !current.analysisEligible) {
    return { label: "实体复原已确认", detail: "本把已计入 PB 和 AO；动作流不完整，已跳过 CFOP 与 AI 分析。", isPersonalBest: false };
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
  const hint = isSuccess ? "下一题已准备好，完成打乱后转动第一步开始。" : "使用「重新开始本次」保持同一 case，先确认识别再执行。";
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
  const inspectionValue = current.inspectionDuration ? `${(current.inspectionDuration / 1000).toFixed(2)}s` : "—";
  const analysisAvailable = isAnalysisEligible(current.analysisEligible, current.qualityStatus);
  const metrics: { label: string; value: string; current: number; previous?: number; unit: string }[] = [
    { label: "观察", value: inspectionValue, current: current.inspectionDuration ?? 0, previous: previous?.inspectionDuration, unit: "s" },
    { label: "TPS", value: (current.tps ?? 0).toFixed(2), current: current.tps ?? 0, previous: previous?.tps, unit: "" },
    ...(analysisAvailable ? [
      { label: "Cross", value: `${(current.crossDuration / 1000).toFixed(2)}s`, current: current.crossDuration, previous: previous?.crossDuration, unit: "s" },
      { label: "F2L", value: `${(current.f2lDuration / 1000).toFixed(2)}s`, current: current.f2lDuration, previous: previous?.f2lDuration, unit: "s" },
      { label: "OLL", value: `${(current.ollDuration / 1000).toFixed(2)}s`, current: current.ollDuration, previous: previous?.ollDuration, unit: "s" },
      { label: "PLL", value: `${(current.pllDuration / 1000).toFixed(2)}s`, current: current.pllDuration, previous: previous?.pllDuration, unit: "s" },
    ] : []),
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
  const stages = analysisAvailable ? [
    { name: "Cross", duration: current.crossDuration },
    { name: "F2L", duration: current.f2lDuration },
    { name: "OLL", duration: current.ollDuration },
    { name: "PLL", duration: current.pllDuration },
  ].filter((stage) => stage.duration > 0) : [];
  const bottleneck = stages.reduce((slowest, stage) => stage.duration > slowest.duration ? stage : slowest, stages[0]);
  const quality = presentSolveQuality(current.qualityStatus, current.qualityAnomalies);
  const practiceAction = getPracticeResultAction(current);
  const defaultAction = !isScoreEligible(current) ? `
    <div class="result-action-card">
      <span>本把不计入成绩</span>
      <strong>${escapeHtml(quality.label)}</strong>
      <p>${escapeHtml(quality.description)} 请重新生成打乱并从提示的第一步开始执行。</p>
    </div>
  ` : !analysisAvailable ? `
    <div class="result-action-card">
      <span>本把已计分</span>
      <strong>等待 BLE 动作流诊断</strong>
      <p>实体复原已确认；为避免错误建议，本把不拆分 CFOP，也不会进入 AI 训练样本。</p>
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
    formulaLibrary.openForBottleneck(bottleneck.name, bottleneck.duration, current.totalDuration);
  });
}

function formatDelta(current: number, previous: number, unit: string): string {
  const divisor = unit === "s" ? 1000 : 1;
  const delta = (current - previous) / divisor;
  const sign = delta >= 0 ? "+" : "";
  return `(${sign}${delta.toFixed(2)}${unit})`;
}

function closeResultModals(): void {
  els.cfopModal.classList.remove("open");
  els.agentModal.classList.remove("open");
}

els.btnCloseCfop.onclick = closeResultModals;
els.btnCloseAgent.onclick = closeResultModals;

/** 渲染训练计划卡片到 #training-plan-container */
function renderTrainingPlan(): void {
  const plan = loadPlan();
  if (!plan) {
    els.trainingPlanContainer.innerHTML = "";
    return;
  }
  const totalDays = plan.days.length;
  const progress = plan.status === "graduated" ? 100 : Math.round((plan.completedDays / totalDays) * 100);
  const today = getTodayTask(plan);
  const statusText = plan.status === "graduated" ? "已完成" : `第 ${plan.completedDays + 1}/${totalDays} 天`;

  const drillsHtml = today
    ? `<ul class="plan-drills">${today.drills.map((d) => `<li>${escapeHtml(d)}</li>`).join("")}</ul>`
    : "";
  const targetHtml = today ? `<div class="plan-target">目标：${escapeHtml(today.targetMetric)}</div>` : "";
  const todayLabel = plan.status === "graduated" ? "计划已完成，瓶颈已改善" : "今日训练";

  els.trainingPlanContainer.innerHTML = `
    <div class="plan-card ${plan.status === "graduated" ? "graduated" : ""}">
      <div class="plan-header">
        <span class="plan-title">${plan.status === "graduated" ? "训练计划（已毕业）" : "训练计划"}</span>
        <span class="plan-stage-tag">${escapeHtml(plan.targetStage)} · ${statusText}</span>
      </div>
      <div class="plan-progress-bar"><div class="plan-progress-fill" style="width:${progress}%"></div></div>
      <div class="plan-today">
        <div class="plan-today-label">${todayLabel}</div>
        ${drillsHtml}
        ${targetHtml}
      </div>
    </div>`;
}

/** 分析完成后更新训练计划（追加快照 → 更新/生成计划 → 保存 → 重渲染） */
function handlePlanAfterAnalysis(result: AnalysisResult): void {
  appendAnalysisSnapshot(result);
  let plan = loadPlan();
  if (plan && plan.status === "active") {
    plan = updatePlanProgress(plan, result);
    savePlan(plan);
  } else if (!plan) {
    // 没有活跃计划时，积累足够样本后自动生成
    const history = loadAnalysisHistory();
    if (history.length >= 3) {
      const agg = aggregateIssues(snapshotsToResults(history));
      const latestDrills = result.drills;
      plan = generatePlan(agg, latestDrills);
      savePlan(plan);
    }
  }
  renderTrainingPlan();
}

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
  onBeforeAnalyze: (input) => {
    input.sessionContext = loadSessionContext().entries;
  },
  onAfterAnalyze: (result, input) => {
    appendSessionEntry({
      completedAt: Date.now(),
      totalDuration: input.totalDuration,
      bottleneckStage: result.bottleneckStage ?? "",
      topIssue: result.issues?.[0]?.description ?? result.bottleneck,
    });
    handlePlanAfterAnalysis(result);
  },
  onModalOpen: renderTrainingPlan,
});
const cubeEditor = new CubeEditorController({
  elements: {
    cubeEditorPreview: els.cubeEditorPreview,
    cubeEditorPalette: els.cubeEditorPalette,
    cubeEditorStatus: els.cubeEditorStatus,
    cubeAgentPrompt: els.cubeAgentPrompt,
    btnCubeEditorReset: els.btnCubeEditorReset,
    btnCubeEditorSolved: els.btnCubeEditorSolved,
    btnAskCubeAgent: els.btnAskCubeAgent,
  },
  onAsk: (message, facelets, complete) => {
    if (!complete) {
      els.agentOutput.innerHTML = `<p class="placeholder">局面尚未完整。请继续涂完 54 格，再让 Agent 校验和求解。</p>`;
      return;
    }
    const validation = validateCubeEditorFacelets(facelets);
    if (!validation.valid || !validation.normalizedFacelets) {
      els.agentOutput.innerHTML = `<div class="agent-chat-message pending"><strong>CubeMind Agent</strong><p>局面未通过确定性校验：${escapeHtml(validation.issues.join(" "))}</p><p>请修正后再请求解法，避免 AI 对不可达局面编造公式。</p></div>`;
      return;
    }
    const question = message || "请分析这个局面，并给出适合我的 CFOP 解法。";
    els.agentOutput.innerHTML = `<div class="agent-chat-message"><strong>你</strong><p>${escapeHtml(question)}</p><code>${validation.normalizedFacelets}</code></div><div class="agent-chat-message pending"><strong>CubeMind Agent</strong><p>局面颜色和中心朝向已通过校验。下一步将接入 two-phase 求解工具验证可达性，并把可验证解法交给 Agent 解释。</p></div>`;
    log("已将黑色魔方编辑器中的局面发送到 AI 入口");
  },
});
cubeEditor.init();
els.btnCancelPractice.onclick = () => {
  if (formulaLibrary.hasPendingPractice()) {
    formulaLibrary.cancelPractice();
    return;
  }
  pendingPracticeFormula = null;
  pendingPracticeCandidates = [];
  els.practiceModal.classList.remove("open");
};
els.btnClosePractice.onclick = els.btnCancelPractice.onclick;
els.btnStartPractice.onclick = () => {
  if (formulaLibrary.hasPendingPractice()) {
    formulaLibrary.confirmPractice();
    return;
  }
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

// ====== BLE 连接（控制器） ======
const bleController = new BleConnectionController(
  {
    connectionPanel: els.connectionPanel,
    connectionMenu: els.connectionMenu,
    statusBadge: els.statusBadge,
    deviceName: els.deviceName,
    btnDisconnect: els.btnDisconnect,
    capsuleDot: document.getElementById("capsule-dot") ?? undefined,
    capsuleLabel: document.getElementById("capsule-label") ?? undefined,
    driverSlots: new Map([
      ["GAN", { btnConnect: els.btnConnectGan, macInput: els.ganMacInput, btnSetMac: els.btnSetGanMac }],
      ["魔域", { btnConnect: els.btnConnectMoyu, macInput: els.moyuMacInput, btnSetMac: els.btnSetMoyuMac }],
    ]),
  },
  {
    onMove: onCubeMove,
    onDisconnect: (brand) => handleBleDisconnectMidSolve(brand),
    onConnected: (brand) => confirmCubeResetAfterConnect(brand),
    onGyroOrientation: (q) => cubeVisualizer.setDeviceOrientation(q),
    onResetOrientation: () => cubeVisualizer.resetDeviceOrientation(),
    log: (msg, level) => log(msg, level),
  },
  [ganCube, moyuCube],
);
bleController.init();

let isBleDiagnosticRecording = false;
els.btnToggleBleDiagnostics.addEventListener("click", () => {
  if (isBleDiagnosticRecording) {
    if (!bleController.stopPacketRecording()) {
      els.bleDiagnosticsStatus.textContent = "当前连接设备不支持 BLE 原始包录制。";
      return;
    }
    isBleDiagnosticRecording = false;
    els.btnToggleBleDiagnostics.textContent = "开始诊断录制";
    els.bleDiagnosticsStatus.textContent = "录制已停止，可导出 JSON 并反馈给开发者。";
    return;
  }
  if (!bleController.startPacketRecording()) {
    els.bleDiagnosticsStatus.textContent = "当前连接设备不支持 BLE 原始包录制。";
    return;
  }
  isBleDiagnosticRecording = true;
  els.btnToggleBleDiagnostics.textContent = "停止诊断录制";
  els.bleDiagnosticsStatus.textContent = "正在录制 BLE 原始包；请复现一次缺步后停止并导出。";
});

els.btnExportBleDiagnostics.addEventListener("click", () => {
  const recording = bleController.exportPacketRecording();
  if (!recording) {
    els.bleDiagnosticsStatus.textContent = "暂无可导出的诊断包，请先连接 GAN 并开始录制。";
    return;
  }
  const blob = new Blob([recording], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `cubemind-ble-diagnostic-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  els.bleDiagnosticsStatus.textContent = "诊断 JSON 已导出；可附在缺步反馈中。";
});

// 本地真机采样入口：不写入 localStorage，只把当前内存中的 BLE 通知导出为 JSON。
const debugGlobal = globalThis as typeof globalThis & {
  __cubemindGanDiagnostics?: {
    start: () => void;
    stop: () => void;
    export: () => string;
  };
};
debugGlobal.__cubemindGanDiagnostics = {
  start: () => ganCube.startPacketRecording(),
  stop: () => ganCube.stopPacketRecording(),
  export: () => ganCube.exportPacketRecording(),
};

// ====== 键盘快捷键 ======
document.addEventListener("keydown", (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) {
    // 带修饰键的组合键不应触发计时器快捷操作，Alt+A 等组合键交由浏览器或系统处理。
    return;
  }
  if (e.code === "Space" && (!els.btnStart.disabled || !els.btnStop.disabled)) {
    e.preventDefault();
    if (timer.getState().isRunning) els.btnStop.click();
    else if (!els.btnStart.disabled) els.btnStart.click();
  }
  if (e.code === "Escape") {
    els.libraryModal.classList.remove("open");
    closeResultModals();
    els.practiceModeModal.classList.remove("open");
    els.practiceModal.classList.remove("open");
    historyController.closeModal();
  }
});

// ====== 启动 ======
settingsController.init();
formulaLibrary.init();
historyController.init();
newScramble();
if (recentSolves.length > 0) log(` 已加载 ${recentSolves.length} 把历史`);
log("CubeMind 已启动");
log(`当前时间: ${new Date().toLocaleString()}`);
const stats = getLibraryStats();
log(` 公式库：F2L ${stats.F2L} + OLL ${stats.OLL} + PLL ${stats.PLL} = ${stats.total} 个公式`);
