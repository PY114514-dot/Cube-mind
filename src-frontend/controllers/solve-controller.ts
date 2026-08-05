/**
 * solve-controller.ts
 * 解法完成处理、CFOP 分析与渲染控制器
 */

import { Timer } from "../core/timer.ts";
import { parseCfop, formatCfop, type CfopResult } from "../core/cfop-parser.ts";
import { analyzeSolveSteps, type SolveReview } from "../core/solve-review.ts";
import { analyzeF2lSlots, formatF2lSlotAnalysis } from "../core/f2l-slot-tracker.ts";
import { validateSolve } from "../core/solve-validation.ts";
import { getCfopPhase } from "../core/cstimer-cfop.ts";
import { calculateCrossMetrics } from "../core/cross-metrics.ts";
import { isMoveStreamReliable, isSolveEligible } from "../core/solve-validation.ts";
import { extractBottleneck } from "../agent/analysis-input.ts";
import { summarizePrettyReconstruction } from "../core/move-reconstruction.ts";
import { presentSolveQuality } from "../core/data-quality.ts";
import { formatWcaSolveTime, calculateWcaAverage, getWcaScore } from "../core/wca-average.ts";
import type { CubeMove } from "../ble/gan-cube-protocol.ts";
import type { AnalysisInput, AnalysisResult, AnalysisIssue, AnalysisDrill } from "../agent/types.ts";
import type { ScrambleState, PracticeSession } from "./scramble-controller.ts";
import type { TimerDisplayController } from "./timer-display-controller.ts";
import type { CubeVisualizer } from "../ui/cube-visualizer.ts";
import type { HistoryController } from "./history-controller.ts";
import type { InspectionPenalty } from "../core/inspection-rules.ts";
import { SolveReplayPlayer } from "../ui/solve-replay-player.ts";

export interface SolveControllerElements {
  btnStart: HTMLButtonElement;
  btnStop: HTMLButtonElement;
  btnReset: HTMLButtonElement;
  cfopOutput: HTMLPreElement;
  cfopSummary: HTMLDivElement;
  resultNextAction: HTMLDivElement;
  agentOutput: HTMLDivElement;
  cfopModal: HTMLDivElement;
  btnCloseCfop: HTMLButtonElement;
  deviceName: HTMLSpanElement;
}

export interface SolveControllerOptions {
  elements: SolveControllerElements;
  timer: Timer;
  timerDisplay: TimerDisplayController;
  cubeVisualizer: CubeVisualizer;
  historyController: HistoryController;
  getScrambleState: () => ScrambleState;
  getPracticeSession: () => PracticeSession;
  getPracticeNeedsRetry: () => boolean;
  setPracticeNeedsRetry: (v: boolean) => void;
  getPracticeCaseVerified: () => boolean;
  setPracticeCaseVerified: (v: boolean) => void;
  getBlockPracticeMode: () => "cross" | "f2l" | "cross-f2l" | null;
  onScrambleMove: (move: string) => void;
  getHistoryStore: () => { add: (r: AnalysisInput) => void; all: AnalysisInput[] };
  getSelectedGroup: () => string;
  getDeviceId: () => string;
  log: (msg: string, type?: "info" | "move" | "error") => void;
  escapeHtml: (s: string) => string;
}

