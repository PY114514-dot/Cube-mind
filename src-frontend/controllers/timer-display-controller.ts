/**
 * 计时器显示 + 观察期状态机控制器
 * 管理：计时数字刷新（50ms interval）、WCA 观察期倒计时、penalty 判定
 * 不管理：start/stop solve 逻辑（与 BLE move 和 analysis 管线耦合，留在 main.ts）
 */

import { Timer } from "../core/timer.ts";
import { getInspectionOutcome, type InspectionPenalty } from "../core/inspection-rules.ts";

export type InspectionMode = "idle" | "limited" | "free" | "ready";

export interface TimerDisplayElements {
  timerDisplay: HTMLElement;
  inspectionStatus: HTMLElement;
}

export interface TimerDisplayCallbacks {
  /** 是否为练习自由观察模式 */
  isPracticeObservation: () => boolean;
  /** 读取观察期设置 */
  getInspectionSettings: () => { enabled: boolean; seconds: number };
  /** 日志 */
  log: (message: string, level?: "info" | "move" | "error") => void;
}

export class TimerDisplayController {
  private timer: Timer;
  private els: TimerDisplayElements;
  private cb: TimerDisplayCallbacks;

  private _inspectionMode: InspectionMode = "idle";
  private inspectionInterval: number | null = null;
  private inspectionStartedAt = 0;
  private pendingPenalty: InspectionPenalty = "none";
  private displayInterval: number | null = null;

  constructor(timer: Timer, elements: TimerDisplayElements, callbacks: TimerDisplayCallbacks) {
    this.timer = timer;
    this.els = elements;
    this.cb = callbacks;
  }

  get inspectionMode(): InspectionMode {
    return this._inspectionMode;
  }

  /** 获取观察用时（毫秒），仅在有限观察模式下有效 */
  getInspectionDuration(): number {
    if (this._inspectionMode === "limited" && this.inspectionStartedAt > 0) {
      return Date.now() - this.inspectionStartedAt;
    }
    return 0;
  }

  // ====== 计时数字显示 ======

  updateDisplay(): void {
    const ms = this.timer.getDuration();
    this.els.timerDisplay.textContent = (ms / 1000).toFixed(2);
  }

  startDisplay(): void {
    if (this.displayInterval) return;
    this.displayInterval = window.setInterval(() => this.updateDisplay(), 50);
  }

  stopDisplay(): void {
    if (this.displayInterval) {
      clearInterval(this.displayInterval);
      this.displayInterval = null;
    }
  }

  // ====== 观察期状态机 ======

  beginInspection(): void {
    this.pendingPenalty = "none";
    this.inspectionStartedAt = 0;

    if (this.cb.isPracticeObservation()) {
      this._inspectionMode = "free";
      this.els.inspectionStatus.hidden = false;
      this.els.inspectionStatus.textContent = "自由观察 · 转动第一步后开始计时";
      this.els.timerDisplay.textContent = "观察";
      this.cb.log("进入练习自由观察：转动第一步开始计时");
      return;
    }

    const settings = this.cb.getInspectionSettings();
    if (!settings.enabled || settings.seconds === 0) {
      this._inspectionMode = "ready";
      this.els.inspectionStatus.hidden = false;
      this.els.inspectionStatus.textContent = "准备就绪 · 转动第一步后开始计时";
      this.els.timerDisplay.textContent = "0.00";
      this.cb.log("打乱完成：转动第一步开始计时");
      return;
    }

    this._inspectionMode = "limited";
    this.inspectionStartedAt = Date.now();
    this.renderCountdown();
    this.inspectionInterval = window.setInterval(() => this.renderCountdown(), 50);
    this.cb.log(`进入 ${settings.seconds} 秒观察：转动第一步开始计时`);
  }

  /** 结束观察期，返回并重置 penalty（供 startSolveTimer 消费） */
  consumePenalty(): InspectionPenalty {
    if (this._inspectionMode === "limited" && this.inspectionStartedAt > 0) {
      const settings = this.cb.getInspectionSettings();
      const outcome = getInspectionOutcome(Date.now() - this.inspectionStartedAt, settings.seconds);
      this.pendingPenalty = outcome.penalty;
      if (outcome.penalty === "plus2") this.cb.log("观察超时：本把成绩将加 2 秒", "error");
      if (outcome.penalty === "dnf") this.cb.log("观察超过 DNF 时限：本把将记录为 DNF", "error");
    }
    this.endInspection();
    const penalty = this.pendingPenalty;
    this.pendingPenalty = "none";
    return penalty;
  }

  endInspection(): void {
    this.stopCountdown();
    this._inspectionMode = "idle";
    this.inspectionStartedAt = 0;
    this.els.inspectionStatus.hidden = true;
    this.els.inspectionStatus.textContent = "";
  }

  // ====== 内部 ======

  private renderCountdown(): void {
    if (this._inspectionMode !== "limited") return;
    const settings = this.cb.getInspectionSettings();
    const outcome = getInspectionOutcome(Date.now() - this.inspectionStartedAt, settings.seconds);
    this.els.inspectionStatus.hidden = false;
    this.els.inspectionStatus.textContent = `观察 ${outcome.display} · 转动第一步后开始计时`;
    this.els.timerDisplay.textContent = outcome.display;
  }

  private stopCountdown(): void {
    if (this.inspectionInterval !== null) {
      clearInterval(this.inspectionInterval);
      this.inspectionInterval = null;
    }
  }
}
