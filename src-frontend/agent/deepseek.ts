/**
 * agent/deepseek.ts
 * 浏览器端 AI 分析客户端（API 调用走后端，API_KEY 隔离）
 *
 * SSE 流式，逐 token 回调 + 最终结构化结果
 */

import type { AnalysisInput, AnalysisResult } from "./types.ts";
import { localAnalysisFallback } from "../../src-shared/local-analysis-fallback.ts";

const REQUEST_TIMEOUT_MS = 25_000;

export interface StreamProgress {
  /** 到目前为止累积的原始文本 */
  accumulated: string;
  /** 本次增量 */
  delta: string;
}

/**
 * 流式调用后端 /api/analyze?stream=true
 * onProgress 每收到一个 chunk 就被调用（可用于逐步渲染）
 * 返回最终校验后的 AnalysisResult
 */
export async function analyzeStreamWithDeepSeek(
  input: AnalysisInput,
  onProgress: (progress: StreamProgress) => void,
): Promise<AnalysisResult> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch("/api/analyze?stream=true", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    if (response.status === 429) {
      throw new Error("请求过于频繁，请稍后再试");
    }
    if (!response.ok) throw new Error(`后端错误: ${response.status}`);
    if (!response.body) throw new Error("响应体为空");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulated = "";
    let finalResult: AnalysisResult | null = null;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload) continue;
        try {
          const event = JSON.parse(payload) as { type: string; text?: string; result?: AnalysisResult; message?: string };
          if (event.type === "chunk" && event.text) {
            accumulated += event.text;
            onProgress({ accumulated, delta: event.text });
          } else if (event.type === "done" && event.result) {
            finalResult = event.result;
          } else if (event.type === "error") {
            throw new Error(event.message ?? "流式分析失败");
          }
        } catch (parseErr) {
          // 如果是业务抛出的 error 事件，向上传播
          if (parseErr instanceof Error && parseErr.message !== "Unexpected end of JSON input"
            && !parseErr.message.includes("JSON")) throw parseErr;
        }
      }
    }

    if (finalResult) return finalResult;
    // 流结束但没收到 done 事件——尝试从累积文本解析
    throw new Error("流结束但未收到完整结果");
  } catch (err) {
    if (err instanceof Error && err.message.includes("频繁")) throw err;
    console.error("[frontend] 流式调用失败，使用本地 fallback:", err);
    return localAnalysisFallback(input);
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
