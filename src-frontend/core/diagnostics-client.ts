export type DiagnosticMode = "normal" | "formula" | "cross" | "f2l" | "cross-f2l";

export interface DiagnosticEvent {
  kind: "scramble" | "solve";
  occurredAt: number;
  scramble: string;
  mode: DiagnosticMode;
  formulaId?: string;
  moves?: string[];
  totalDuration?: number;
  qualityStatus?: string;
  qualityAnomalies?: string[];
}

/** 诊断日志不可阻塞计时；服务暂不可用时仅保留控制台错误。 */
export async function sendDiagnosticEvent(event: DiagnosticEvent): Promise<void> {
  try {
    const response = await fetch("/api/diagnostics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    console.error("[diagnostics] 上报失败:", error);
  }
}
