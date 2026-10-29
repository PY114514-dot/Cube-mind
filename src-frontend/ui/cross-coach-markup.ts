import { CORNER_POSITIONS, EDGE_POSITIONS, PAIR_COLORS, type CrossLesson, type XCrossLesson } from "../core/cross-coach.ts";
import { formatMovesForWhiteBottom } from "../core/solve-notation.ts";

type EscapeHtml = (value: string) => string;
const FACE_NAMES: Record<string, string> = { U: "上", D: "下", F: "前", B: "后", R: "右", L: "左" };

export function positionName(position: string): string {
  return `${position}（${[...position].map((face) => FACE_NAMES[face]).join("")}）`;
}

export function crossMoveText(moves: string[]): string {
  return formatMovesForWhiteBottom(moves, "U").join(" ") || "已完成，无需转动";
}

function answerSelect(id: string, label: string, positions: readonly string[]): string {
  return `<label>${label}<select id="${id}" required><option value="">请选择位置</option>${positions.map((p) => `<option value="${p}">${positionName(p)}</option>`).join("")}</select></label>`;
}

export function renderCrossQuestion(lesson: CrossLesson, escape: EscapeHtml): string {
  return `<div class="cross-coach-layout">
    <div><div class="cross-coach-cube" data-coach-cube></div><p class="coach-caption">可以拖动观察；位置名称始终以白底蓝前为准。</p></div>
    <div class="coach-task">
      <span class="coach-eyebrow">01 规划十字 · 02 追踪第一对</span>
      <h3>转完十字，这两块会在哪？</h3>
      <p>目标第一对 <strong>${PAIR_COLORS[lesson.slot]}</strong> · ${lesson.slot} 槽</p>
      <div class="coach-algorithm"><span>本题十字方案 · ${lesson.crossMoves.length} 步</span><code>${escape(crossMoveText(lesson.crossMoves))}</code></div>
      <details class="coach-custom"><summary>使用自己的十字方案</summary>
        <form data-coach-plan><label>按白底蓝前输入外层动作<input name="plan" aria-label="我的十字方案" placeholder="例如 R U F2" autocomplete="off" maxlength="200"></label><button class="ghost" type="submit">校验并采用</button></form>
      </details>
      <p>先在脑中执行上面的十字方案，再判断目标角块和棱块的位置。</p>
      <form data-coach-answer>
        <div class="coach-answer-fields">${answerSelect("coach-corner", "三色角块的位置", CORNER_POSITIONS)}${answerSelect("coach-edge", "双色棱块的位置", EDGE_POSITIONS)}</div>
        <div class="coach-actions"><button type="submit">提交预判</button><button type="button" class="ghost" data-coach-reveal>直接看答案</button></div>
      </form>
      <p data-coach-feedback role="status"></p>
    </div>
  </div>`;
}

export function renderCrossAnswer(lesson: CrossLesson, feedback: string, escape: EscapeHtml): string {
  const note = lesson.pairAlreadySolved ? "这对随十字一起归位，这个方案已经完成 XC。"
    : lesson.pairMoves ? "先追踪角块和棱块，再衔接第一对。下面的参考解已验证保留十字；它是当前公式库候选，并非全局最短解。"
      : "当前公式库未找到可验证的第一对参考解。先逐步回放十字，检查两块的落点。";
  return `<div class="coach-answer-summary" role="status"><strong>${escape(feedback)}</strong><span>角块 ${positionName(lesson.corner)} · 棱块 ${positionName(lesson.edge)}</span></div>
    <div class="cross-coach-layout"><div data-coach-replay></div><div class="coach-task">
      <h3>${PAIR_COLORS[lesson.slot]} · ${lesson.slot} 槽</h3><p>${note}</p>
      <div class="coach-algorithm"><span>十字 · ${lesson.crossMoves.length} 步</span><code>${escape(crossMoveText(lesson.crossMoves))}</code></div>
      ${lesson.pairMoves ? `<div class="coach-algorithm"><span>第一对参考 · ${lesson.pairMoves.length} 步</span><code>${escape(crossMoveText(lesson.pairMoves))}</code></div><div class="coach-actions"><button class="ghost" data-coach-segment="cross">看十字落点</button><button class="ghost" data-coach-segment="pair">看第一对衔接</button></div>` : ""}
      <p>用单步按钮跟踪目标块；也可调至 0.5× 或 0.25× 慢放。</p>
    </div></div>`;
}

export function renderXCrossLesson(lesson: XCrossLesson): string {
  return `<div class="cross-coach-layout"><div data-coach-replay></div><div class="coach-task">
    <span class="coach-eyebrow">观察 · 组合 · 一次完成</span><h3>让十字带上第一对</h3>
    <p>比较四个槽位，选择更容易一起追踪的角棱对。完成时同时保留白色十字和至少一对 F2L。</p>
    <div class="coach-candidates">${lesson.candidates.map((candidate, i) => `<button type="button" class="ghost" data-coach-candidate="${i}" aria-pressed="${i === 0}"><span>${PAIR_COLORS[candidate.slot]} · ${candidate.slot}</span><strong>${candidate.moves.length} 步</strong></button>`).join("")}</div>
    <div class="coach-algorithm"><span data-coach-xc-label></span><code data-coach-xc-moves></code></div>
    <p>${lesson.candidates.length ? "已校验终态。只比较 8 步内的外层转动解；半转算 1 步。" : "8 步内未找到 XC 解，不代表无解。可继续练习十字与第一对的衔接。"}</p>
    <button type="button" data-coach-train ${lesson.candidates[0]?.moves.length === 0 ? "disabled" : ""}>用这题练 XC</button>
    <p class="coach-caption">连接智能魔方后按提示打乱，完成目标自动停表；支持模拟魔方。成绩保存在 XC 专项。</p>
    <p data-coach-feedback role="status"></p>
  </div></div>`;
}
