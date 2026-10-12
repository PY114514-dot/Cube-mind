/**
 * composition.ts
 * 控制器装配函数（自 main.ts 抽取，P1 技术债）。
 *
 * main 只保留装配顺序与启动流程；十字训练、AI 分析闭环、局面编辑器与
 * 解法完成流水线四个功能块在此做依赖注入，避免 main 膨胀超过 400 行。
 */

import { els } from "./dom-elements.ts";
import { createCrossSolverController } from "./controllers/cross-solver-controller.ts";
import { createAnalysisRenderer } from "./ui/analysis-renderer.ts";
import { createTrainingController } from "./controllers/training-controller.ts";
import { createPracticeController } from "./core/practice-controller.ts";
import { buildAiPracticeSummary } from "./core/practice-stats.ts";
import { buildAssignmentProgress, enrichFocusFormulas } from "./core/assignment-progress.ts";
import { loadAssignments, markAssignmentPracticed, recordAssignments } from "./core/assignment-store.ts";
import { buildCaseTransferProgress } from "./core/case-transfer.ts";
import { loadTrainingProfile, syncTrainingProfile } from "./core/training-profile-store.ts";
import { loadSessionContext, appendSessionEntry } from "./core/session-context.ts";
import { getFormulaById } from "./formula/formula-library.ts";
import { bindAnalysisController } from "./agent/analysis-controller.ts";
import { CubeEditorController } from "./controllers/cube-editor-controller.ts";
import { validateCubeEditorFacelets } from "./agent/cube-state-tools.ts";
import { createSolveCompletionController } from "./controllers/solve-completion-controller.ts";
import { createTimerController } from "./controllers/timer-controller.ts";
import { createPhaseIndicatorController } from "./controllers/phase-indicator-controller.ts";
import { createMoveController } from "./controllers/move-controller.ts";
import { createConnectSyncController } from "./controllers/connect-sync-controller.ts";
import type { AnalysisInput, AnalysisResult } from "./agent/types.ts";
import type { PracticeRecord } from "./core/practice-stats.ts";
import type { AppState } from "./core/app-state.ts";
import type { SettingsController } from "./controllers/settings-controller.ts";
import type { FormulaLibraryController } from "./controllers/formula-library-controller.ts";
import type { HistoryController } from "./controllers/history-controller.ts";
import type { ScrambleController } from "./controllers/scramble-controller.ts";
import type { BleConnectionController } from "./controllers/ble-connection-controller.ts";
import type { TimerDisplayController } from "./controllers/timer-display-controller.ts";
import type { CubeVisualizer } from "./ui/cube-visualizer.ts";
import type { HistoryStore } from "./core/history-store.ts";
import type { Timer } from "./core/timer.ts";

type LogFn = (msg: string, type?: "info" | "move" | "error") => void;
type EscapeHtml = (s: string) => string;

/** 十字训练设置折叠与求解面板（控制器仅内部使用，不返回）。 */
export function setupCrossSolver(state: AppState, settingsController: SettingsController, escapeHtml: EscapeHtml): void {
  els.btnToggleCrossSettings.onclick = () => {
    const isExpanded = els.btnToggleCrossSettings.getAttribute("aria-expanded") === "true";
    els.btnToggleCrossSettings.setAttribute("aria-expanded", String(!isExpanded));
    els.btnToggleCrossSettings.textContent = isExpanded ? "＋" : "−";
    els.crossTrainingSettings.hidden = isExpanded;
  };
  els.btnCrossHelp.onclick = () => {
    const isExpanded = els.btnCrossHelp.getAttribute("aria-expanded") === "true";
    els.btnCrossHelp.setAttribute("aria-expanded", String(!isExpanded));
    els.crossHelpText.hidden = isExpanded;
  };
  const crossSolverController = createCrossSolverController(
    {
      btnSolveCross: els.btnSolveCross,
      btnSolveXCross: els.btnSolveXCross,
      crossSolution: els.crossSolution,
      xcrossSolution: els.xcrossSolution,
    },
    {
      getCurrentScramble: () => state.scramble.currentScramble,
      getCrossMaxSteps: () => settingsController.getSettings().crossMaxSteps,
      escapeHtml,
    },
  );
  crossSolverController.init();
}

export interface AnalysisFlowDeps {
  state: AppState;
  formulaLibrary: FormulaLibraryController;
  showAgentTab: (tabName: "analysis" | "editor") => void;
  closeResultModals: () => void;
  escapeHtml: EscapeHtml;
  log: LogFn;
  onPrepareScramble: () => void;
}

