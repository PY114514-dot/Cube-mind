/**
 * Cross / X-Cross 求解 UI：按钮绑定、异步求解与结果渲染。
 *
 * 从 main.ts 抽出。求解函数本身在 core/cross-solver.ts，本控制器只负责
 * 交互时序（防重复点击、setTimeout 解阻塞）与 DOM 文案渲染。
 */

import { convertSolutionForWhiteDown, solveCross, solveXCross } from "../core/cross-solver.ts";

export interface CrossSolverElements {
  btnSolveCross: HTMLButtonElement;
  btnSolveXCross: HTMLButtonElement;
  crossSolution: HTMLDivElement;
  xcrossSolution: HTMLDivElement;
}

export interface CrossSolverDependencies {
  getCurrentScramble: () => string;
  getCrossMaxSteps: () => number;
  escapeHtml: (s: string) => string;
}

// 白底朝下时的颜色与槽位命名（与 cross-solver 的面朝向约定一致）
const COLOR_NAMES: Record<string, string> = { U: "白", R: "红", F: "绿", D: "黄", L: "橙", B: "蓝" };
const SLOT_NAMES: Record<string, Record<string, string>> = {
  D: { F: "绿-红", R: "红-蓝", B: "蓝-橙", L: "橙-绿" },
  U: { F: "绿-橙", R: "红-绿", B: "蓝-红", L: "橙-蓝" },
};
const FRONT_ORDER = ["R", "B", "L", "F"] as const;
const HOLD_ORDER = ["F", "R", "B", "L"] as const;
const HOLD_NAMES: Record<string, string> = {
  F: "白底绿前",
  R: "白底红前",
  B: "白底蓝前",
  L: "白底橙前",
};

export function createCrossSolverController(
  els: CrossSolverElements,
  deps: CrossSolverDependencies,
) {
  function handleSolveCross(): void {
    if (!deps.getCurrentScramble()) {
      els.crossSolution.hidden = false;
      els.crossSolution.textContent = "请先生成打乱。";
      return;
    }
    els.btnSolveCross.disabled = true;
    els.crossSolution.hidden = false;
    els.crossSolution.textContent = "正在计算十字解法…";
    window.setTimeout(() => {
      try {
        const targetFace = "U";
        const solution = solveCross(deps.getCurrentScramble(), targetFace, deps.getCrossMaxSteps());
        const displaySolution = convertSolutionForWhiteDown(solution, "F");
        const difficulty = solution.length <= 4 ? "简单" : solution.length <= 6 ? "中等" : "困难";
        els.crossSolution.innerHTML = solution.length > 0
          ? `白色 Cross（绿面前）：<code>${deps.escapeHtml(displaySolution.join(" "))}</code>（${solution.length} 步，${difficulty}）`
          : `未在 ${deps.getCrossMaxSteps()} 步搜索范围内找到十字解法。`;
      } catch (error) {
        console.error("[cross-solver] 求解失败:", error);
        els.crossSolution.textContent = "十字求解失败，请重新生成打乱。";
      } finally {
        els.btnSolveCross.disabled = false;
      }
    }, 0);
  }

  function handleSolveXCross(): void {
    if (!deps.getCurrentScramble()) {
      els.xcrossSolution.hidden = false;
      els.xcrossSolution.textContent = "请先生成打乱。";
      return;
    }
    const targetFace = "U";
    els.btnSolveXCross.disabled = true;
    els.xcrossSolution.hidden = false;
    els.xcrossSolution.innerHTML = "正在比较四个 X-Cross 槽位…";
    window.setTimeout(() => {
      try {
        const candidates = FRONT_ORDER.map((frontFace) => ({
          frontFace,
          solution: solveXCross(deps.getCurrentScramble(), targetFace, frontFace),
        }));
        const best = [...candidates].filter((item) => item.solution.length > 0)
          .sort((a, b) => a.solution.length - b.solution.length)[0];
        const bestPair = best
          ? (SLOT_NAMES[targetFace]?.[best.frontFace] ?? `${COLOR_NAMES[targetFace]}-${COLOR_NAMES[best.frontFace]}`)
          : "未找到";
        const heading = best
          ? `<div class="xcross-recommendation"><strong>推荐：${bestPair} X-Cross</strong><span>${best.solution.length} 步，优先做${bestPair}槽</span></div>`
          : `<div class="xcross-recommendation"><strong>暂未找到 X-Cross</strong><span>可尝试更短的打乱或普通 Cross</span></div>`;
        const candidateSummary = candidates.map(({ frontFace, solution }) => {
          const slotName = SLOT_NAMES[targetFace]?.[frontFace] ?? `${COLOR_NAMES[targetFace]}-${COLOR_NAMES[frontFace]}`;
          return `${slotName}${solution.length > 0 ? ` ${solution.length}步` : " 未找到"}`;
        }).join(" · ");
        const rows = best
          ? HOLD_ORDER.map((holdFace) => {
            const formula = convertSolutionForWhiteDown(best.solution, holdFace).join(" ");
            return `<div class="xcross-row"><strong>${HOLD_NAMES[holdFace]}</strong><code>${formula}</code><span>${best.solution.length} 步</span></div>`;
          })
          : [];
        els.xcrossSolution.innerHTML = heading
          + (rows.length > 0 ? `<div class="xcross-directions">${rows.join("")}</div>` : "")
          + `<div class="xcross-meta">后台比较：${candidateSummary}</div>`;
      } catch (error) {
        console.error("[cross-solver] X-Cross 求解失败:", error);
        els.xcrossSolution.textContent = "X-Cross 求解失败，请重新生成打乱。";
      } finally {
        els.btnSolveXCross.disabled = false;
      }
    }, 0);
  }

  function init(): void {
    els.btnSolveCross.onclick = handleSolveCross;
    els.btnSolveXCross.onclick = handleSolveXCross;
  }

  return { init };
}
