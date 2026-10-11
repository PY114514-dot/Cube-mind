import { isPhysicalStateInSync } from "../core/physical-state-sync.ts";
import type { AppState } from "../core/app-state.ts";
import type { ScrambleControllerDependencies } from "./scramble-controller.ts";

/** 打乱回读拥有独立生命周期，不能把晚返回的局面带入另一轮观察。 */
export function createScramblePhysicalVerification(state: AppState, deps: ScrambleControllerDependencies) {
  const { timer, timerDisplay, cubeVisualizer, ble, log } = deps;
  let active: object | null = null;

  async function verify(): Promise<void> {
    if (active || state.scramble.progress.remaining.length > 0 || timer.getState().isRunning) return;
    const operation = {};
    active = operation;
    const progress = state.scramble.progress;
    const timerState = timer.getState();
    const isCurrent = (): boolean => active === operation && state.scramble.progress === progress
      && timer.getState() === timerState && !timerState.isRunning && progress.remaining.length === 0;
    try {
      const expectedFacelets = cubeVisualizer.getFacelets();
      const physicalFacelets = await ble.requestCurrentFacelets();
      if (!isCurrent()) return;
      const inSync = isPhysicalStateInSync(expectedFacelets, physicalFacelets);
      if (inSync === false) {
        if (!cubeVisualizer.loadFacelets(physicalFacelets ?? "")) {
          log("实体局面格式无效，无法建立本把基线。请重新连接智能魔方后再试。", "error");
          return;
        }
        state.scramble.stateVerified = false;
        log("实体局面与页面打乱终态不一致，已按实体局面重建 3D 起点。本把可计成绩；为避免错误 CFOP/AI，将仅保留计分。", "error");
      }
      if (inSync === null) log("未提供可验证的实体打乱终态；已保留页面打乱与动作流基线。", "error");
      if (!state.scramble.stateVerified) log("打乱动作序列回放存在差异，但实体局面已通过本次校验。", "error");
      timerDisplay.beginInspection();
    } catch (error) {
      if (isCurrent()) {
        console.error("[scramble] 实体局面回读失败:", error);
        log(`实体局面回读失败：${error instanceof Error ? error.message : String(error)}。请重新生成打乱后再试。`, "error");
      }
    } finally {
      if (active === operation) active = null;
    }
  }

  return { verify, cancel: (): void => { active = null; } };
}
