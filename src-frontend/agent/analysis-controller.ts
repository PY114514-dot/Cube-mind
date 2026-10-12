import { analyzeStreamWithDeepSeek } from "./deepseek.ts";
import type { AnalysisInput, AnalysisResult } from "./types.ts";
import { createHistoryAnalysisInput, getAnalysisEligibleSolves } from "./analysis-input.ts";
import { MAX_ANALYSIS_SOLVES } from "../../src-shared/analysis-coaching.ts";
import { getAnalysisSampleNotice } from "../core/data-quality.ts";

export interface AnalysisControllerElements {
  btnOpenAgent: HTMLButtonElement;
  analysisCount: HTMLInputElement;
  analysisSampleStatus: HTMLElement;
  btnRunAnalysis: HTMLButtonElement;
  agentModal: HTMLDivElement;
  agentOutput: HTMLDivElement;
  /** 抽屉背后的轻遮罩，与抽屉同步开合 */
  agentBackdrop: HTMLElement;
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

function showSampleNotice(elements: AnalysisControllerElements, count: number): void {
  elements.analysisSampleStatus.textContent = `${getAnalysisSampleNotice(count)} 分析窗口上限 ${MAX_ANALYSIS_SOLVES} 把，实际使用已有的有效常规成绩。`;
  elements.analysisSampleStatus.className = count <= 0 ? "sample-notice error" : count < 5 ? "sample-notice warning" : "sample-notice info";
}

export function bindAnalysisController(options: AnalysisControllerOptions): void {
  const { elements, getRecords, renderResult, log, onBeforeAnalyze, onAfterAnalyze, onModalOpen } = options;
  const selectedScope = (): number => {
    return Math.min(MAX_ANALYSIS_SOLVES, Math.max(1, Math.floor(Number(elements.analysisCount.value)) || 1));
  };
  elements.analysisCount.max = String(MAX_ANALYSIS_SOLVES);
  elements.analysisCount.oninput = () => showSampleNotice(elements, Math.min(selectedScope(), getAnalysisEligibleSolves(getRecords()).length));
  elements.btnOpenAgent.onclick = () => {
    const validCount = Math.min(MAX_ANALYSIS_SOLVES, getAnalysisEligibleSolves(getRecords()).length);
    elements.analysisCount.value = String(Math.min(12, validCount || 1));
    showSampleNotice(elements, Math.min(selectedScope(), validCount));
    elements.agentModal.classList.add("open");
    elements.agentBackdrop.classList.add("open");
    if (onModalOpen) onModalOpen();
  };
  elements.btnRunAnalysis.onclick = async () => {
    const requestedScope = selectedScope();
    const input = createHistoryAnalysisInput(getRecords(), requestedScope);
    const scope = input?.analysisScope ?? 0;
    showSampleNotice(elements, scope);
    if (!input) {
      elements.agentOutput.innerHTML = '<p class="placeholder">请先完成至少一把，才可以分析历史数据。</p>';
      return;
    }
    if (onBeforeAnalyze) onBeforeAnalyze(input);
    elements.analysisCount.value = String(requestedScope);
    elements.btnRunAnalysis.disabled = true;
    elements.btnRunAnalysis.textContent = "分析中…";
    // 状态动画：脉冲圆点 + 随生成进度推进的阶段文案，不回显原始流式文本。
    const stageMessages = [
      `正在读取最近 ${scope} 把成绩…`,
      "正在拆分四阶段用时…",
      "正在识别瓶颈与弱项…",
      "正在生成训练建议与公式指派…",
    ];
    elements.agentOutput.innerHTML = `
      <div class="stream-container">
        <div class="stream-header" aria-live="polite"><span class="stream-dot"></span><span class="stream-status">${stageMessages[0]}</span></div>
      </div>`;
    const streamStatus = elements.agentOutput.querySelector(".stream-status") as HTMLElement | null;
    log(`调用 DeepSeek（流式）：分析最近 ${scope} 把`);
    try {
      const result = await analyzeStreamWithDeepSeek(input, ({ accumulated }) => {
        if (streamStatus) {
          // 生成量越大阶段越靠后；最后一档保持到完成，让用户感知分析已接近收尾。
          const stageIndex = Math.min(stageMessages.length - 1, Math.floor(accumulated.length / 120));
          streamStatus.textContent = stageMessages[stageIndex];
        }
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

/** 绑定 AI 教练抽屉内的标签页切换，返回供外部调用的切换函数（如局面提问后切回复盘页）。 */
export function bindAgentTabs(agentModal: HTMLElement): (tabName: "analysis" | "editor") => void {
  const tabs = Array.from(agentModal.querySelectorAll<HTMLButtonElement>(".agent-tab"));
  const panels = Array.from(agentModal.querySelectorAll<HTMLElement>("[data-agent-panel]"));
  const showTab = (tabName: "analysis" | "editor"): void => {
    tabs.forEach((tab) => {
      const active = tab.dataset.agentTab === tabName;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    panels.forEach((panel) => { panel.hidden = panel.dataset.agentPanel !== tabName; });
  };
  tabs.forEach((tab) => tab.addEventListener("click", () => showTab((tab.dataset.agentTab ?? "analysis") as "analysis" | "editor")));
  return showTab;
}
