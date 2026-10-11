import type { AnalysisInput, AnalysisResult } from "../../src-shared/analysis-types.ts";
import { getAnalysisSolves, getStageMetrics, resolveCoachingReplay } from "../../src-shared/analysis-coaching.ts";
import { formatCaseTransferFeedback } from "./case-transfer-feedback.ts";

type EscapeHtml = (text: string) => string;

function renderInsight(input: AnalysisInput): string {
  const solves = getAnalysisSolves(input);
  const stages = getStageMetrics(input);
  const duration = solves.reduce((sum, solve) => sum + solve.totalDuration, 0) / solves.length;
  const max = Math.max(...stages.map((stage) => stage.duration), 1);
  const stageHtml = stages.map((stage) => `<div class="ai-stage-insight">
    <div class="ai-stage-insight-head"><span>${stage.name}</span><strong>${(stage.duration / 1000).toFixed(2)}s</strong></div>
    <div class="ai-stage-bar"><i style="width:${Math.max(4, Math.round(stage.duration / max * 100))}%"></i></div>
    <small>平均 ${stage.moves.toFixed(1)} 步</small></div>`).join("");
  const slots = (input.f2lSlots ?? []).map((slot) => `<div class="ai-slot-insight"><strong>${slot.slot}</strong>
    <span>${slot.duration === undefined ? "—" : `${(slot.duration / 1000).toFixed(2)}s`} · ${slot.moves ?? 0} 步</span>
    <small>${slot.pauseCount > 0 ? `停顿 ${slot.pauseCount} 次` : "无长停顿"}${slot.repairCount > 0 ? ` · 修复 ${slot.repairCount}` : ""}</small></div>`).join("");
  return `<section class="ai-insight-panel" aria-label="分析样本与阶段均值">
    <div class="ai-insight-heading"><div><span>最近 ${solves.length} 把可信常规复原</span><strong>阶段均值 · 平均 ${(duration / 1000).toFixed(2)}s</strong></div></div>
    <div class="ai-stage-insight-grid">${stageHtml}</div>
    <p class="coaching-sample-note">时间占比用于查看分布；${input.baseline ? `个人基准取此前 ${input.baseline.sampleCount} 把` : "此前可信成绩不足，暂不判断阶段变化"}。</p>
    ${slots ? `<div class="ai-slot-insights"><div class="ai-insight-label">最近一把 · F2L 四槽位</div><div class="ai-slot-grid">${slots}</div></div>` : ""}
  </section>`;
}

function renderIssues(result: AnalysisResult, input: AnalysisInput, escapeHtml: EscapeHtml): string {
  const labels = { high: "优先复盘", medium: "值得关注", low: "统计参考" };
  return (result.issues ?? []).map((issue, index) => {
    const replay = issue.evidenceId ? resolveCoachingReplay(input, issue.evidenceId) : null;
    return `<li class="coaching-issue">
      <span class="severity-badge severity-${issue.severity}">${labels[issue.severity]}</span>
      <span class="issue-stage">${escapeHtml(issue.stage)}</span><strong class="issue-desc">${escapeHtml(issue.description)}</strong>
      <small class="issue-evidence">${escapeHtml(issue.evidence)}</small>
      ${replay ? `<button type="button" class="ghost issue-replay-btn" data-issue-replay-index="${index}">查看第 ${replay.solveIndex + 1} 把 · ${replay.startMoveIndex + 1}–${replay.endMoveIndex} 步</button>`
        : '<small class="issue-replay-note">统计证据或缺少准确动作位置，暂无片段回放</small>'}
    </li>`;
  }).join("");
}

function renderDrills(result: AnalysisResult, escapeHtml: EscapeHtml): string {
  return (result.drills ?? []).map((drill) => `<li class="coaching-drill"><strong>${escapeHtml(drill.title)}</strong>
    <span>${escapeHtml(drill.detail)}</span>${drill.reps ? `<em class="drill-reps">${escapeHtml(drill.reps)}</em>` : ""}</li>`).join("");
}

