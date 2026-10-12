/**
 * 计时会话控制器：开始/结束计时、蓝牙断连中止与整局重置。
 *
 * 从 main.ts 抽出。共享 AppState（solve/practice/scramble），解法完成分析
 * 通过依赖注入调用 SolveCompletionController，避免反向依赖。
 */

import { captureInspection, type InspectionSource } from "../core/inspection-capture.ts";
import type { AppState } from "../core/app-state.ts";
import type { Timer } from "../core/timer.ts";

/** 计时控制器所需 DOM 元素 */
export interface TimerControllerElements {
  btnStop: HTMLButtonElement;
  btnReset: HTMLButtonElement;
  cfopOutput: HTMLElement;
  agentOutput: HTMLElement;
}

/** 结构化依赖：只声明实际用到的方法，避免与具体控制器实现耦合。 */
export interface TimerControllerDependencies {
  timer: Timer;
  timerDisplay: InspectionSource & {
    startDisplay: () => void;
    stopDisplay: () => void;
    updateDisplay: () => void;
    endInspection: () => void;
  };
  cubeVisualizer: {
    reset: () => void;
  };
  solveCompletion: {
    onSolveComplete: (signal: AbortSignal) => Promise<void>;
  };
  /** 阶段指示条复位入口（结构化接口，避免依赖具体控制器实现）。 */
  phaseIndicator: {
    reset: () => void;
  };
  log: (msg: string, type?: "info" | "move" | "error") => void;
}

export interface TimerController {
  init(): void;
  startSolveTimer(fromMove?: boolean): void;
  stopSolveTimerAndAnalyze(waitForLateMove?: boolean): Promise<void>;
  /** 蓝牙断连时若正在计时，中止当前 solve 并提示用户（不完整数据不做分析）。 */
  abortOnDisconnect(deviceName: string): void;
  /** 整局重置：清空计时、观察、练习状态与结果区。 */
  resetSession(): void;
}

async function finalizeSolve(
  els: TimerControllerElements, state: AppState, deps: TimerControllerDependencies,
  signal: AbortSignal, waitForLateMove: boolean,
): Promise<void> {
  const { timer, timerDisplay, solveCompletion, log } = deps;
  const timerState = timer.getState();
  const stopRequestedAt = Date.now();
  try {
    // 尾包仍可补入本轮，但重置后的计时状态不能被旧停止请求提交。
    await new Promise<void>((resolve) => window.setTimeout(resolve, waitForLateMove ? 600 : 420));
    if (signal.aborted || timer.getState() !== timerState || !timerState.isRunning) return;
    timer.stop(stopRequestedAt);
    els.btnStop.disabled = true;
    timerDisplay.stopDisplay();
    timerDisplay.updateDisplay();
    log("Timer stopped");
    await solveCompletion.onSolveComplete(signal);
    if (!signal.aborted && timer.getState() === timerState) state.practice.blockMode = null;
  } catch (error) {
    if (!signal.aborted && timer.getState() === timerState) {
      console.error("[timer-controller] 成绩核验失败:", error);
      log(`成绩核验失败：${error instanceof Error ? error.message : String(error)}。本次动作仍保留在页面，请重新开始。`, "error");
    }
  }
}

function resetTimerSession(els: TimerControllerElements, state: AppState, deps: TimerControllerDependencies): void {
  const { timer, timerDisplay, cubeVisualizer, phaseIndicator, log } = deps;
  timer.reset();
  timerDisplay.endInspection();
  timerDisplay.stopDisplay();
  state.practice.blockMode = null;
  state.practice.awaitingNextScramble = false;
  state.practice.postSolveMoves = [];
  timerDisplay.updateDisplay();
  els.btnStop.disabled = true;
  els.cfopOutput.textContent = "（等待本次解法）";
  els.agentOutput.innerHTML = "<p class=\"placeholder\">完成一次解法后，AI 分析会显示在这里</p>";
  cubeVisualizer.reset();
  phaseIndicator.reset();
  log("已重置");
}

function canStartSolveTimer(state: AppState, deps: TimerControllerDependencies, fromMove: boolean): boolean {
  if (deps.timer.getState().isRunning) {
    deps.log("计时器已在运行中", "error");
    return false;
  }
  if (state.scramble.progress.remaining.length > 0) {
    deps.log(`打乱未完成，剩余 ${state.scramble.progress.remaining.length} 步`, "error");
    return false;
  }
  if (!fromMove) {
    deps.log("请通过转动第一步开始计时", "error");
    return false;
  }
  return true;
}

export function createTimerController(
  els: TimerControllerElements,
  state: AppState,
  deps: TimerControllerDependencies,
): TimerController {
  const { timer, timerDisplay, phaseIndicator, log } = deps;
  let finalization: AbortController | null = null;

  function cancelFinalization(): void {
    finalization?.abort();
    finalization = null;
    state.solve.isFinalizing = false;
  }

  function startSolveTimer(fromMove = false): void {
    if (!canStartSolveTimer(state, deps, fromMove)) return;
    cancelFinalization();
    const inspection = captureInspection(timerDisplay);
    state.solve.inspectionPenalty = inspection.penalty;
    state.solve.inspectionDuration = inspection.duration;
    timer.start();
    state.solve.events = [];
    state.solve.hasPermanentMoveGap = false;
    state.solve.lastDeviceMoveCnt = undefined;
    els.btnStop.disabled = false;
    timerDisplay.startDisplay();
    log("Timer started");
  }

  async function stopSolveTimerAndAnalyze(waitForLateMove = false): Promise<void> {
    if (!timer.getState().isRunning || state.solve.isFinalizing) return;
    const operation = new AbortController();
    finalization = operation;
    state.solve.isFinalizing = true;
    try {
      await finalizeSolve(els, state, deps, operation.signal, waitForLateMove);
    } finally {
      if (finalization === operation) {
        finalization = null;
        state.solve.isFinalizing = false;
      }
    }
  }

  function abortOnDisconnect(deviceName: string): void {
    if (!timer.getState().isRunning && !state.solve.isFinalizing) return;
    cancelFinalization();
    timer.stop();
    timerDisplay.stopDisplay();
    timerDisplay.updateDisplay();
    els.btnStop.disabled = true;
    phaseIndicator.reset();
    log(`⚠ ${deviceName} 连接已断开，本把成绩已作废。请重连后重新开始。`, "error");
  }

  function resetSession(): void {
    cancelFinalization();
    resetTimerSession(els, state, deps);
  }

  function init(): void {
    els.btnStop.onclick = () => {
      void stopSolveTimerAndAnalyze(true);
    };
    els.btnReset.onclick = () => {
      resetSession();
    };
  }

  return { init, startSolveTimer, stopSolveTimerAndAnalyze, abortOnDisconnect, resetSession };
}
