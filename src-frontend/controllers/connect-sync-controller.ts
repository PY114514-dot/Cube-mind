/**
 * src-frontend/controllers/connect-sync-controller.ts
 * 连接复位同步：设备连接确认后，校验实体局面并把 3D、计时器与打乱复位到已还原基线。
 *
 * 职责边界：
 *   - 不持有 BLE 连接细节，实体局面读取走 deps.ble
 *   - 不直接调用 scramble 的具体实现，只依赖结构化接口
 */

import type { AppState } from "../core/app-state.ts";
import { Timer } from "../core/timer.ts";
import { SOLVED_FACELET } from "../utils/mathlib.ts";

/** 复位需要操作的按钮 */
export interface ConnectSyncElements {
  btnStart: HTMLButtonElement;
  btnStop: HTMLButtonElement;
}

export interface ConnectSyncDependencies {
  timer: Timer;
  timerDisplay: {
    stopDisplay(): void;
    updateDisplay(): void;
  };
  cubeVisualizer: {
    reset(): void;
    loadFacelets(facelets: string): boolean;
  };
  scramble: {
    newScramble(): Promise<void>;
  };
  ble: {
    requestCurrentFacelets(): Promise<string | null>;
  };
  log: (msg: string, type?: "info" | "move" | "error") => void;
}

export function createConnectSyncController(
  els: ConnectSyncElements,
  state: AppState,
  deps: ConnectSyncDependencies,
): { confirmCubeResetAfterConnect(deviceLabel: string): Promise<void> } {
  const { timer, timerDisplay, cubeVisualizer, scramble, ble, log } = deps;

  function resetSessionForSyncedCube(): void {
    timer.reset();
    state.solve.lastDeviceMoveCnt = undefined;
    timerDisplay.stopDisplay();
    timerDisplay.updateDisplay();
    els.btnStart.disabled = false;
    els.btnStop.disabled = true;
    cubeVisualizer.reset();
    void scramble.newScramble();
  }

  async function confirmCubeResetAfterConnect(deviceLabel: string): Promise<void> {
    const shouldReset = window.confirm(
      `${deviceLabel} 已连接。\n\n请先把实体智能魔方复原到已还原状态。\n点击"确定"后，CubeMind 会把 3D 魔方重置为已还原并生成新打乱。`
    );

    if (shouldReset) {
      const physicalFacelets = await ble.requestCurrentFacelets();
      if (physicalFacelets !== null && physicalFacelets !== SOLVED_FACELET) {
        cubeVisualizer.loadFacelets(physicalFacelets);
        log(`${deviceLabel} 实体局面尚未复原，未生成打乱。请先复原实体魔方后重新连接。`, "error");
        return;
      }
      if (physicalFacelets === null) {
        log(`${deviceLabel} 未提供可验证的实体局面；本次将以动作流为准，不会用局面包覆盖 3D 起点。`, "error");
      }
      resetSessionForSyncedCube();
      log(`${deviceLabel} 已按还原状态同步 3D 魔方`);
    } else {
      log(`${deviceLabel} 未重置，实体魔方和 3D 魔方可能不同步`, "error");
      void scramble.newScramble();
    }
  }

  return { confirmCubeResetAfterConnect };
}
