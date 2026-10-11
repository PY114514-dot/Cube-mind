/**
 * 解法完成处理：把计时器数据、BLE 实体状态、CFOP 分析与成绩记录串成一条完成流水线。
 *
 * 从 main.ts 抽出。所有外部依赖（Timer / History / BLE / 练习控制器）通过结构接口注入，
 * 本模块不直接依赖具体控制器实现。
 */

import type { AppState } from "../core/app-state.ts";
import type { AnalysisInput } from "../agent/types.ts";
import type { Timer } from "../core/timer.ts";
import type { HistoryStore } from "../core/history-store.ts";
import { analyzeCompletedSolve, type CompletedSolveAnalysis } from "../core/completed-solve-analysis.ts";
import type { CaseEventAssemblyInput } from "../core/case-event-assembly.ts";
import { buildCompletedSolveRecord } from "../core/completed-solve-record.ts";
import { buildSolveCompletionPlan, type SolveCompletionPlan } from "../core/solve-completion-plan.ts";
import { summarizePrettyReconstruction } from "../core/move-reconstruction.ts";
import { formatCfop } from "../core/cfop-parser.ts";
import { formatF2lSlotAnalysis } from "../core/f2l-slot-tracker.ts";
import { renderSolveSummary, renderStepReview } from "../ui/solve-result-renderer.ts";
import { renderSolveTimeline } from "../ui/solve-timeline.ts";
import { resolvePersistedSolveTrust, type PhysicalCubeState } from "../core/solve-validation.ts";
import { sendDiagnosticEvent, type DiagnosticMode } from "../core/diagnostics-client.ts";
import { SOLVED_FACELET } from "../utils/mathlib.ts";
import { SYSTEM_HISTORY_GROUP_IDS } from "./history-controller.ts";

export interface SolveCompletionElements {
  cfopOutput: HTMLElement;
  cfopModal: HTMLElement;
  cfopSummary: HTMLElement;
  resultNextAction: HTMLElement;
  agentOutput: HTMLElement;
  solveTimeline: HTMLElement;
  deviceName: HTMLElement;
}

/** BLE 连接控制器中本模块需要的只读能力。 */
export interface SolveCompletionBle {
  requestCurrentFacelets: () => Promise<string | null>;
  allowsUnverifiedMoveScore: () => boolean;
  getDeviceId: () => string | undefined;
}

/** 历史控制器中本模块需要的能力。 */
export interface SolveCompletionHistory {
  getSelectedGroup: () => string;
  render: () => void;
  animateRefresh: () => void;
}

/** 练习控制器中本模块需要的能力。 */
export interface SolveCompletionPractice {
  completeAttempt: () => boolean;
  updateBanner: () => void;
}

export interface SolveCompletionDependencies {
  timer: Timer;
  historyStore: HistoryStore;
  ble: SolveCompletionBle;
  history: SolveCompletionHistory;
  practice: SolveCompletionPractice;
  getCaseReference: CaseEventAssemblyInput["getCaseReference"];
  log: (msg: string, type?: "info" | "move" | "error") => void;
}

function getUnavailableCfopMessage(
  trustState: "analysis-ready" | "score-only" | "rejected",
  physicalState: "confirmed-solved" | "confirmed-unsolved" | "unavailable",
): string {
  if (trustState === "score-only") {
    if (physicalState === "unavailable") {
      return "GAN v4 未提供可验证实体局面，且动作回放没有闭合页面打乱。\n本把已按连续动作计入 PB/AO；不生成 CFOP、F2L 槽位、停顿或 AI 分析。";
    }
    return "实体复原已确认，但动作流不完整。\n本把已计入 PB/AO；不生成 CFOP、F2L 槽位、停顿或 AI 分析。";
  }
  return "实体局面未能确认复原，且动作流无法完整回放。\n本把不计入 PB/AO；请重新生成打乱并从提示的第一步开始执行。";
}

