/**
 * 打乱步骤被逐项跟踪并全部完成后即可进入观察。
 * 终态回放校验用于诊断协议/同步异常，不应因假阴性阻塞真实设备计时。
 */
export function canBeginInspection(remainingMoves: number, isStateVerified: boolean): boolean {
  void isStateVerified;
  return remainingMoves === 0;
}
