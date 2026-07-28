import { analyzeWithDeepSeek } from "./deepseek.ts";
import type { AnalysisInput, AnalysisResult } from "./types.ts";
import { createHistoryAnalysisInput } from "./analysis-input.ts";
import { isSolveEligible } from "../core/solve-validation.ts";
import { getAnalysisSampleNotice } from "../core/data-quality.ts";

export interface AnalysisControllerElements {
  btnOpenAgent: HTMLButtonElement;
  analysisCount: HTMLInputElement;
  analysisSampleStatus: HTMLElement;
  btnRunAnalysis: HTMLButtonElement;
  agentModal: HTMLDivElement;
  agentOutput: HTMLDivElement;
}

export interface AnalysisControllerOptions {
  elements: AnalysisControllerElements;
  getRecords: () => AnalysisInput[];
  renderResult: (result: AnalysisResult, input: AnalysisInput) => void;
  log: (message: string) => void;
}

export function bindAnalysisController(options: AnalysisControllerOptions): void {
  const { elements, getRecords, renderResult, log } = options;
  elements.btnOpenAgent.onclick = () => {
    const validCount = getRecords().filter((solve) => isSolveEligible(solve.qualityStatus)).length;
    elements.analysisCount.max = String(Math.max(1, validCount));
    elements.analysisCount.value = String(Math.min(12, validCount || 1));
    elements.analysisSampleStatus.textContent = getAnalysisSampleNotice(validCount);
    elements.agentModal.classList.add("open");
  };
  elements.btnRunAnalysis.onclick = async () => {
    const validCount = getRecords().filter((solve) => isSolveEligible(solve.qualityStatus)).length;
    const scope = Math.min(validCount, Math.max(1, Math.floor(Number(elements.analysisCount.value)) || 1));
    const input = createHistoryAnalysisInput(getRecords(), scope);
    if (!input) {
      elements.agentOutput.innerHTML = '<p class="placeholder">请先完成至少一把，才可以分析历史数据。</p>';
      return;
    }
    elements.analysisCount.value = String(scope);
    elements.btnRunAnalysis.disabled = true;
    elements.btnRunAnalysis.textContent = "分析中…";
    elements.agentOutput.innerHTML = `<p class="placeholder">正在分析最近 ${scope} 把成绩…</p>`;
    log(`调用 DeepSeek：分析最近 ${scope} 把`);
    try {
      renderResult(await analyzeWithDeepSeek(input), input);
    } catch (error) {
      console.error("[analysis-controller] 分析失败:", error);
      elements.agentOutput.innerHTML = '<p class="placeholder">AI 分析失败，请稍后重试。</p>';
    } finally {
      elements.btnRunAnalysis.disabled = false;
      elements.btnRunAnalysis.textContent = "开始分析";
    }
  };
}
