/**
 * dom-elements.ts
 * 页面 DOM 引用表与通用工具（$ 查询、escapeHtml、closeResultModals、log）。
 *
 * 拆自 main.ts（P1 技术债）：main 只做装配与启动，DOM 引用和日志工具
 * 收敛于此，供 composition.ts 与 main.ts 共用。
 */

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

export const els = {
  scrambleText: $("scramble-text") as HTMLDivElement,
  btnNextScramble: $("btn-next-scramble") as HTMLButtonElement,
  btnToggleScrambleSteps: $("btn-toggle-scramble-steps") as HTMLButtonElement,
  btnToggleCrossSettings: $("btn-toggle-cross-settings") as HTMLButtonElement,
  btnCrossHelp: $("btn-cross-help") as HTMLButtonElement,
  crossHelpText: $("cross-help-text") as HTMLParagraphElement,
  crossTrainingSettings: $("cross-training-settings") as HTMLDivElement,
  crossStepSelector: $("cross-step-selector") as HTMLDivElement,
  btnSolveCross: $("btn-solve-cross") as HTMLButtonElement,
  btnSolveXCross: $("btn-solve-xcross") as HTMLButtonElement,
  btnPredictCross: $("btn-predict-cross") as HTMLButtonElement,
  crossCoachDialog: $("cross-coach-dialog") as HTMLDialogElement,
  btnOpenLibrary: $("btn-open-library") as HTMLButtonElement,
  btnOpenPracticeMode: $("btn-open-practice-mode") as HTMLButtonElement,
  btnOpenSettings: $("btn-open-settings") as HTMLButtonElement,
  btnOpenConnection: $("btn-open-connection") as HTMLButtonElement,
  trainingDashboard: $("training-dashboard") as HTMLDivElement,
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
  statLast: $("stat-last") as HTMLElement,
  statAo5: $("stat-ao5") as HTMLElement,
  statCount: $("stat-count") as HTMLElement,
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
  reviewHome: $("review-home") as HTMLDivElement,
  reviewBanner: $("review-banner") as HTMLDivElement,
  reviewInfo: $("review-info") as HTMLElement,
  reviewSummary: $("review-summary") as HTMLElement,
  btnStartReview: $("btn-start-review") as HTMLButtonElement,
  btnEndReview: $("btn-end-review") as HTMLButtonElement,
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
  btnExportBleReplay: $("btn-export-ble-replay") as HTMLButtonElement,
  bleDiagnosticsStatus: $("ble-diagnostics-status") as HTMLElement,
  performanceChart: $("performance-chart") as unknown as SVGSVGElement,
  performanceMean: $("performance-mean") as HTMLElement,
  performanceStd: $("performance-std") as HTMLElement,
  cube3d: $("cube-3d") as HTMLDivElement,
  btnCalibrateGyro: $("btn-calibrate-gyro") as HTMLButtonElement,
  timerDisplay: $("timer-display") as HTMLDivElement,
  inspectionStatus: $("inspection-status") as HTMLParagraphElement,
  cfopPhaseIndicator: $("cfop-phase-indicator") as HTMLDivElement,
  timerHint: $("timer-hint") as HTMLParagraphElement,
  btnStop: $("btn-stop") as HTMLButtonElement,
  btnReset: $("btn-reset") as HTMLButtonElement,
  cfopOutput: $("cfop-output") as HTMLPreElement,
  cfopSummary: $("cfop-summary") as HTMLDivElement,
  resultNextAction: $("result-next-action") as HTMLDivElement,
  f2lSolutions: $("f2l-solutions") as HTMLDivElement,
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
  agentBackdrop: $("agent-backdrop") as HTMLElement,
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
  btnRetryPractice: $("btn-retry-practice") as HTMLButtonElement,
  btnEndPractice: $("btn-end-practice") as HTMLButtonElement,
  practiceModal: $("practice-modal") as HTMLDivElement,
  practiceFormulaName: $("practice-formula-name") as HTMLElement,
  practiceCount: $("practice-count") as HTMLInputElement,
  btnStartPractice: $("btn-start-practice") as HTMLButtonElement,
  btnCancelPractice: $("btn-cancel-practice") as HTMLButtonElement,
  btnClosePractice: $("btn-close-practice") as HTMLButtonElement,
};

export function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

export function closeResultModals(): void {
  els.cfopModal.classList.remove("open");
  els.agentModal.classList.remove("open");
  els.agentBackdrop.classList.remove("open");
}

export function log(msg: string, type: "info" | "move" | "error" = "info"): void {
  const time = new Date().toLocaleTimeString();
  const line = document.createElement("div");
  line.className = `log-line ${type}`;
  line.textContent = `[${time}] ${msg}`;
  els.log.appendChild(line);
  els.log.scrollTop = els.log.scrollHeight;
}
