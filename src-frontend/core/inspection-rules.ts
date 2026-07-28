/** WCA 观察期判定；时间单位统一为毫秒。 */

export const WCA_PLUS_TWO_WINDOW_MS = 2_000;

export type InspectionPenalty = "none" | "plus2" | "dnf";

export interface InspectionOutcome {
  penalty: InspectionPenalty;
  display: string;
}

/**
 * WCA 观察规则：超过限定时间为 +2，超过限定时间两秒后为 DNF。
 * 自定义观察时长沿用相同的两秒处罚窗口；默认 15 秒时即为 WCA 的 15/17 秒规则。
 */
export function getInspectionOutcome(elapsedMs: number, inspectionSeconds: number): InspectionOutcome {
  const limitMs = Math.max(0, inspectionSeconds) * 1_000;
  if (elapsedMs > limitMs + WCA_PLUS_TWO_WINDOW_MS) return { penalty: "dnf", display: "DNF" };
  if (elapsedMs >= limitMs) return { penalty: elapsedMs > limitMs ? "plus2" : "none", display: "+2" };
  return { penalty: "none", display: String(Math.max(0, Math.ceil((limitMs - elapsedMs) / 1_000))) };
}
