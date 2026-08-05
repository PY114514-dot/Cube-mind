import { analyzeStreamWithDeepSeek } from "./deepseek.ts";
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
  /** 分析前钩子：可注入 sessionContext 等额外输入 */
  onBeforeAnalyze?: (input: AnalysisInput) => void;
  /** 分析后钩子：可记录 session entry */
  onAfterAnalyze?: (result: AnalysisResult, input: AnalysisInput) => void;
  /** 弹窗打开时钩子：可渲染训练计划等持久 UI */
  onModalOpen?: () => void;
}

export function bindAnalysisController(options: AnalysisControllerOptions): void {
  const { elements, getRecords, renderResult, log, onBeforeAnalyze, onAfterAnalyze, onModalOpen } = options;
  elements.btnOpenAgent.onclick = () => {
    const validCount = getRecords().filter((solve) => solve.analysisEligible ?? isSolveEligible(solve.qualityStatus)).length;
    elements.analysisCount.max = String(Math.max(1, validCount));
    elements.analysisCount.value = String(Math.min(12, validCount || 1));
    const notice = getAnalysisSampleNotice(validCount);
    elements.analysisSampleStatus.textContent = notice;
    // 根据样本数量应用不同的样式
    elements.analysisSampleStatus.className = validCount <= 0 ? "sample-notice error" : validCount < 5 ? "sample-notice warning" : "sample-notice info";
    elements.agentModal.classList.add("open");
    if (onModalOpen) onModalOpen();
  };
  elements.btnRunAnalysis.onclick = async () => {
    const validCount = getRecords().filter((solve) => solve.analysisEligible ?? isSolveEligible(solve.qualityStatus)).length;
    const scope = Math.min(validCount, Math.max(1, Math.floor(Number(elements.analysisCount.value)) || 1));
    const input = createHistoryAnalysisInput(getRecords(), scope);
    if (!input) {
      elements.agentOutput.innerHTML = '<p class="placeholder">请先完成至少一把，才可以分析历史数据。</p>';
      return;
    }
    if (onBeforeAnalyze) onBeforeAnalyze(input);
    elements.analysisCount.value = String(scope);
    elements.btnRunAnalysis.disabled = true;
    elements.btnRunAnalysis.textContent = "分析中…";
    // 流式渲染：脉冲动画 + 逐步增长的原始文本
    elements.agentOutput.innerHTML = `
      <div class="stream-container">
        <div class="stream-header"><span class="stream-dot"></span>AI 教练正在分析最近 ${scope} 把…</div>
        <pre class="stream-raw"></pre>
      </div>`;
    const streamRaw = elements.agentOutput.querySelector(".stream-raw") as HTMLElement | null;
    log(`调用 DeepSeek（流式）：分析最近 ${scope} 把`);
    try {
      const result = await analyzeStreamWithDeepSeek(input, ({ accumulated }) => {
        if (streamRaw) streamRaw.textContent = accumulated;
      });
      renderResult(result, input);
      if (onAfterAnalyze) onAfterAnalyze(result, input);
    } catch (error) {
      console.error("[analysis-controller] 分析失败:", error);
      elements.agentOutput.innerHTML = '<p class="placeholder">AI 分析失败，请稍后重试。</p>';
    } finally {
      elements.btnRunAnalysis.disabled = false;
      elements.btnRunAnalysis.textContent = "开始分析";
    }
  };
}
