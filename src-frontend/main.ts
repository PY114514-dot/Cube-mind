/**
 * src/main.ts
 * CubeMind 应用入口（前端 UI 控制器，composition root）
 *
 * 职责：
 *   - 初始化所有模块
 *   - 监听 DOM 事件
 *   - 协调 BLE、打乱、计时、CFOP、AGENT、公式库的数据流
 *
 * P1 技术债拆分后：DOM 引用表在 dom-elements.ts；十字训练 / AI 分析闭环 /
 * 局面编辑器 / 解法完成流水线的装配在 composition.ts，本文件只保留装配顺序。
 */

import { Timer } from "./core/timer.ts";
import { getLibraryStats } from "./formula/formula-library.ts";
import { CubeVisualizer } from "./ui/cube-visualizer.ts";
import { HistoryController } from "./controllers/history-controller.ts";
import { HistoryStore } from "./core/history-store.ts";
import { BleConnectionController } from "./controllers/ble-connection-controller.ts";
import { ganCube } from "./ble/gan-cube-protocol.ts";
import { moyuCube } from "./ble/moyu-cube-protocol.ts";
import { TimerDisplayController } from "./controllers/timer-display-controller.ts";
import { FormulaLibraryController } from "./controllers/formula-library-controller.ts";
import { SettingsController } from "./controllers/settings-controller.ts";
import { bindAgentTabs } from "./agent/analysis-controller.ts";
import { createInitialState, type AppState } from "./core/app-state.ts";
import { createScrambleController } from "./controllers/scramble-controller.ts";
import { createPracticeEntryController } from "./controllers/practice-entry-controller.ts";
import { createDiagnosticsController } from "./controllers/diagnostics-controller.ts";
import { createKeyboardShortcutsController } from "./controllers/keyboard-shortcuts-controller.ts";
import { createSolveReviewController } from "./controllers/solve-review-controller.ts";
import { createReviewTarget } from "./core/solve-review-session.ts";
import { buildF2lSolutions } from "./core/f2l-solution-coach.ts";
import { closeResultModals, els, escapeHtml, log } from "./dom-elements.ts";
import { setupAnalysisFlow, setupCrossSolver, setupCubeEditor, setupSolvePipeline } from "./composition.ts";

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
  onStartPractice: (formula, target, candidates, order) => practiceController.start(formula, target, candidates, order),
  getPracticeRecords: () => practiceController.getPracticeRecords(),
});
const historyController = new HistoryController({
  historyToday: els.historyToday,
  statLast: els.statLast,
  statAo5: els.statAo5,
  statCount: els.statCount,
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
  getRecords: () => state.recentSolves,
  getF2lSolutions: (solve) => buildF2lSolutions(solve, formulaLibrary.getF2lAlgorithms()),
  onRetry: (solve) => {
    const target = createReviewTarget(solve);
    if (target) reviewController.start([target]);
  },
  onDelete: (index) => {
    if (!historyStore.remove(index)) return;
    state.recentSolves = historyStore.all;
    historyController.render();
    refreshTraining();
    reviewController.render();
    log("已删除历史记录");
  },
  onSave: () => historyStore.save(),
});
const cubeVisualizer = new CubeVisualizer(els.cube3d, { role: "stage", initialRotationX: -26, initialRotationY: -35 });
els.btnOpenConnection.onclick = () => {
  els.connectionMenu.open = true;
  els.connectionMenu.querySelector("summary")?.focus();
};
els.btnCalibrateGyro.onclick = () => {
  const calibrated = cubeVisualizer.calibrateDeviceOrientation();
  log(calibrated
    ? "持握已校准：白面朝上、黄面朝下为 3D 魔方基准"
    : "尚未收到陀螺仪姿态，请连接支持陀螺仪的智能魔方后再校准", calibrated ? "info" : "error");
};
const timerDisplay = new TimerDisplayController(timer, {
  timerDisplay: els.timerDisplay,
  inspectionStatus: els.inspectionStatus,
}, {
  isPracticeObservation: () => state.practice.session !== null || state.practice.blockMode !== null || state.review !== null,
  getInspectionSettings: () => { const s = settingsController.getSettings(); return { enabled: s.inspectionEnabled, seconds: s.inspectionSeconds }; },
  log: (msg, level) => log(msg, level),
});
const historyStore = HistoryStore.load((message) => {
  log(message, "error");
  window.alert(message);
});
const state: AppState = createInitialState(historyStore.all);