function addTrainingEvidence(input: AnalysisInput, records: PracticeRecord[], solves: AnalysisInput[]): void {
  input.sessionContext = loadSessionContext().entries;
  // 公式库练习掌握度回流：AI 据此给出有练习证据的建议与公式级指派
  input.practiceSummary = buildAiPracticeSummary(records, (formulaId) => {
    const formula = getFormulaById(formulaId);
    return formula ? { name: formula.name, category: formula.category } : undefined;
  });
  // 训练闭环回流：上次指派效果（成功率变化）随本次分析一起交给 AGENT 评价
  input.assignmentProgress = buildAssignmentProgress(loadAssignments(), records);
  input.caseTransfer = buildCaseTransferProgress(loadAssignments(), solves);
  // 纵向训练档案：分析前把练习记录同步进跨天档案，再注入本次输入
  syncTrainingProfile(records);
  input.trainingProfile = loadTrainingProfile().entries;
}

function recordAnalysisSession(result: AnalysisResult, input: AnalysisInput): void {
  appendSessionEntry({
    completedAt: Date.now(),
    totalDuration: input.totalDuration,
    bottleneckStage: result.bottleneckStage ?? "",
    topIssue: result.issues?.[0]?.description ?? result.bottleneck,
  });
}

/** AI 分析渲染、训练闭环与练习控制器；返回 practiceController 供后续装配。 */
export function setupAnalysisFlow(deps: AnalysisFlowDeps): {
  practiceController: ReturnType<typeof createPracticeController>;
  refreshTraining: () => void;
} {
  const { state, formulaLibrary, showAgentTab, closeResultModals, escapeHtml, log, onPrepareScramble } = deps;

  const analysisRenderer = createAnalysisRenderer({ agentOutput: els.agentOutput }, {
    log,
    escapeHtml,
    formulaLibrary,
  });

  const practiceController = createPracticeController(
    {
      practiceBanner: els.practiceBanner,
      practiceInfo: els.practiceInfo,
      btnRetryPractice: els.btnRetryPractice,
      resultNextAction: els.resultNextAction,
      practiceModal: els.practiceModal,
      libraryModal: els.libraryModal,
    },
    state,
    {
      log,
      onPrepareScramble,
      onCloseResultModals: () => closeResultModals(),
      onFixedFormulaSessionComplete: ({ formula, startedAt }, completedAt) => {
        markAssignmentPracticed({
          formulaId: formula.id,
          stage: formula.category,
          reason: "完成固定 CASE 专项训练",
          assignedAt: startedAt,
        }, completedAt);
        trainingController.renderPlan();
      },
    },
  );

  const trainingController = createTrainingController({
    elements: { trainingPlanContainer: els.trainingPlanContainer, trainingDashboard: els.trainingDashboard },
    formulaLibrary,
    log,
    escapeHtml,
    getPracticeRecords: () => practiceController.getPracticeRecords(),
    getSolves: () => state.recentSolves,
  });

  bindAnalysisController({
    elements: {
      btnOpenAgent: els.btnOpenAgent,
      analysisCount: els.analysisCount,
      analysisSampleStatus: els.analysisSampleStatus,
      btnRunAnalysis: els.btnRunAnalysis,
      agentModal: els.agentModal,
      agentOutput: els.agentOutput,
      agentBackdrop: els.agentBackdrop,
    },
    getRecords: () => state.recentSolves,
    renderResult: (result, input) => {
      // 训练闭环展示：给本次被再指派的公式回填「上次指派时间 + 期间成功率」
      const enriched = enrichFocusFormulas(result, loadAssignments(), practiceController.getPracticeRecords());
      analysisRenderer.renderAgentResult(enriched, input);
    },
    log,
    onBeforeAnalyze: (input) => addTrainingEvidence(input, practiceController.getPracticeRecords(), state.recentSolves),
    onAfterAnalyze: (result, input) => {
      recordAnalysisSession(result, input);
      // 记录本次公式指派，作为下次分析回流效果的时间基准
      recordAssignments(result.focusFormulas ?? [], Date.now());
      trainingController.handlePlanAfterAnalysis(result);
    },
    onModalOpen: () => {
      // 每次打开抽屉固定回到「复盘分析」页，避免残留上次的局面提问页。
      showAgentTab("analysis");
      trainingController.renderPlan();
    },
  });
  return { practiceController, refreshTraining: () => trainingController.renderPlan() };
}

export interface CubeEditorDeps {
  showAgentTab: (tabName: "analysis" | "editor") => void;
  escapeHtml: EscapeHtml;
  log: LogFn;
}

/** 局面编辑器装配（控制器仅内部使用，不返回）。 */
export function setupCubeEditor(deps: CubeEditorDeps): void {
  const { showAgentTab, escapeHtml, log } = deps;
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
      // 校验结果复用抽屉的反馈区，避免让尚未接入求解的入口显示虚假的 AI 回复。
      showAgentTab("analysis");
      if (!complete) {
        els.agentOutput.innerHTML = `<p class="placeholder">局面尚未完整。请继续涂完 54 格，再校验当前局面。</p>`;
        return;
      }
      const validation = validateCubeEditorFacelets(facelets);
      if (!validation.valid || !validation.normalizedFacelets) {
        els.agentOutput.innerHTML = `<div class="agent-chat-message pending"><strong>局面校验</strong><p>${escapeHtml(validation.issues.join(" "))}</p><p>请返回局面编辑器修正。</p></div>`;
        return;
      }
      const note = message ? `<p>备注：${escapeHtml(message)}</p>` : "";
      els.agentOutput.innerHTML = `<div class="agent-chat-message"><strong>局面校验通过</strong><p>颜色、中心朝向及角棱排列均合法。AI 局面求解尚未接入。</p>${note}</div>`;
      log("当前编辑局面已通过本地校验");
    },
  });
  cubeEditor.init();
}

