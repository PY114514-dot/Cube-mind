/** GAN v4 动作流恢复：隐藏计数回绕、缓冲排序和 history 注入，只返回可安全提交的动作。 */

export interface GanV4StreamMove {
  moveCnt: number;
  move: string;
  timestamp: number | null;
  locTime: number | null;
}

export interface GanV4MoveGap {
  previousMoveCnt: number;
  nextMoveCnt: number;
  missing: number;
}

export interface GanV4StreamResult {
  emitted: GanV4StreamMove[];
  gap: GanV4MoveGap | null;
  overflowed: boolean;
}

export class GanV4MoveStream {
  private previousMoveCnt = -1;
  private buffer: GanV4StreamMove[] = [];

  get hasBaseline(): boolean { return this.previousMoveCnt !== -1; }
  get previous(): number { return this.previousMoveCnt; }
  get nextBufferedMoveCnt(): number | null { return this.buffer[0]?.moveCnt ?? null; }

  reset(baseline = -1): void {
    this.previousMoveCnt = baseline;
    this.buffer = [];
  }

  acceptLive(moves: GanV4StreamMove[]): GanV4StreamResult {
    for (const move of moves) {
      if (move.moveCnt === this.previousMoveCnt || this.buffer.some((item) => item.moveCnt === move.moveCnt)) continue;
      this.buffer.push(move);
    }
    return this.drain();
  }

  acceptHistory(moves: GanV4StreamMove[]): GanV4StreamResult {
    for (const move of moves) this.injectHistoryMove(move);
    return this.drain();
  }

  private injectHistoryMove(move: GanV4StreamMove): void {
    if (this.buffer.some((item) => item.moveCnt === move.moveCnt)) return;
    const head = this.buffer[0];
    if (!head) {
      if (isMoveNumberInRange(this.previousMoveCnt, move.moveCnt, move.moveCnt, false, true)) this.buffer.unshift(move);
      return;
    }
    if (!isMoveNumberInRange(this.previousMoveCnt, head.moveCnt, move.moveCnt)) return;
    if (move.moveCnt === ((head.moveCnt - 1) & 0xff)) this.buffer.unshift(move);
  }

  private drain(): GanV4StreamResult {
    const emitted: GanV4StreamMove[] = [];
    while (this.buffer.length > 0) {
      const head = this.buffer[0];
      const missing = (head.moveCnt - this.previousMoveCnt) & 0xff;
      if (missing > 1) {
        if (this.buffer.length > 16) {
          this.reset();
          return { emitted, gap: null, overflowed: true };
        }
        return {
          emitted,
          gap: { previousMoveCnt: this.previousMoveCnt, nextMoveCnt: head.moveCnt, missing },
          overflowed: false,
        };
      }
      const move = this.buffer.shift();
      if (!move) break;
      this.previousMoveCnt = move.moveCnt;
      emitted.push(move);
    }
    return { emitted, gap: null, overflowed: false };
  }
}

function isMoveNumberInRange(start: number, end: number, moveCnt: number, closedStart = false, closedEnd = false): boolean {
  return ((end - start) & 0xff) >= ((moveCnt - start) & 0xff)
    && (closedStart || ((start - moveCnt) & 0xff) > 0)
    && (closedEnd || ((end - moveCnt) & 0xff) > 0);
}
