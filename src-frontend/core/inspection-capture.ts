/** 在结束观察时先读取时长，再消费罚时；consume 会清空观察状态。 */

import type { InspectionPenalty } from "./inspection-rules.ts";

export interface InspectionSource {
  getInspectionDuration(): number;
  consumePenalty(): InspectionPenalty;
}

export interface CapturedInspection {
  duration: number;
  penalty: InspectionPenalty;
}

export function captureInspection(source: InspectionSource): CapturedInspection {
  const duration = source.getInspectionDuration();
  const penalty = source.consumePenalty();
  return { duration, penalty };
}
