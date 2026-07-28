/**
 * core/timer.ts
 * 计时器 + 停顿检测
 *
 * 设计：
 *   - 按下物理按键或键盘空格开始
 *   - 转动魔方 → 通过 onMove 回调喂入 move 事件
 *   - 每次 move 记录 locTime（接收时间）
 *   - 相邻 move 间隔 >300ms 标记为"思考停顿"
 *   - 停顿用时 = 超过阈值的相邻动作间隔之和
 */

export interface TimerState {
  isRunning: boolean;
  startTime: number;
  endTime: number;
  moves: { move: string; timestamp: number; gapFromPrev: number }[];
}

export type TimerCallback = (state: TimerState) => void;

export class Timer {
  private state: TimerState = {
    isRunning: false,
    startTime: 0,
    endTime: 0,
    moves: [],
  };
  private onFinishCb: TimerCallback | null = null;

  /** 开始计时 */
  start(): void {
    this.state = {
      isRunning: true,
      startTime: Date.now(),
      endTime: 0,
      moves: [],
    };
  }

  /** 喂入一个 move 事件 */
  addMove(moveStr: string): void {
    if (!this.state.isRunning) return;
    const now = Date.now();
    const gap = this.state.moves.length > 0
      ? now - this.state.moves[this.state.moves.length - 1].timestamp
      : 0;
    this.state.moves.push({ move: moveStr, timestamp: now, gapFromPrev: gap });
  }

  /** 停止计时（魔方还原完成） */
  stop(endTime = Date.now()): void {
    if (!this.state.isRunning) return;
    this.state.isRunning = false;
    this.state.endTime = endTime;
    this.onFinishCb?.(this.state);
  }

  /** 重置 */
  reset(): void {
    this.state = { isRunning: false, startTime: 0, endTime: 0, moves: [] };
  }

  getState(): TimerState {
    return this.state;
  }

  /** 总用时（毫秒） */
  getDuration(): number {
    if (this.state.isRunning) return Date.now() - this.state.startTime;
    if (!this.state.endTime) return 0;
    return this.state.endTime - this.state.startTime;
  }

  onFinish(cb: TimerCallback): void { this.onFinishCb = cb; }
}

/** 检测停顿阈值（毫秒） */
export const PAUSE_THRESHOLD = 300;

/** 从 move 时间戳数组提取思考停顿总时长，而非完整阶段用时。 */
export function calcPauseDuration(timestamps: number[]): number {
  if (timestamps.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < timestamps.length; i++) {
    const gap = timestamps[i] - timestamps[i - 1];
    if (gap > PAUSE_THRESHOLD) total += gap;
  }
  return total;
}
