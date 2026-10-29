/**
 * src-frontend/controllers/move-controller.ts
 * Move 事件编排：把每次设备动作分发到丢步检测、打乱完成校验、练习 case 识别与计时启停。
 *
 * 职责边界：
 *   - 不持有 DOM 引用，所有可见输出走 deps.log / closeResultModals
 *   - 不直接调用 scramble/timer 的具体控制器实现，只依赖结构化接口
 */

import type { CubeMove } from "../ble/cube-driver.ts";
import type { AppState } from "../core/app-state.ts";
import type { Timer } from "../core/timer.ts";
import { findMoveLossWarning } from "../core/move-reconstruction.ts";
import { invertMove } from "../core/scramble-tracker.ts";
import { recognizeF2lCase, recognizeFormulaPracticeCase } from "../core/f2l-case-recognizer.ts";
import { getCfopPhase, type CfopPhase } from "../core/cstimer-cfop.ts";
import { canBeginInspection } from "../core/scramble-ready-gate.ts";
import { isBlockPracticeComplete } from "../core/block-practice.ts";

/** Move 编排用到的 3D 可视化操作 */
export interface MoveVisualizerDeps {
  applyMove(move: string): void;
  getFacelets(): string;
  isSolved(): boolean;
}

/** Move 编排用到的打乱控制器操作 */
export interface MoveScrambleDeps {
  cancelGeneration(): void;
  newScramble(): Promise<void>;
  updateOnMove(move: string): void;
  verifyCompleted(): void;
  verifyPhysicalAndBeginInspection(): Promise<void>;
}

/** Move 编排用到的计时控制器操作 */
export interface MoveTimerDeps {
  startSolveTimer(fromMove?: boolean): void;
  stopSolveTimerAndAnalyze(waitForLateMove?: boolean): Promise<void>;
}

/** Move 编排用到的阶段指示条操作 */
export interface MovePhaseIndicatorDeps {
  show(phase: CfopPhase): void;
  complete(phase: CfopPhase): void;
}

export interface MoveControllerDependencies {
  timer: Timer;
  cubeVisualizer: MoveVisualizerDeps;
  scramble: MoveScrambleDeps;
  timerController: MoveTimerDeps;
  phaseIndicator: MovePhaseIndicatorDeps;
  closeResultModals: () => void;
  log: (msg: string, type?: "info" | "move" | "error") => void;
}

export function createMoveController(
  state: AppState,
  deps: MoveControllerDependencies,
): { onCubeMove(move: CubeMove): void } {
  const { timer, cubeVisualizer, scramble, timerController, phaseIndicator, closeResultModals, log } = deps;

  function onCubeMove(move: CubeMove): void {
    const lossWarning = findMoveLossWarning(state.solve.lastDeviceMoveCnt, move.moveCnt);
    if (lossWarning) {
      log(`疑似丢步：设备计数从 ${lossWarning.previousMoveCnt} 跳到 ${lossWarning.currentMoveCnt}，中间缺 ${lossWarning.missing} 步`, "error");
    }
    if (move.moveCnt !== undefined && move.moveCnt >= 0) {
      state.solve.lastDeviceMoveCnt = move.moveCnt;
    }

    if (state.scramble.isGenerationPending) {
      // 这一步已经改变了实体魔方，不能再把稍后生成的新打乱叠加到旧局面上。
      cubeVisualizer.applyMove(move.move);
      state.scramble.performedMoves.push(move.move);
      scramble.cancelGeneration();
      log("生成指定 Cross 打乱时检测到实体转动，已取消本次生成。请先复原实体魔方，再点击“新打乱”。", "error");
      return;
    }

    cubeVisualizer.applyMove(move.move);

    if (state.practice.awaitingNextScramble) {
      const previous = state.practice.postSolveMoves[state.practice.postSolveMoves.length - 1];
      state.practice.postSolveMoves.push(move.move);
      if (previous && invertMove(previous) === move.move) {
        log("检测到相反动作，生成下一条打乱");
        closeResultModals();
        void scramble.newScramble();
      }
      return;
    }

    const shouldStartSolve = !timer.getState().isRunning && state.scramble.progress.remaining.length === 0;
    const wasCompletingScramble = state.scramble.progress.remaining.length > 0;
    if (wasCompletingScramble) state.scramble.performedMoves.push(move.move);
    scramble.updateOnMove(move.move);

    if (wasCompletingScramble && state.scramble.progress.remaining.length === 0) {
      scramble.verifyCompleted();
      if (canBeginInspection(state.scramble.progress.remaining.length, state.scramble.stateVerified)) {
        void scramble.verifyPhysicalAndBeginInspection();
      }
    }

    if (wasCompletingScramble && state.scramble.progress.remaining.length === 0) {
      verifyPracticeCase(state, cubeVisualizer, log);
    }

    if (shouldStartSolve) {
      timerController.startSolveTimer(true);
    }

    if (timer.getState().isRunning) {
      timer.addMove(move.move);
      state.solve.events.push(move);
    }
    log(`#${timer.getState().moves.length + 1} ${move.move}`, "move");

    const blockPhase = getCfopPhase(cubeVisualizer.getFacelets());
    const shouldStopBlock = state.practice.blockMode !== null && isBlockPracticeComplete(state.practice.blockMode, cubeVisualizer.getFacelets());
    const shouldStopFormulaF2l = state.practice.session?.formula.category === "F2L" && timer.getState().moves.length > 0 && blockPhase === "f2l";
    const shouldStopFormulaOll = state.practice.session?.formula.category === "OLL" && timer.getState().moves.length > 0 && blockPhase === "oll";
    if (timer.getState().isRunning && timer.getState().moves.length > 0 && (cubeVisualizer.isSolved() || shouldStopBlock || shouldStopFormulaF2l || shouldStopFormulaOll)) {
      if (shouldStopBlock) state.practice.blockCompleted = true;
      phaseIndicator.complete(blockPhase);
      void timerController.stopSolveTimerAndAnalyze();
    } else if (timer.getState().isRunning) {
      // 计时期间实时显示当前 CFOP 阶段，让阶段进度在训练中可见。
      phaseIndicator.show(blockPhase);
    }
  }

  return { onCubeMove };
}

function verifyPracticeCase(state: AppState, visualizer: MoveVisualizerDeps, log: MoveControllerDependencies["log"]): void {
  const formula = state.practice.session?.formula;
  if (!formula) return;
  const facelets = visualizer.getFacelets();
  const match = recognizeFormulaPracticeCase(facelets, formula);
  state.practice.caseVerified = match?.formulaId === formula.id;
  if (match?.formulaId === formula.id) {
    log(`${formula.category} 识别：${match.formulaId} · ${match.name}（精确匹配）`);
  } else {
    const fallback = formula.category === "F2L" ? recognizeF2lCase(facelets) : null;
    log(fallback
      ? `${formula.category} 起始 case 不匹配：期望 ${formula.id}，识别为 ${fallback.formulaId}`
      : `${formula.category} 起始 case 未能可靠匹配：期望 ${formula.id}`, "error");
  }
}
