import type { AnalysisInput, SolveReviewTarget } from "../../src-shared/analysis-types.ts";
import type { AppState } from "../core/app-state.ts";
import { compareReviewSolve, selectDailyReview, summarizeReviewSession, type SolveReviewSession } from "../core/solve-review-session.ts";
import { renderReviewCandidates, renderReviewComparison } from "../ui/solve-review-markup.ts";

export interface SolveReviewElements {
  reviewList: HTMLElement;
  reviewHome: HTMLElement;
  reviewBanner: HTMLElement;
  reviewInfo: HTMLElement;
  reviewSummary: HTMLElement;
  btnStartReview: HTMLButtonElement;
  btnEndReview: HTMLButtonElement;
  btnNextScramble: HTMLButtonElement;
  resultNextAction: HTMLElement;
}

export interface SolveReviewDependencies {
  isRunning: () => boolean;
  loadScramble: (scramble: string) => void;
  newScramble: () => Promise<void>;
  updatePracticeBanner: () => void;
  closeOverlays: () => void;
  escapeHtml: (text: string) => string;
  log: (text: string, level?: "info" | "move" | "error") => void;
}

/** 连续复习只编排现有计时链路；队列留在会话，原题快照随成绩持久化。 */
export function createSolveReviewController(els: SolveReviewElements, state: AppState, deps: SolveReviewDependencies) {
  let candidates: SolveReviewTarget[] = [];

  const render = (): void => { candidates = renderQueue(els, state, deps); };

  function prepare(): void {
    const session = state.review;
    if (!session) return;
    session.result = null;
    deps.closeOverlays();
    deps.loadScramble(session.queue[session.index].scramble);
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function start(queue: SolveReviewTarget[]): void {
    if (!queue.length) return;
    if (deps.isRunning() || state.solve.isFinalizing) {
      deps.log("请先完成或停止当前计时，再开始原题复习", "error");
      return;
    }
    clearPractice(state);
    deps.updatePracticeBanner();
    state.review = { queue, index: 0, result: null, attempts: [] };
    els.reviewSummary.textContent = "";
    prepare();
    deps.log(`开始原题复习，共 ${queue.length} 题；成绩单独保存`);
  }

  function cancel(): void {
    if (!state.review) return;
    els.reviewSummary.textContent = `本组复习：${summarizeReviewSession(state.review)}`;
    state.review = null;
    render();
  }

  function finish(): void {
    cancel();
    deps.closeOverlays();
    void deps.newScramble();
  }

  function next(): void {
    const session = state.review;
    if (!session) return;
    if (session.result && compareReviewSolve(session.result).completed) {
      if (session.index === session.queue.length - 1) { finish(); return; }
      session.index++;
    }
    prepare();
  }

  function complete(input: AnalysisInput): void {
    const session = state.review;
    if (!session || input.review !== session.queue[session.index]) return;
    session.result = input;
    session.attempts.push(input);
    renderResult(els, session, input, deps.escapeHtml);
    render();
  }

  els.btnStartReview.onclick = () => start(candidates);
  els.btnEndReview.onclick = finish;
  els.reviewHome.onclick = () => start(candidates);
  els.reviewList.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-review-start]") : null;
    const target = button ? candidates[Number(button.dataset.reviewStart)] : undefined;
    if (target) start([target]);
  });
  els.resultNextAction.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest("[data-review-again]")) prepare();
    if (event.target.closest("[data-review-next]")) next();
  });
  return { init: () => watchReviewDay(render), start, render, next, retry: prepare, complete, cancel };
}

function renderQueue(els: SolveReviewElements, state: AppState, deps: SolveReviewDependencies): SolveReviewTarget[] {
  const daily = selectDailyReview(state.recentSolves);
  const candidates = daily.targets;
  const date = new Date(daily.date).toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
  const description = `昨日 ${date} · ${daily.sampleCount} 把可信常规复原 · ${candidates.length} 道原题`;
  els.reviewList.innerHTML = `<p class="review-hint">${description}</p>${renderReviewCandidates(candidates, deps.escapeHtml)}`;
  els.btnStartReview.disabled = candidates.length === 0;
  els.btnStartReview.textContent = `连续复习${candidates.length ? ` ${candidates.length} 题` : ""}`;
  els.reviewHome.innerHTML = `<div class="review-home-copy"><strong>今日智能复习${candidates.length ? ` · ${candidates.length} 题` : ""}</strong><span>${description}</span></div>
    ${candidates.length ? '<button type="button" class="ghost" data-review-all>开始复习</button>' : '<span>昨天暂无可复习成绩</span>'}`;
  els.reviewHome.hidden = false;
  const session = state.review;
  els.reviewBanner.hidden = !session;
  els.btnNextScramble.textContent = !session ? "新打乱" : session.result && compareReviewSolve(session.result).completed
    ? (session.index === session.queue.length - 1 ? "结束复习" : "下一题") : "重置本题";
  if (session) els.reviewInfo.textContent = `原题复习 ${session.index + 1}/${session.queue.length} · ${session.queue[session.index].goal.reason}`;
  return candidates;
}

function watchReviewDay(render: () => void): void {
  let timer: number | undefined;
  const refresh = (): void => {
    window.clearTimeout(timer);
    render();
    const next = new Date(Date.now());
    next.setHours(24, 0, 0, 0);
    timer = window.setTimeout(refresh, Math.max(1, next.getTime() - Date.now()));
  };
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  refresh();
}

function renderResult(els: SolveReviewElements, session: SolveReviewSession, input: AnalysisInput, escapeHtml: SolveReviewDependencies["escapeHtml"]): void {
  const completed = compareReviewSolve(input).completed;
  const last = session.index === session.queue.length - 1;
  const summary = summarizeReviewSession(session);
  els.reviewSummary.textContent = `本组复习：${summary}`;
  els.resultNextAction.innerHTML = `<section class="result-action-card" aria-live="polite">
    <span>原题复习 · 第 ${session.index + 1}/${session.queue.length} 题</span>
    ${renderReviewComparison(input, escapeHtml)}
    <p>${summary}</p><div class="review-actions">
      <button type="button" class="secondary" data-review-again>再练一次</button>
      ${completed ? `<button type="button" data-review-next>${last ? "结束本组，回到计时" : "下一题"}</button>` : ""}
    </div></section>`;
}

function clearPractice(state: AppState): void {
  state.practice.session = null;
  state.practice.blockMode = null;
  state.practice.pendingFormula = null;
  state.practice.pendingCandidates = [];
  state.practice.needsRetry = false;
  state.practice.caseVerified = false;
}
