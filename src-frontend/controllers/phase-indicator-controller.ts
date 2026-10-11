/**
 * src-frontend/controllers/phase-indicator-controller.ts
 * CFOP 阶段指示条控制器：把实时 CFOP 阶段映射为四段（Cross/F2L/OLL/PLL）的展示状态。
 *
 * 职责边界：
 *   - 不感知计时/打乱逻辑，只根据传入的 CfopPhase 计算状态并应用到 DOM
 *   - 状态计算是纯函数（可单测），DOM 控制器仅负责把状态写入 data-state
 */

import type { CfopPhase } from "../core/cstimer-cfop.ts";

/** 单段指示条的可视状态：未开始 / 进行中 / 已完成 */
export type PhaseIndicatorState = "idle" | "active" | "done";

export interface PhaseIndicatorElements {
  cfopPhaseIndicator: HTMLElement;
}

/** 与 DOM 中四段 .phase-seg 的顺序一一对应（第 4 段文案为 PLL，底层用 solved 表示） */
const PHASE_ORDER = ["cross", "f2l", "oll", "solved"] as const;

const IDLE_ALL: PhaseIndicatorState[] = ["idle", "idle", "idle", "idle"];

export function computePhaseIndicatorState(phase: CfopPhase | null): PhaseIndicatorState[] {
  if (!phase) return [...IDLE_ALL];
  // 十字尚未完成时（scramble）仍处于 cross 阶段：计时期间显示 cross 激活而非空白。
  const stage = phase === "scramble" ? "cross" : phase;
  const index = PHASE_ORDER.indexOf(stage);
  if (index < 0) return [...IDLE_ALL];
  return PHASE_ORDER.map((_, i) => {
    if (i < index) return "done";
    if (i === index && stage !== "solved") return "active";
    return stage === "solved" ? "done" : "idle";
  });
}

export function createPhaseIndicatorController(els: PhaseIndicatorElements): {
  reset(): void;
  show(phase: CfopPhase): void;
  complete(): void;
} {
  const segments = Array.from(els.cfopPhaseIndicator.querySelectorAll<HTMLElement>(".phase-seg"));

  function apply(states: PhaseIndicatorState[]): void {
    segments.forEach((seg, i) => {
      seg.dataset.state = states[i] ?? "idle";
    });
  }

  function reset(): void {
    apply([...IDLE_ALL]);
  }

  function show(phase: CfopPhase): void {
    apply(computePhaseIndicatorState(phase));
  }

  function complete(): void {
    segments.forEach((seg) => {
      seg.dataset.state = "done";
    });
  }

  return { reset, show, complete };
}