// ====== 十字训练（composition） ======
const crossSolverController = setupCrossSolver(state, settingsController, formulaLibrary, (scramble) => {
  if (timer.getState().isRunning || state.solve.isFinalizing) return false;
  closeResultModals();
  scrambleController.prepareBlockScramble("xcross", scramble);
  return true;
});

// ====== AI 分析 / 训练闭环（composition） ======
els.btnCloseCfop.onclick = closeResultModals;
els.btnCloseAgent.onclick = closeResultModals;
// 点击轻遮罩也关闭抽屉（遮罩只覆盖抽屉开启时的页面区域）。
els.agentBackdrop.onclick = closeResultModals;
// AI 教练抽屉标签页切换；返回的 showAgentTab 供局面提问等流程切回复盘页。
const showAgentTab = bindAgentTabs(els.agentModal);

const { practiceController, refreshTraining } = setupAnalysisFlow({
  state,
  formulaLibrary,
  showAgentTab,
  closeResultModals,
  escapeHtml,
  log,
  onPrepareScramble: () => scrambleController.preparePracticeScramble(),
  onReview: (target) => reviewController.start([target]),
});

// ====== 局面编辑器（composition） ======
setupCubeEditor({ showAgentTab, escapeHtml, log });

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
    onMove: (move) => moveController.onCubeMove(move),
    onMoveStreamGap: (gap) => {
      if (timer.getState().isRunning) state.solve.hasPermanentMoveGap = true;
      log(`设备动作缺口：缺少 ${gap.missing} 步（${gap.previousMoveCnt} → ${gap.nextMoveCnt}），本把将只保留实体成绩。`, "error");
    },
    onDisconnect: (brand) => {
      scrambleController.cancelPhysicalVerification();
      timerController.abortOnDisconnect(brand);
      reviewController.cancel();
    },
    onConnected: (brand) => {
      void connectSyncController.confirmCubeResetAfterConnect(brand);
    },
    onGyroOrientation: (q) => cubeVisualizer.setDeviceOrientation(q),
    onResetOrientation: () => cubeVisualizer.resetDeviceOrientation(),
    log: (msg, level) => log(msg, level),
  },
  [ganCube, moyuCube],
);
bleController.init();

// 打乱生命周期：依赖 timer/timerDisplay/cubeVisualizer/practiceController/bleController，须在其后装配。
const scrambleController = createScrambleController(
  {
    scrambleText: els.scrambleText,
    btnNextScramble: els.btnNextScramble,
    btnToggleScrambleSteps: els.btnToggleScrambleSteps,
    crossStepSelector: els.crossStepSelector,
    btnStop: els.btnStop,
  },
  state,
  {
    timer,
    timerDisplay,
    cubeVisualizer,
    ble: {
      requestCurrentFacelets: () => bleController.requestCurrentFacelets(),
    },
    practice: {
      updateBanner: () => practiceController.updateBanner(),
    },
    onNewScramble: () => { phaseIndicatorController.reset(); crossSolverController.invalidate(); },
    onReviewNext: () => reviewController.next(),
    onLeaveReview: () => reviewController.cancel(),
    escapeHtml,
    log: (msg, type) => log(msg, type),
  },
);
scrambleController.init();

const reviewController = createSolveReviewController(els, state, {
  isRunning: () => timer.getState().isRunning,
  loadScramble: (scramble) => scrambleController.retryHistoryScramble(scramble),
  newScramble: () => scrambleController.newScramble(),
  updatePracticeBanner: () => practiceController.updateBanner(),
  closeOverlays: () => {
    closeResultModals();
    historyController.closeModal();
    els.libraryModal.classList.remove("open");
    els.practiceModal.classList.remove("open");
    els.practiceModeModal.classList.remove("open");
  },
  escapeHtml, log,
});

