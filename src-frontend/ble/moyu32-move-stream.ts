/** WCU_MY32 动作窗口恢复：将最近 5 步窗口转换成连续动作与缺口结论。 */

export interface Moyu32StreamMove {
  move: string;
  timestamp: number;
  moveCnt: number;
}

/** 流恢复只需要动作与设备间隔，不能绑定具体的魔域包解析实现。 */
export interface Moyu32WindowMove {
  move: string;
  timestamp: number;
}

export interface Moyu32MoveStreamResult {
  emitted: Moyu32StreamMove[];
  missing: number;
}

export class Moyu32MoveStream {
  private previousMoveCnt = -1;

  reset(baseline = -1): void {
    this.previousMoveCnt = baseline;
  }

  accept(moveCnt: number, moves: Moyu32WindowMove[]): Moyu32MoveStreamResult {
    if (this.previousMoveCnt === -1) {
      this.previousMoveCnt = moveCnt;
      return { emitted: [], missing: 0 };
    }
    const moveDiff = (moveCnt - this.previousMoveCnt) & 0xff;
    this.previousMoveCnt = moveCnt;
    const emittedCount = Math.min(moveDiff, moves.length);
    // WCU 缓存从最新到最旧排列；反转后得到可直接交给上层的时间正序动作。
    const emitted = moves.slice(0, emittedCount).reverse().map((move, index) => ({
      move: move.move,
      timestamp: move.timestamp,
      moveCnt: (moveCnt - emittedCount + index + 1) & 0xff,
    }));
    return { emitted, missing: Math.max(0, moveDiff - moves.length) };
  }
}
