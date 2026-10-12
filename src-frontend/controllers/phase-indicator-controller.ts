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

// 检测器返回已经完成的阶段，而指示条标记接下来正在执行的阶段。
const PHASE_ORDER = ["scramble", "cross", "f2l", "oll", "solved"] as const;

const IDLE_ALL: PhaseIndicatorState[] = ["idle", "idle", "idle", "idle"];

export function computePhaseIndicatorState(phase: CfopPhase | null): PhaseIndicatorState[] {
  if (!phase) return [...IDLE_ALL];
  const index = PHASE_ORDER.indexOf(phase);
  if (index < 0) return [...IDLE_ALL];
  return IDLE_ALL.map((_, i) => {
    if (i < index) return "done";
    if (i === index) return "active";
    return "idle";
  });
}

export function createPhaseIndicatorController(els: PhaseIndicatorElements): {
  reset(): void;
  show(phase: CfopPhase): void;
  complete(phase: CfopPhase): void;
} {
  const segments = Array.from(els.cfopPhaseIndicator.querySelectorAll<HTMLElement>(".phase-seg"));
  let completedIndex = -1;

  function apply(states: PhaseIndicatorState[]): void {
    segments.forEach((seg, i) => {
      seg.dataset.state = states[i] ?? "idle";
    });
  }

  function reset(): void {
    completedIndex = -1;
    apply([...IDLE_ALL]);
  }

  function show(phase: CfopPhase): void {
    // 与复盘解析同样保留已经达到的边界，公式内部临时拆开下层不撤回进度。
    completedIndex = Math.max(completedIndex, PHASE_ORDER.indexOf(phase));
    apply(computePhaseIndicatorState(PHASE_ORDER[completedIndex]));
  }

  function complete(phase: CfopPhase): void {
    completedIndex = Math.max(completedIndex, PHASE_ORDER.indexOf(phase));
    apply(computePhaseIndicatorState(PHASE_ORDER[completedIndex]).map((state) => state === "active" ? "idle" : state));
  }

  return { reset, show, complete };
}