export function createSolveController(options: SolveControllerOptions) {
  const {
    elements, timer, timerDisplay, cubeVisualizer, historyController,
    getScrambleState, getPracticeSession, getPracticeNeedsRetry, setPracticeNeedsRetry,
    getPracticeCaseVerified, setPracticeCaseVerified, getBlockPracticeMode, onScrambleMove,
    getHistoryStore, getSelectedGroup, getDeviceId, log, escapeHtml,
  } = options;

  const SYSTEM_HISTORY_GROUP_IDS = new Set(["all", "today"]);

  let pendingInspectionPenalty: InspectionPenalty = "none";
  let isFinalizingSolve = false;
  let currentSolveEvents: CubeMove[] = [];

  // ====== 计时器控制 ======
  function startSolveTimer(fromMove = false): void {
    if (timer.getState().isRunning) return;
    const scrambleState = getScrambleState();
    if (scrambleState.scrambleProgress.remaining.length > 0) {
      log("请先按提示完成打乱，再开始计时", "error");
      return;
    }
    if (!scrambleState.scrambleStateVerified) {
      log("打乱状态未通过核验，请复原实体魔方后重新生成打乱", "error");
      return;
    }
    if (!fromMove) {
      log("请通过转动第一步开始计时", "error");
      return;
    }
    pendingInspectionPenalty = timerDisplay.consumePenalty();
    timer.start();
    currentSolveEvents = [];
    elements.btnStart.disabled = true;
    elements.btnStop.disabled = false;
    timerDisplay.startDisplay();
    log("Timer started");
  }

  async function stopSolveTimerAndAnalyze(waitForLateMove = false): Promise<void> {
    if (!timer.getState().isRunning || isFinalizingSolve) return;
    isFinalizingSolve = true;
    const stopRequestedAt = Date.now();
    if (waitForLateMove) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 180));
    }
    timer.stop(stopRequestedAt);
    elements.btnStart.disabled = false;
    elements.btnStop.disabled = true;
    timerDisplay.stopDisplay();
    timerDisplay.updateDisplay();
    log("Timer stopped");
    try {
      await onSolveComplete();
    } finally {
      isFinalizingSolve = false;
    }
  }

  function handleBleDisconnectMidSolve(deviceName: string): void {
    if (!timer.getState().isRunning) return;
    timer.stop();
    timerDisplay.stopDisplay();
    timerDisplay.updateDisplay();
    elements.btnStart.disabled = false;
    elements.btnStop.disabled = true;
    isFinalizingSolve = false;
    log(`⚠ ${deviceName} 在计时过程中断开，本把成绩已作废。请重连后重新开始。`, "error");
  }

  // ====== 解法完成处理 ======
  async function onSolveComplete(): Promise<void> {
    const state = timer.getState();
    const practiceSession = getPracticeSession();
    if (state.moves.length === 0) {
      log("无 move 数据，无法分析", "error");
      return;
    }

    const moveStrs = state.moves.map((m) => m.move);
    const moveTimes = state.moves.map((m) => m.timestamp);
    const scrambleState = getScrambleState();
    const validation = validateSolve(scrambleState.scrambleProgress.completed, currentSolveEvents);
    const prettySummary = summarizePrettyReconstruction(currentSolveEvents);
    if (prettySummary) log(prettySummary);

    log("🔍 开始 CFOP 阶段识别...");
    const cfopResult: CfopResult = parseCfop(
      moveStrs, moveTimes, scrambleState.scrambleProgress.completed,
      state.startTime, state.endTime,
    );
    const stepReview = analyzeSolveSteps(moveStrs, state.moves.map((m) => m.gapFromPrev), cfopResult.segments);
    const f2lSlotAnalysis = analyzeF2lSlots(
      scrambleState.scrambleProgress.completed, moveStrs, moveTimes,
      state.moves.map((m) => m.gapFromPrev), state.startTime, stepReview.pauseThreshold,
    );

    elements.cfopOutput.textContent = `总用时: ${(timer.getDuration() / 1000).toFixed(2)}s\n${formatCfop(cfopResult)}\n\n${formatF2lSlotAnalysis(f2lSlotAnalysis)}`;
    elements.cfopModal.classList.add("open");
    log(`CFOP 识别完成: ${cfopResult.segments.length} 个阶段`);

    const cross = cfopResult.segments.find((s) => s.stage === "cross");
    const f2l = cfopResult.segments.find((s) => s.stage === "f2l");
    const oll = cfopResult.segments.find((s) => s.stage === "oll");
    const pll = cfopResult.segments.find((s) => s.stage === "pll");
    const historyStore = getHistoryStore();
    const previousSolve = historyStore.all[historyStore.all.length - 1];
    const totalDuration = timer.getDuration();
    const moveCount = state.moves.length;

    const blockPracticeMode = getBlockPracticeMode();
    const crossMetrics = blockPracticeMode === "cross" ? calculateCrossMetrics(state.moves, totalDuration) : undefined;
    const practiceKind = practiceSession ? "formula" : blockPracticeMode ?? undefined;
    const reliableMoveStream = isMoveStreamReliable(validation);
    const finalPhase = getCfopPhase(validation.finalFacelets);
    const practiceCaseVerified = getPracticeCaseVerified();

    const formulaPracticeSucceeded = practiceSession
      ? reliableMoveStream && practiceCaseVerified && (
        practiceSession.formula.category === "F2L"
          ? finalPhase === "f2l" || finalPhase === "oll" || finalPhase === "solved"
          : practiceSession.formula.category === "OLL"
            ? finalPhase === "oll" || finalPhase === "solved"
            : validation.isSolved)
      : false;

    const input: AnalysisInput = {
      completedAt: Date.now(),
      deviceName: elements.deviceName.textContent?.trim() || "未标识魔方",
      deviceId: getDeviceId(),
      groupId: !practiceKind && !SYSTEM_HISTORY_GROUP_IDS.has(getSelectedGroup()) ? getSelectedGroup() : undefined,
      practiceMode: blockPracticeMode ?? undefined,
      practiceKind,
      practiceFormulaId: practiceSession?.formula.id,
      practiceOutcome: practiceSession
        ? (formulaPracticeSucceeded ? "success" : "failed")
        : blockPracticeMode ? (false ? "success" : "failed") : undefined,
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
      scramble: scrambleState.scrambleProgress.completed.join(" "),
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
      moveGaps: state.moves.map((m) => m.gapFromPrev),
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

    if (validation.isSolved && reliableMoveStream) {
      log("状态回放确认已还原；成绩可用于 AO 与 AI");
    } else if (formulaPracticeSucceeded) {
      log("状态回放确认专项目标完成；已仅计入专项统计");
    } else {
      log(`成绩已保存但未通过状态校验：${validation.anomalies.join("、")}`, "error");
    }

    log("成绩已保存；点击右下角 AI 可按需分析历史成绩");
  }

  // ====== 渲染函数 ======
  function renderStepReview(review: SolveReview): void {
    if (review.pauses.length === 0) {
      elements.agentOutput.innerHTML = '<p class="placeholder">本次没有发现明显长停顿，继续保持节奏。</p>';
      return;
    }
    const pauses = review.pauses.map((pause) =>
      `<li><strong>#${pause.index + 1} ${escapeHtml(pause.move)}</strong> · ${escapeHtml(pause.stage)} · 间隔 ${(pause.gap / 1000).toFixed(2)}s</li>`
    ).join("");
    elements.agentOutput.innerHTML = `
      <div class="analysis-card">
        <div class="analysis-item bottleneck">
          <div class="label">逐步复盘：长停顿</div>
          <div class="value">平均间隔 ${(review.averageGap / 1000).toFixed(2)}s，最长 ${(review.maxGap / 1000).toFixed(2)}s</div>
        </div>
        <div class="analysis-item advice"><ul>${pauses}</ul></div>
        <p class="placeholder">点击右下角 AI，可基于这些停顿和最近历史生成训练建议。</p>
      </div>`;
  }

  function renderSolveSummary(current: AnalysisInput, previous?: AnalysisInput): void {
    const getSolveScore = (solve: AnalysisInput) => getWcaScore({ duration: solve.totalDuration, penalty: solve.penalty });
    const formatSolveTime = (solve: AnalysisInput) => formatWcaSolveTime({ duration: solve.totalDuration, penalty: solve.penalty });

    // 计算反馈
    let feedback: { label: string; detail: string; isPersonalBest: boolean };
    if (!isSolveEligible(current.qualityStatus)) {
      feedback = { label: "本把不计入成绩", detail: "设备数据未通过校验，不参与 PB 和 AO 统计。", isPersonalBest: false };
    } else if (current.penalty === "dnf") {
      feedback = { label: "DNF", detail: "观察超过 DNF 时限；本把保留在历史中，并按 WCA 规则参与 AO。", isPersonalBest: false };
    } else {
      const history = getHistoryStore().all.filter((s) => isSolveEligible(s.qualityStatus));
      const currentScore = getSolveScore(current);
      const isPersonalBest = history.every((s) => currentScore < getSolveScore(s));
      const rank = history.filter((s) => getSolveScore(s) < currentScore).length + 1;
      const ao5 = history.length >= 5
        ? calculateWcaAverage(history.slice(-5).map((s) => ({ duration: s.totalDuration, penalty: s.penalty }))).value
        : null;
      if (isPersonalBest) {
        feedback = { label: history.length === 0 ? "首个有效成绩" : "新的个人最佳", detail: `本组第 ${rank} 快`, isPersonalBest: history.length > 0 };
      } else if (ao5 !== null) {
        const delta = currentScore - ao5;
        const direction = delta < 0 ? "快" : "慢";
        feedback = { label: `较上一组 AO5 ${direction} ${Math.abs(delta / 1000).toFixed(2)}s`, detail: `本组第 ${rank} 快`, isPersonalBest: false };
      } else {
        feedback = { label: `本组第 ${rank} 快`, detail: `再完成 ${Math.max(0, 4 - history.length)} 把解锁 AO5 对比`, isPersonalBest: false };
      }
    }

    // 渲染指标
    const metrics = [
      { label: "TPS", value: (current.tps ?? 0).toFixed(2), current: current.tps ?? 0, previous: previous?.tps, unit: "" },
      { label: "Cross", value: `${(current.crossDuration / 1000).toFixed(2)}s`, current: current.crossDuration, previous: previous?.crossDuration, unit: "s" },
      { label: "F2L", value: `${(current.f2lDuration / 1000).toFixed(2)}s`, current: current.f2lDuration, previous: previous?.f2lDuration, unit: "s" },
      { label: "OLL", value: `${(current.ollDuration / 1000).toFixed(2)}s`, current: current.ollDuration, previous: previous?.ollDuration, unit: "s" },
      { label: "PLL", value: `${(current.pllDuration / 1000).toFixed(2)}s`, current: current.pllDuration, previous: previous?.pllDuration, unit: "s" },
    ];
    const formatDelta = (curr: number, prev: number, unit: string) => {
      const divisor = unit === "s" ? 1000 : 1;
      const delta = (curr - prev) / divisor;
      const sign = delta >= 0 ? "+" : "";
      return `(${sign}${delta.toFixed(2)}${unit})`;
    };
    const metricMarkup = metrics.map((m) => {
      const delta = m.previous === undefined ? "" : formatDelta(m.current, m.previous, m.unit);
      return `<div><span>${m.label}</span><strong>${m.value}</strong><em>${delta}</em></div>`;
    }).join("");

    elements.cfopSummary.innerHTML = `
      <section class="solve-result-hero${feedback.isPersonalBest ? " is-personal-best" : ""}" aria-live="polite">
        <span>本把成绩</span>
        <strong><span class="solve-result-time">${formatSolveTime(current)}</span>${current.penalty === "dnf" ? "" : "<small>s</small>"}</strong>
        <p><b>${feedback.label}</b>${feedback.detail ? ` · ${feedback.detail}` : ""}</p>
      </section>
      <div class="solve-stage-metrics">${metricMarkup}</div>`;

    // 瓶颈和下一步训练
    const stages = [
      { name: "Cross", duration: current.crossDuration },
      { name: "F2L", duration: current.f2lDuration },
      { name: "OLL", duration: current.ollDuration },
      { name: "PLL", duration: current.pllDuration },
    ].filter((s) => s.duration > 0);
    const bottleneck = stages.reduce((slowest, s) => s.duration > slowest.duration ? s : slowest, stages[0]);
    const quality = presentSolveQuality(current.qualityStatus, current.qualityAnomalies);

    const defaultAction = !isSolveEligible(current.qualityStatus)
      ? `<div class="result-action-card"><span>本把不计入成绩</span><strong>${escapeHtml(quality.label)}</strong><p>${escapeHtml(quality.description)} 请重新生成打乱并从提示的第一步开始执行。</p></div>`
      : bottleneck
        ? `<div class="result-action-card"><span>下一步训练</span><strong>先练 ${bottleneck.name}</strong><p>${bottleneck.name} 用时 ${(bottleneck.duration / 1000).toFixed(2)}s；${quality.label}。</p></div>`
        : "";
    elements.resultNextAction.innerHTML = defaultAction;
  }

  function recordSolve(input: AnalysisInput): void {
    const historyStore = getHistoryStore();
    historyStore.add(input);
    historyController.render();
    if (isSolveEligible(input.qualityStatus)) historyController.animateRefresh();
  }

  function addMoveEvent(move: CubeMove): void {
    currentSolveEvents.push(move);
  }

  function resetSolveEvents(): void {
    currentSolveEvents = [];
  }

  // ====== 绑定事件 ======
  function bindEvents() {
    elements.btnStart.onclick = () => startSolveTimer();
    elements.btnStop.onclick = () => stopSolveTimerAndAnalyze(true);
    elements.btnReset.onclick = () => {
      timer.reset();
      timerDisplay.endInspection();
      elements.btnStart.disabled = false;
      elements.btnStop.disabled = true;
      elements.cfopOutput.textContent = "（等待本次解法）";
      elements.agentOutput.innerHTML = "<p class=\"placeholder\">完成一次解法后，AI 分析会显示在这里</p>";
      cubeVisualizer.reset();
      log("已重置");
    };
    elements.btnCloseCfop.onclick = () => elements.cfopModal.classList.remove("open");
  }

  function init() {
    bindEvents();
  }

  return {
    init,
    startSolveTimer,
    stopSolveTimerAndAnalyze,
    handleBleDisconnectMidSolve,
    onSolveComplete,
    addMoveEvent,
    resetSolveEvents,
    renderSolveSummary,
  };
}