export interface SolvePipelineDeps {
  refreshTraining: () => void;
  state: AppState;
  timer: Timer;
  timerDisplay: TimerDisplayController;
  cubeVisualizer: CubeVisualizer;
  historyStore: HistoryStore;
  bleController: BleConnectionController;
  historyController: HistoryController;
  practiceController: ReturnType<typeof createPracticeController>;
  scrambleController: ScrambleController;
  formulaLibrary: FormulaLibraryController;
  closeResultModals: () => void;
  log: LogFn;
}

function setupTimerRuntime(deps: SolvePipelineDeps, onSolveComplete: (signal: AbortSignal) => Promise<void>) {
  const { state, timer, timerDisplay, cubeVisualizer, log } = deps;
  // CFOP 阶段指示条：纯 DOM 状态映射，先于引用它的 move 控制器装配。
  const phaseIndicatorController = createPhaseIndicatorController({
    cfopPhaseIndicator: els.cfopPhaseIndicator,
  });

  const timerController = createTimerController(
    {
      btnStop: els.btnStop,
      btnReset: els.btnReset,
      cfopOutput: els.cfopOutput,
      agentOutput: els.agentOutput,
    },
    state,
    {
      timer,
      timerDisplay,
      cubeVisualizer,
      solveCompletion: {
        onSolveComplete,
      },
      phaseIndicator: {
        reset: () => phaseIndicatorController.reset(),
      },
      log,
    },
  );
  timerController.init();
  return { timerController, phaseIndicatorController };
}

/** 解法完成流水线、计时会话、Move 编排与连接复位（相互引用，须整体装配）。 */
export function setupSolvePipeline(deps: SolvePipelineDeps): {
  timerController: ReturnType<typeof createTimerController>;
  moveController: ReturnType<typeof createMoveController>;
  connectSyncController: ReturnType<typeof createConnectSyncController>;
  phaseIndicatorController: ReturnType<typeof createPhaseIndicatorController>;
} {
  const {
    state, timer, timerDisplay, cubeVisualizer, historyStore, bleController,
    historyController, practiceController, scrambleController, closeResultModals, log,
  } = deps;

  const solveCompletionController = createSolveCompletionController(
    els,
    state,
    {
      timer,
      historyStore,
      getCaseReference: (caseId) => deps.formulaLibrary.getCaseReference(caseId),
      ble: {
        requestCurrentFacelets: () => bleController.requestCurrentFacelets(),
        allowsUnverifiedMoveScore: () => bleController.allowsUnverifiedMoveScore(),
        getDeviceId: () => bleController.getDeviceId(),
      },
      history: {
        getSelectedGroup: () => historyController.getSelectedGroup(),
        render: () => { historyController.render(); deps.refreshTraining(); },
        animateRefresh: () => historyController.animateRefresh(),
      },
      practice: {
        completeAttempt: () => practiceController.completeAttempt(),
        updateBanner: () => practiceController.updateBanner(),
      },
      log,
    },
  );

  const { timerController, phaseIndicatorController } = setupTimerRuntime(deps, (signal) => solveCompletionController.onSolveComplete(signal));

  const moveController = createMoveController(state, {
    timer,
    cubeVisualizer,
    scramble: {
      cancelGeneration: () => scrambleController.cancelGeneration(),
      newScramble: () => scrambleController.newScramble(),
      updateOnMove: (move) => scrambleController.updateOnMove(move),
      verifyCompleted: () => scrambleController.verifyCompleted(),
      verifyPhysicalAndBeginInspection: () => scrambleController.verifyPhysicalAndBeginInspection(),
    },
    timerController: {
      startSolveTimer: (fromMove) => timerController.startSolveTimer(fromMove),
      stopSolveTimerAndAnalyze: (waitForLateMove) => timerController.stopSolveTimerAndAnalyze(waitForLateMove),
    },
    phaseIndicator: {
      show: (phase) => phaseIndicatorController.show(phase),
      complete: (phase) => phaseIndicatorController.complete(phase),
    },
    closeResultModals: () => closeResultModals(),
    log,
  });

  const connectSyncController = createConnectSyncController(
    { btnStop: els.btnStop },
    state,
    {
      timer,
      timerDisplay,
      cubeVisualizer,
      scramble: {
        newScramble: () => scrambleController.newScramble(),
      },
      ble: {
        requestCurrentFacelets: () => bleController.requestCurrentFacelets(),
      },
      log,
    },
  );

  return { timerController, moveController, connectSyncController, phaseIndicatorController };
}
