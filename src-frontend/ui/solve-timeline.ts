/** 解法时间轴：按 CFOP 阶段和 F2L 槽位展示，停顿仅作为覆盖标记。 */

import type { AnalysisInput } from "../agent/types.ts";
import { isAnalysisEligible } from "../core/solve-validation.ts";

export interface TimelineSegment {
  label: string;
  duration: number;
  color: string;
  detail: string;
}

const STAGE_COLORS = {
  cross: "#3b82f6",
  f2l: ["#8b5cf6", "#a855f7", "#c084fc", "#7c3aed"],
  oll: "#f59e0b",
  pll: "#10b981",
  incomplete: "#94a3b8",
} as const;

/** 将结果压缩成用户可读的阶段块，F2L 优先按真实槽位完成顺序拆为 1–4 对。 */
export function buildTimelineSegments(solve: AnalysisInput): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  addSegment(segments, "Cross", solve.crossDuration, STAGE_COLORS.cross, `${solve.crossMoves} 步`);

  const slots = (solve.f2lSlots ?? [])
    .filter((slot) => !slot.completedWithCross && slot.completionOrder !== undefined && (slot.duration ?? 0) > 0)
    .sort((left, right) => (left.completionOrder ?? 0) - (right.completionOrder ?? 0));
  const slotDuration = slots.reduce((sum, slot) => sum + (slot.duration ?? 0), 0);
  for (const slot of slots) {
    const order = slot.completionOrder ?? 0;
    addSegment(
      segments,
      `F2L-${order}`,
      slot.duration ?? 0,
      STAGE_COLORS.f2l[Math.min(Math.max(order - 1, 0), STAGE_COLORS.f2l.length - 1)],
      `${slot.slot} 槽 · ${slot.moves ?? 0} 步`,
    );
  }
  // 槽位追踪不可用时仍保留 CFOP 总阶段，不能伪造四对的边界。
  if (slots.length === 0) {
    addSegment(segments, "F2L", solve.f2lDuration, STAGE_COLORS.f2l[0], `${solve.f2lMoves} 步`);
  } else if (solve.f2lDuration > slotDuration) {
    addSegment(segments, "F2L-未识别", solve.f2lDuration - slotDuration, STAGE_COLORS.f2l[3], "未能归属到槽位的动作");
  }

  addSegment(segments, "OLL", solve.ollDuration, STAGE_COLORS.oll, `${solve.ollMoves} 步`);
  addSegment(segments, "PLL", solve.pllDuration, STAGE_COLORS.pll, `${solve.pllMoves} 步`);

  const accounted = segments.reduce((sum, segment) => sum + segment.duration, 0);
  if (solve.totalDuration > accounted) {
    addSegment(segments, "未识别", solve.totalDuration - accounted, STAGE_COLORS.incomplete, "未完成或未能识别的尾段");
  }
  return segments;
}

function addSegment(segments: TimelineSegment[], label: string, duration: number, color: string, detail: string): void {
  if (!Number.isFinite(duration) || duration <= 0) return;
  segments.push({ label, duration, color, detail });
}

/** 渲染阶段级时间轴；动作只用于定位停顿，不再挤占主图。 */
export function renderSolveTimeline(container: HTMLElement, solve: AnalysisInput): void {
  if (!isAnalysisEligible(solve.analysisEligible, solve.qualityStatus)) {
    container.innerHTML = '<p class="placeholder">实体复原状态已保留；动作流不完整，无法可靠生成 CFOP 阶段时间轴。</p>';
    return;
  }
  if (!solve.moves || solve.moves.length === 0) {
    container.innerHTML = '<p class="placeholder">暂无动作数据</p>';
    return;
  }
  const totalDuration = Math.max(1, solve.totalDuration);
  const segments = buildTimelineSegments(solve);
  const bars = buildBars(segments, totalDuration);
  const pauseMarkers = buildPauseMarkers(solve, totalDuration);
  const stats = buildStats(solve);

  container.innerHTML = `
    <div class="solve-timeline">
      <div class="timeline-header"><span class="timeline-title">阶段时间轴</span>${stats}</div>
      <div class="timeline-track">${bars}${pauseMarkers}</div>
      <div class="timeline-legend">
        <span class="legend-item"><span class="legend-dot" style="background:${STAGE_COLORS.cross}"></span>Cross</span>
        <span class="legend-item"><span class="legend-dot" style="background:${STAGE_COLORS.f2l[0]}"></span>F2L-1 ~ F2L-4</span>
        <span class="legend-item"><span class="legend-dot" style="background:${STAGE_COLORS.oll}"></span>OLL</span>
        <span class="legend-item"><span class="legend-dot" style="background:${STAGE_COLORS.pll}"></span>PLL</span>
        <span class="legend-item"><span class="legend-dot" style="background:#ef4444"></span>停顿</span>
      </div>
      <div class="timeline-tooltip" id="timeline-tooltip"></div>
    </div>
  `;
  bindTooltips(container);
}

function buildBars(segments: TimelineSegment[], totalDuration: number): string {
  let elapsed = 0;
  return segments.map((segment) => {
    const left = elapsed / totalDuration * 100;
    const width = Math.max(0.5, segment.duration / totalDuration * 100);
    elapsed += segment.duration;
    return `<div class="timeline-bar timeline-stage-bar" style="left:${left}%;width:${width}%;background:${segment.color}" data-label="${segment.label}" data-detail="${segment.detail}" data-duration="${segment.duration}"><span class="timeline-stage-label">${segment.label}</span></div>`;
  }).join("");
}

function buildPauseMarkers(solve: AnalysisInput, totalDuration: number): string {
  const pauses = solve.stepReview?.pauses ?? [];
  const gaps = solve.moveGaps ?? [];
  return pauses.map((pause) => {
    const before = gaps.slice(0, pause.index + 1).reduce((sum, gap) => sum + Math.max(0, gap), 0);
    const left = Math.min(99.5, before / totalDuration * 100);
    return `<span class="timeline-pause-marker" style="left:${left}%" data-label="停顿" data-detail="${escapeHtml(pause.stage)} · ${escapeHtml(pause.move)}" data-duration="${pause.gap}"></span>`;
  }).join("");
}

function buildStats(solve: AnalysisInput): string {
  const review = solve.stepReview;
  return `<div class="timeline-stats"><span>${solve.moves?.length ?? 0} 步</span><span>${review?.pauses.length ?? 0} 次停顿</span><span>最长 ${((review?.maxGap ?? 0) / 1000).toFixed(2)}s</span><span>平均 ${((review?.averageGap ?? 0) / 1000).toFixed(2)}s</span></div>`;
}

function bindTooltips(container: HTMLElement): void {
  const tooltip = container.querySelector<HTMLElement>("#timeline-tooltip");
  if (!tooltip) return;
  container.querySelectorAll<HTMLElement>(".timeline-stage-bar, .timeline-pause-marker").forEach((item) => {
    item.addEventListener("mouseenter", (event) => {
      const target = event.currentTarget as HTMLElement;
      tooltip.innerHTML = `<strong>${escapeHtml(target.dataset.label ?? "")}</strong><span>${escapeHtml(target.dataset.detail ?? "")}</span><span>${(Number(target.dataset.duration) / 1000).toFixed(2)}s</span>`;
      tooltip.style.display = "block";
      const rect = target.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      tooltip.style.left = `${rect.left - containerRect.left + 8}px`;
      tooltip.style.top = `${rect.top - containerRect.top - 62}px`;
    });
    item.addEventListener("mouseleave", () => { tooltip.style.display = "none"; });
  });
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}