/** 成绩以实体状态优先；CFOP 与 Agent 则必须使用完整且可回放的动作流。 */
function isScoreEligible(solve: AnalysisInput): boolean {
  return resolvePersistedSolveTrust(solve).scoreEligible;
}

function showCompletedAnalysis(
  els: SolveCompletionElements, state: AppState, deps: SolveCompletionDependencies,
  analysis: CompletedSolveAnalysis, physicalState: PhysicalCubeState,
): void {
  const { trust, cfopResult, f2lSlotAnalysis } = analysis;
  if (trust.state === "score-only") {
    deps.log(physicalState === "unavailable"
      ? "GAN v4 未提供可验证实体局面；连续动作已计分，但动作回放未闭合，不生成 CFOP/AI 分析"
      : "实体魔方已确认复原；本把计入成绩，但动作流不完整，不生成 CFOP/AI 分析", "error");
  } else if (trust.state === "rejected" && physicalState === "confirmed-unsolved") {
    deps.log("设备状态回读确认未复原，本把不计入成绩", "error");
  }
  const prettySummary = summarizePrettyReconstruction(state.solve.events);
  if (prettySummary) deps.log(prettySummary);
  const detailTitle = els.cfopModal.querySelector<HTMLElement>(".result-section-title");
  const isFocusedFormulaPractice = state.practice.session !== null;
  if (detailTitle) detailTitle.hidden = isFocusedFormulaPractice;
  els.cfopOutput.hidden = isFocusedFormulaPractice;
  els.cfopOutput.textContent = cfopResult && f2lSlotAnalysis
    ? `总用时: ${(deps.timer.getDuration() / 1000).toFixed(2)}s\n${formatCfop(cfopResult)}\n\n${formatF2lSlotAnalysis(f2lSlotAnalysis)}`
    : getUnavailableCfopMessage(trust.state, physicalState);
  els.cfopModal.classList.add("open");
  if (cfopResult) deps.log(`CFOP 识别完成: ${cfopResult.segments.length} 个阶段`);
}

function finishRecordedSolve(state: AppState, deps: SolveCompletionDependencies, input: AnalysisInput, plan: SolveCompletionPlan): void {
  const saved = deps.historyStore.add(input);
  state.recentSolves = deps.historyStore.all;
  deps.history.render();
  if (isScoreEligible(input)) deps.history.animateRefresh();
  const diagnosticMode: DiagnosticMode = state.practice.session ? "formula" : state.practice.blockMode ?? "normal";
  void sendDiagnosticEvent({
    kind: "solve", occurredAt: input.completedAt ?? Date.now(),
    scramble: input.scramble ?? state.scramble.progress.completed.join(" "),
    mode: diagnosticMode, formulaId: state.practice.session?.formula.id,
    moves: input.moves, totalDuration: input.totalDuration,
    qualityStatus: input.qualityStatus, qualityAnomalies: input.qualityAnomalies,
  });
  if (state.practice.session) {
    if (plan.formulaAttemptAction === "complete") deps.practice.completeAttempt();
    else if (plan.formulaAttemptAction === "retry") {
      state.practice.needsRetry = true;
      deps.practice.updateBanner();
      deps.log(`专项练习失败：${state.practice.session.formula.id}，可重新开始本次`, "error");
    }
  }
  deps.log(plan.statusMessage, plan.statusLevel);
  state.practice.awaitingNextScramble = plan.awaitingNextScramble;
  state.practice.postSolveMove = null;
  state.solve.hasPermanentMoveGap = false;
  state.solve.inspectionDuration = 0;
  deps.log(saved ? "成绩已保存；点击右下角 AI 可按需分析历史成绩" : "成绩仅保留在本次页面，请导出 JSON 备份", saved ? "info" : "error");
}

