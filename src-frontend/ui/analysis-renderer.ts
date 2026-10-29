import type { AnalysisInput, AnalysisResult, SolveReviewTarget } from "../../src-shared/analysis-types.ts";
import { resolveCoachingReplay } from "../../src-shared/analysis-coaching.ts";
import { SolveReplayPlayer } from "./solve-replay-player.ts";
import { renderAnalysisCard } from "./analysis-markup.ts";
import { createReviewTarget } from "../core/solve-review-session.ts";
import { F2lSolutionPanel } from "./f2l-solution-panel.ts";

export interface AnalysisRendererElements { agentOutput: HTMLDivElement; }

export interface AnalysisRendererCallbacks {
  log: (msg: string, type?: "info" | "move" | "error") => void;
  escapeHtml: (s: string) => string;
  onReview?: (target: SolveReviewTarget) => void;
  formulaLibrary: {
    openForBottleneck(stage: string, stageDuration: number, totalDuration: number): void;
    openFormulaPractice(formulaId: string): void;
  };
}

function getStageDuration(input: AnalysisInput, stage: string): number {
  if (stage === "Cross") return input.crossDuration;
  if (stage === "F2L") return input.f2lDuration;
  if (stage === "OLL") return input.ollDuration;
  if (stage === "PLL") return input.pllDuration;
  return 0;
}

export function createAnalysisRenderer(elements: AnalysisRendererElements, cb: AnalysisRendererCallbacks) {
  const { log, escapeHtml, formulaLibrary } = cb;
  const output = elements.agentOutput;
  let fullPlayer: SolveReplayPlayer | null = null;
  let issuePlayer: SolveReplayPlayer | null = null;
  let f2lPanel: F2lSolutionPanel | null = null;

  function showIssueReplay(input: AnalysisInput, evidenceId: string): void {
    const target = resolveCoachingReplay(input, evidenceId);
    const panel = output.querySelector<HTMLElement>("[data-issue-replay-panel]");
    const root = output.querySelector<HTMLElement>("[data-issue-replay-player]");
    if (!target || !panel || !root) return;
    fullPlayer?.pause();
    issuePlayer?.destroy();
    const title = `第 ${target.solveIndex + 1} 把 · 第 ${target.startMoveIndex + 1}–${target.endMoveIndex} 步`;
    const titleElement = output.querySelector<HTMLElement>("[data-issue-replay-title]");
    const description = output.querySelector<HTMLElement>("[data-issue-replay-description]");
    if (titleElement) titleElement.textContent = title;
    if (description) description.textContent = `${target.label}。从动作之前的原始局面开始，播放模式和动作时间见下方。`;
    panel.hidden = false;
    issuePlayer = new SolveReplayPlayer(root, target.solve, {
      title,
      onPlay: () => fullPlayer?.pause(),
      segment: { startMoveIndex: target.startMoveIndex, endMoveIndex: target.endMoveIndex },
    });
    f2lPanel?.render(target.solve);
    panel.focus({ preventScroll: true });
    panel.scrollIntoView({ block: "nearest" });
  }

  function renderAgentResult(result: AnalysisResult, input: AnalysisInput): void {
    f2lPanel?.destroy();
    fullPlayer?.destroy();
    issuePlayer?.destroy();
    fullPlayer = issuePlayer = null;
    output.innerHTML = renderAnalysisCard(result, input, escapeHtml);
    const f2lRoot = output.querySelector<HTMLElement>("[data-analysis-f2l]");
    if (f2lRoot) { f2lPanel = new F2lSolutionPanel(f2lRoot, escapeHtml); f2lPanel.render(input); }
    const fullRoot = output.querySelector<HTMLElement>("[data-analysis-solution-preview]");
    if (fullRoot && input.moves) fullPlayer = new SolveReplayPlayer(fullRoot, input, {
      title: "最近一把 · 完整解法", onPlay: () => issuePlayer?.pause(),
    });
    output.querySelectorAll<HTMLButtonElement>("[data-issue-replay-index]").forEach((button) => {
      button.addEventListener("click", () => {
        const evidenceId = result.issues?.[Number(button.dataset.issueReplayIndex)]?.evidenceId;
        if (evidenceId) showIssueReplay(input, evidenceId);
      });
    });
    output.querySelector<HTMLButtonElement>("#btn-practice")?.addEventListener("click", () => {
      const stage = result.bottleneckStage ?? "";
      formulaLibrary.openForBottleneck(stage, getStageDuration(input, stage), input.totalDuration);
    });
    output.querySelectorAll<HTMLButtonElement>("[data-issue-review-index]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = result.issues?.[Number(button.dataset.issueReviewIndex)]?.evidenceId;
        const replay = id ? resolveCoachingReplay(input, id) : null;
        if (!replay) return;
        const event = replay.solve.caseEvents?.find((item) => item.startMoveIndex === replay.startMoveIndex && item.endMoveIndex === replay.endMoveIndex);
        const target = createReviewTarget(replay.solve, event);
        if (target && id?.startsWith("f2l-solution:")) target.goal = {
          kind: "moves", baseline: target.moveCount,
          reason: "从 F2L 少步建议重练原题，比较整把步数（相邻同面合并）",
        };
        if (target) cb.onReview?.(target);
        else log("此记录缺少可验证的原题与完整解法，无法重练", "error");
      });
    });
    output.querySelectorAll<HTMLButtonElement>("[data-focus-formula-index]").forEach((button) => {
      button.addEventListener("click", () => {
        const entry = result.focusFormulas?.[Number(button.dataset.focusFormulaIndex)];
        if (!entry) return;
        if (entry.formulaId) formulaLibrary.openFormulaPractice(entry.formulaId);
        else formulaLibrary.openForBottleneck(entry.stage, getStageDuration(input, entry.stage), input.totalDuration);
      });
    });
    log(`分析完成：最近 ${input.analysisScope ?? 1} 把；${result.source === "ai" ? "DeepSeek" : "本地规则"}`);
  }

  return { renderAgentResult };
}
