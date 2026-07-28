/**
 * agent/deepseek.ts
 * 浏览器端只保留本地 fallback（API 调用已移到后端）
 *
 * 设计：浏览器通过 fetch 调用后端 /api/analyze，API_KEY 隔离在后端
 */

import type { AnalysisInput, AnalysisResult } from "./types.ts";
import { localAnalysisFallback } from "../../src-shared/local-analysis-fallback.ts";

/** 调用后端 /api/analyze */
export async function analyzeWithDeepSeek(input: AnalysisInput): Promise<AnalysisResult> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`后端错误: ${response.status}`);
    return await response.json();
  } catch (err) {
    console.error("[frontend] 调用后端失败，使用本地 fallback:", err);
    return localAnalysisFallback(input);
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

/** 本地规则引擎 fallback */
export const localFallback = localAnalysisFallback;