export function createSolveCompletionController(els: SolveCompletionElements, state: AppState, deps: SolveCompletionDependencies) {
  async function onSolveComplete(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    const timerState = deps.timer.getState();
    const practiceSession = state.practice.session;
    const scrambleProgress = state.scramble.progress;
    const isFormulaAttempt = state.practice.session !== null;
    const formulaPractice = state.practice.session?.formula;
    if (timerState.moves.length === 0) {
      deps.log("无 move 数据，无法分析", "error");
      return;
    }

    const moveTimes = timerState.moves.map((m) => m.timestamp);
    const hardwareFacelets = await deps.ble.requestCurrentFacelets();
    // 回读可能跨越重置、断连或训练切换，过期结果不能修改 UI、历史与新一轮状态。
    if (signal.aborted || deps.timer.getState() !== timerState || state.practice.session !== practiceSession
      || state.scramble.progress !== scrambleProgress) return;
    const physicalState = hardwareFacelets === null
      ? "unavailable"
      : hardwareFacelets === SOLVED_FACELET ? "confirmed-solved" : "confirmed-unsolved";
    const completedAnalysis = analyzeCompletedSolve({
      scrambleMoves: state.scramble.progress.completed,
      moveEvents: state.solve.events,
      moveTimes,
      moveGaps: timerState.moves.map((move) => move.gapFromPrev),
      solveStartTime: timerState.startTime,
      solveEndTime: timerState.endTime,
      physicalState,
      getCaseReference: deps.getCaseReference,
      allowUnverifiedMoveScore: deps.ble.allowsUnverifiedMoveScore(),
      externalAnomalies: state.solve.hasPermanentMoveGap ? ["missing-event"] : [],
    });
    const { validation, trust: solveTrust, stepReview } = completedAnalysis;
    const analysisEligible = solveTrust.analysisEligible;
    showCompletedAnalysis(els, state, deps, completedAnalysis, physicalState);

    const previousSolve = state.recentSolves[state.recentSolves.length - 1];
    const totalDuration = deps.timer.getDuration();
    const practiceKind = state.practice.session ? "formula" : state.practice.blockMode ?? undefined;
    const completedRecord = buildCompletedSolveRecord({
      completedAt: Date.now(),
      deviceName: els.deviceName.textContent?.trim() || "未标识魔方",
      deviceId: deps.ble.getDeviceId(),
      groupId: !practiceKind && !SYSTEM_HISTORY_GROUP_IDS.has(deps.history.getSelectedGroup()) ? deps.history.getSelectedGroup() : undefined,
      scrambleMoves: state.scramble.progress.completed,
      moves: timerState.moves,
      solveStartTime: timerState.startTime,
      solveEndTime: timerState.endTime,
      totalDuration,
      inspectionDuration: state.solve.inspectionDuration > 0 ? state.solve.inspectionDuration : undefined,
      penalty: state.solve.inspectionPenalty,
      physicalState,
      analysis: completedAnalysis,
      blockPractice: state.practice.blockMode ? { mode: state.practice.blockMode, completed: state.practice.blockCompleted } : undefined,
      formulaPractice: state.practice.session ? {
        category: state.practice.session.formula.category,
        formulaId: state.practice.session.formula.id,
        caseVerified: state.practice.caseVerified,
      } : undefined,
    });
    const { input, formulaPracticeSucceeded, blockPracticeSucceeded } = completedRecord;
    const completionPlan = buildSolveCompletionPlan({
      analysisEligible,
      physicalState,
      validationAnomalies: validation.anomalies,
      isFormulaAttempt,
      formulaPracticeSucceeded,
      blockPracticeSucceeded,
    });

    const resultElements = { summary: els.cfopSummary, nextAction: els.resultNextAction, agentOutput: els.agentOutput };
    renderSolveSummary(resultElements, input, previousSolve, state.recentSolves, formulaPractice?.category);
    renderStepReview(resultElements, stepReview, formulaPractice?.category);
    renderSolveTimeline(els.solveTimeline, input, { focusStage: formulaPractice?.category });
    finishRecordedSolve(state, deps, input, completionPlan);
  }

  return { onSolveComplete };
}
