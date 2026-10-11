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
  btnStart: HTMLButtonElement;
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
    onSolveComplete: () => Promise<void>;
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

export function createTimerController(
  els: TimerControllerElements,
  state: AppState,
  deps: TimerControllerDependencies,
): TimerController {
  const { timer, timerDisplay, cubeVisualizer, solveCompletion, phaseIndicator, log } = deps;

  function startSolveTimer(fromMove = false): void {
    if (timer.getState().isRunning) {
      log("计时器已在运行中", "error");
      return;
    }
    if (state.scramble.progress.remaining.length > 0) {
      log(`打乱未完成，剩余 ${state.scramble.progress.remaining.length} 步`, "error");
      return;
    }
    if (!fromMove) {
      log("请通过转动第一步开始计时", "error");
      return;
    }
    const inspection = captureInspection(timerDisplay);
    state.solve.inspectionPenalty = inspection.penalty;
    state.solve.inspectionDuration = inspection.duration;
    timer.start();
    state.solve.events = [];
    state.solve.hasPermanentMoveGap = false;
    state.solve.lastDeviceMoveCnt = undefined;
    els.btnStart.disabled = true;
    els.btnStop.disabled = false;
    timerDisplay.startDisplay();
    log("Timer started");
  }

  async function stopSolveTimerAndAnalyze(waitForLateMove = false): Promise<void> {
    if (!timer.getState().isRunning || state.solve.isFinalizing) return;
    state.solve.isFinalizing = true;
    const stopRequestedAt = Date.now();
    // DCTimer 会让 moveCnt 缓冲等待 history 注入；此窗口内仍保持计时接收，不能把临时 gap 当永久丢步。
    await new Promise<void>((resolve) => window.setTimeout(resolve, waitForLateMove ? 600 : 420));
    timer.stop(stopRequestedAt);
    els.btnStart.disabled = false;
    els.btnStop.disabled = true;
    timerDisplay.stopDisplay();
    timerDisplay.updateDisplay();
    log("Timer stopped");
    try {
      await solveCompletion.onSolveComplete();
      state.practice.blockMode = null;
    } finally {
      state.solve.isFinalizing = false;
    }
  }

  function abortOnDisconnect(deviceName: string): void {
    if (!timer.getState().isRunning) return;
    timer.stop();
    timerDisplay.stopDisplay();
    timerDisplay.updateDisplay();
    els.btnStart.disabled = false;
    els.btnStop.disabled = true;
    state.solve.isFinalizing = false;
    phaseIndicator.reset();
    log(`⚠ ${deviceName} 在计时过程中断开，本把成绩已作废。请重连后重新开始。`, "error");
  }

  function resetSession(): void {
    timer.reset();
    timerDisplay.endInspection();
    state.practice.blockMode = null;
    state.practice.awaitingNextScramble = false;
    state.practice.postSolveMove = null;
    timerDisplay.updateDisplay();
    els.btnStart.disabled = false;
    els.btnStop.disabled = true;
    els.cfopOutput.textContent = "（等待本次解法）";
    els.agentOutput.innerHTML = "<p class=\"placeholder\">完成一次解法后，AI 分析会显示在这里</p>";
    cubeVisualizer.reset();
    phaseIndicator.reset();
    log("已重置");
  }

  function init(): void {
    els.btnStart.onclick = () => {
      startSolveTimer();
    };
    els.btnStop.onclick = () => {
      void stopSolveTimerAndAnalyze(true);
    };
    els.btnReset.onclick = () => {
      resetSession();
    };
  }

  return {
    init,
    startSolveTimer,
    stopSolveTimerAndAnalyze,
    abortOnDisconnect,
    resetSession,
  };
}