function renderFormulas(result: AnalysisResult, escapeHtml: EscapeHtml): string {
  return (result.focusFormulas ?? []).map((entry, index) => {
    const progress = entry.lastAssignedAt !== undefined ? `<small class="issue-evidence">上次指派 ${Math.max(0, Math.floor((Date.now() - entry.lastAssignedAt) / 86400000))} 天前${entry.practiceSuccessRate !== undefined
      ? ` · 期间成功率 ${(entry.practiceSuccessRate * 100).toFixed(0)}%` : " · 期间暂无练习"}</small>` : "";
    return `<li class="coaching-focus-formula"><span class="issue-stage">${escapeHtml(entry.stage)}</span>
      ${entry.formulaId ? `<strong>${escapeHtml(entry.formulaId)}</strong>` : ""}<span class="issue-desc">${escapeHtml(entry.reason)}</span>${progress}
      <button class="practice-btn focus-btn" type="button" data-focus-formula-index="${index}">加入训练</button></li>`;
  }).join("");
}

function renderFullReplay(input: AnalysisInput, escapeHtml: EscapeHtml): string {
  if (!input.moves?.length || typeof input.scramble !== "string") return '<p class="coaching-sample-note">最近一把缺少完整动作，暂无整把回放。</p>';
  return `<details class="analysis-full-replay"><summary>查看最近一把的完整解法</summary>
    <section class="analysis-replay" aria-label="最近一把完整解法">
      <p class="coaching-sample-note">可减速观察、点击阶段或停顿定位，也可拖拽调整视角。完整时间记录支持实速回放。</p>
      <article class="analysis-replay-card"><div class="analysis-replay-label"><span>打乱与实录解法</span><small>从原始打乱局面还原</small></div>
        <code>打乱：${escapeHtml(input.scramble)}</code><code>解法：${escapeHtml(input.moves.join(" "))}</code>
        <div data-analysis-solution-preview></div></article></section></details>`;
}

/** 分析文案与布局集中渲染，播放器与交互由控制器装配。 */
export function renderAnalysisCard(result: AnalysisResult, input: AnalysisInput, escapeHtml: EscapeHtml): string {
  const issues = renderIssues(result, input, escapeHtml);
  const drills = renderDrills(result, escapeHtml);
  const formulas = renderFormulas(result, escapeHtml);
  const transfer = (input.caseTransfer ?? []).map((entry) => `<p>${escapeHtml(formatCaseTransferFeedback(entry))}</p>`).join("");
  return `<div class="analysis-card coaching-card">
    <div class="coaching-source"><span class="source-tag">${result.source === "ai" ? "DeepSeek 分析" : "本地规则分析"}</span><span>结论引用本次实录证据</span></div>
    ${renderInsight(input)}
    ${result.nextFocus ? `<div class="coaching-focus"><span class="focus-label">下一把聚焦</span>${escapeHtml(result.nextFocus)}</div>` : ""}
    ${result.trend ? `<div class="coaching-trend"><span class="trend-label">趋势</span>${escapeHtml(result.trend)}</div>` : ""}
    ${issues ? `<div class="analysis-item"><div class="label">问题与证据</div><ul class="coaching-issues">${issues}</ul></div>`
      : '<p class="coaching-sample-note">本次没有足够证据认定具体异常。继续保留完整成绩，积累个人基准。</p>'}
    <section class="coaching-replay-focus analysis-replay-card" data-issue-replay-panel hidden tabindex="-1" aria-label="问题对应的原始动作片段">
      <div class="analysis-replay-label"><strong data-issue-replay-title></strong><small>原始动作片段</small></div>
      <p class="coaching-sample-note" data-issue-replay-description aria-live="polite"></p><div data-issue-replay-player></div>
    </section>
    ${drills ? `<div class="analysis-item"><div class="label">下一组训练</div><ul class="coaching-drills">${drills}</ul></div>` : ""}
    ${formulas ? `<div class="analysis-item focus-assign"><div class="label">专项指派</div><ul class="coaching-focus-formulas">${formulas}</ul></div>` : ""}
    ${transfer ? `<div class="analysis-item case-transfer"><div class="label">专项后的实战观察</div>${transfer}</div>` : ""}
    <div class="analysis-item bottleneck"><div class="label">诊断结论</div><div class="value">${escapeHtml(result.bottleneck)}</div></div>
    <div class="analysis-item advice"><div class="label">训练建议</div><div class="value">${escapeHtml(result.trainingAdvice)}</div></div>
    <div class="analysis-item encourage"><div class="value">${escapeHtml(result.encouragement)}</div></div>
    <div class="analysis-item practice-link"><button id="btn-practice" type="button" class="practice-btn">打开公式库练习</button></div>
    ${renderFullReplay(input, escapeHtml)}
  </div>`;
}