// 练习入口：依赖 practiceController/formulaLibrary/scrambleController，须在其后装配。
const practiceEntryController = createPracticeEntryController(
  {
    practiceModeModal: els.practiceModeModal,
    formulaPracticeDifficulty: els.formulaPracticeDifficulty,
    formulaPracticeUnmastered: els.formulaPracticeUnmastered,
    formulaPracticeOrder: els.formulaPracticeOrder,
    practiceFormulaName: els.practiceFormulaName,
    practiceModal: els.practiceModal,
    practiceCount: els.practiceCount,
    btnOpenPracticeMode: els.btnOpenPracticeMode,
    btnClosePracticeMode: els.btnClosePracticeMode,
    btnStartDailyPractice: els.btnStartDailyPractice,
    btnCancelPractice: els.btnCancelPractice,
    btnClosePractice: els.btnClosePractice,
    btnStartPractice: els.btnStartPractice,
    btnEndPractice: els.btnEndPractice,
    btnRetryPractice: els.btnRetryPractice,
  },
  state,
  {
    practice: {
      start: (formula, target, candidates, order) => practiceController.start(formula, target, candidates, order),
      getPracticeRecords: () => practiceController.getPracticeRecords(),
      finish: () => practiceController.finish(),
      handleRetry: () => practiceController.handleRetry(),
    },
    formulaLibrary: {
      resolvePracticeFormula: (formula) => formulaLibrary.resolvePracticeFormula(formula),
      isMastered: (id) => formulaLibrary.isMastered(id),
      hasPendingPractice: () => formulaLibrary.hasPendingPractice(),
      cancelPractice: () => formulaLibrary.cancelPractice(),
      confirmPractice: () => formulaLibrary.confirmPractice(),
    },
    scramble: {
      prepareBlockScramble: (mode) => scrambleController.prepareBlockScramble(mode),
      endBlockPractice: () => scrambleController.endBlockPractice(),
    },
    openPrediction: () => crossSolverController.open(),
    isRunning: () => timer.getState().isRunning || state.solve.isFinalizing,
    log: (msg, type) => log(msg, type),
  },
);
practiceEntryController.init();

// 解法完成流水线 / 计时会话 / Move 编排 / 连接复位（composition，须整体装配）。
const { timerController, moveController, connectSyncController, phaseIndicatorController } = setupSolvePipeline({
  refreshTraining: () => { refreshTraining(); reviewController.render(); },
  reviewController,
  state,
  timer,
  timerDisplay,
  cubeVisualizer,
  historyStore,
  bleController,
  historyController,
  practiceController,
  scrambleController,
  formulaLibrary,
  closeResultModals,
  log,
});

// BLE 诊断面板：依赖 bleController/ganCube，须在其后装配。
const diagnosticsController = createDiagnosticsController(
  {
    btnToggleBleDiagnostics: els.btnToggleBleDiagnostics,
    btnExportBleDiagnostics: els.btnExportBleDiagnostics,
    btnExportBleReplay: els.btnExportBleReplay,
    bleDiagnosticsStatus: els.bleDiagnosticsStatus,
  },
  state,
  {
    ble: {
      startPacketRecording: () => bleController.startPacketRecording(),
      stopPacketRecording: () => bleController.stopPacketRecording(),
      exportPacketRecording: () => bleController.exportPacketRecording(),
      exportReplayFixture: () => bleController.exportReplayFixture(),
    },
    debugHarness: {
      startPacketRecording: () => ganCube.startPacketRecording(),
      stopPacketRecording: () => ganCube.stopPacketRecording(),
      exportPacketRecording: () => ganCube.exportPacketRecording(),
    },
  },
);
diagnosticsController.init();

// 键盘快捷键：依赖 timer/closeResultModals/historyController，须在其后装配。
const keyboardShortcutsController = createKeyboardShortcutsController(
  {
    btnStop: els.btnStop,
    btnCloseLibrary: els.btnCloseLibrary,
    practiceModeModal: els.practiceModeModal,
    practiceModal: els.practiceModal,
  },
  {
    timer,
    closeResultModals: () => closeResultModals(),
    history: {
      closeModal: () => historyController.closeModal(),
    },
  },
);
keyboardShortcutsController.init();

// ====== 启动 ======
settingsController.init();
formulaLibrary.init();
historyController.init();
reviewController.init();
refreshTraining();
void scrambleController.newScramble();
if (state.recentSolves.length > 0) log(` 已加载 ${state.recentSolves.length} 把历史`);
log("CubeMind 已启动");
log(`当前时间: ${new Date().toLocaleString()}`);
const stats = getLibraryStats();
log(` 公式库：F2L ${stats.F2L} + OLL ${stats.OLL} + PLL ${stats.PLL} = ${stats.total} 个公式`);
