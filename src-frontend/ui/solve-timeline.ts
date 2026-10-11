/** 解法时间轴：按 CFOP 阶段和 F2L 槽位展示，停顿仅作为覆盖标记。 */

import type { AnalysisInput } from "../agent/types.ts";
import { resolvePersistedSolveTrust } from "../core/solve-validation.ts";
import { buildReplayTimestamps } from "../core/solve-replay-timing.ts";

export interface TimelineSegment {
  label: string;
  duration: number;
  color: string;
  detail: string;
  startMoveIndex?: number;
}

export type FormulaPracticeCategory = "F2L" | "OLL" | "PLL";

export interface TimelineRenderOptions {
  focusStage?: FormulaPracticeCategory;
  onSeek?: (moveIndex: number) => void;
}

export type PauseMarkerLevel = "brief" | "noticeable" | "long";

/**
 * 300ms 已足够计入节奏统计，但不应和 1 秒以上的识别停顿争夺视觉注意力。
 */
export function getPauseMarkerLevel(gap: number): PauseMarkerLevel {
  if (gap >= 1000) return "long";
  if (gap >= 600) return "noticeable";
  return "brief";
}

const STAGE_COLORS = {
  cross: "#637f9e",
  f2l: ["#a99bc5", "#9181b5", "#7864a3", "#5f498d"],
  oll: "#c59b51",
  pll: "#579483",
  incomplete: "#94a3b8",
} as const;

/** 将结果压缩成用户可读的阶段块，F2L 优先按真实槽位完成顺序拆为 1–4 对。 */
export function buildTimelineSegments(solve: AnalysisInput): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  addSegment(segments, "Cross", solve.crossDuration, STAGE_COLORS.cross, `${solve.crossMoves} 步`, 0);

  const slots = (solve.f2lSlots ?? [])
    .filter((slot) => !slot.completedWithCross && slot.completionOrder !== undefined && (slot.duration ?? 0) > 0)
    .sort((left, right) => (left.completionOrder ?? 0) - (right.completionOrder ?? 0));
  const slotDuration = slots.reduce((sum, slot) => sum + (slot.duration ?? 0), 0);
  let slotStart = solve.crossMoves;
  for (const slot of slots) {
    const order = slot.completionOrder ?? 0;
    addSegment(
      segments,
      `F2L-${order}`,
      slot.duration ?? 0,
      STAGE_COLORS.f2l[Math.min(Math.max(order - 1, 0), STAGE_COLORS.f2l.length - 1)],
      `${slot.slot} 槽 · ${slot.moves ?? 0} 步`,
      slot.completedAtMove === undefined ? undefined : slotStart,
    );
    slotStart = slot.completedAtMove ?? NaN;
  }
  // 槽位追踪不可用时仍保留 CFOP 总阶段，不能伪造四对的边界。
  if (slots.length === 0) {
    addSegment(segments, "F2L", solve.f2lDuration, STAGE_COLORS.f2l[0], `${solve.f2lMoves} 步`, solve.crossMoves);
  } else if (solve.f2lDuration > slotDuration) {
    addSegment(segments, "F2L-未识别", solve.f2lDuration - slotDuration, STAGE_COLORS.f2l[3], "未能归属到槽位的动作");
  }

  addSegment(segments, "OLL", solve.ollDuration, STAGE_COLORS.oll, `${solve.ollMoves} 步`, solve.crossMoves + solve.f2lMoves);
  addSegment(segments, "PLL", solve.pllDuration, STAGE_COLORS.pll, `${solve.pllMoves} 步`, solve.crossMoves + solve.f2lMoves + solve.ollMoves);

  const accounted = segments.reduce((sum, segment) => sum + segment.duration, 0);
  if (solve.totalDuration > accounted) {
    addSegment(segments, "未识别", solve.totalDuration - accounted, STAGE_COLORS.incomplete, "未完成或未能识别的尾段");
  }
  return segments;
}

function addSegment(segments: TimelineSegment[], label: string, duration: number, color: string, detail: string, startMoveIndex?: number): void {
  if (!Number.isFinite(duration) || duration <= 0) return;
  segments.push({ label, duration, color, detail, startMoveIndex: Number.isInteger(startMoveIndex) && (startMoveIndex ?? -1) >= 0 ? startMoveIndex : undefined });
}

/** 渲染阶段级时间轴；动作只用于定位停顿，不再挤占主图。 */
export function renderSolveTimeline(container: HTMLElement, solve: AnalysisInput, options: TimelineRenderOptions = {}): void {
  if (!resolvePersistedSolveTrust(solve).analysisEligible) {
    container.innerHTML = '<p class="placeholder">实体复原状态已保留；动作流不完整，无法可靠生成 CFOP 阶段时间轴。</p>';
    return;
  }
  if (!solve.moves || solve.moves.length === 0) {
    container.innerHTML = '<p class="placeholder">暂无动作数据</p>';
    return;
  }
  const totalDuration = Math.max(1, solve.totalDuration);
  const allSegments = buildTimelineSegments(solve);
  const segments = options.focusStage ? filterSegmentsForStage(allSegments, options.focusStage) : allSegments;
  const focusedDuration = segments.reduce((sum, segment) => sum + segment.duration, 0);
  const timelineDuration = options.focusStage && focusedDuration > 0 ? focusedDuration : totalDuration;
  const bars = buildBars(segments, timelineDuration);
  const pauses = getTimelinePauseMarkers(solve, options.focusStage);
  const cards = buildStageCards(segments, solve.moves.length, Boolean(options.onSeek));

  container.innerHTML = `
    <div class="solve-timeline">
      <div class="timeline-header"><div><span class="timeline-title">${options.focusStage ?? "阶段"}时间轴</span><p>${options.onSeek ? "点击阶段，回看起始局面" : "按实际完成顺序拆分用时"}</p></div><strong class="timeline-total">${(timelineDuration / 1000).toFixed(2)}<small>s</small></strong></div>
      <div class="timeline-overview">
        <div class="timeline-track" role="img" aria-label="各阶段用时占比">${bars}${options.onSeek && solve.moveGaps && !options.focusStage ? `<span class="timeline-cursor" data-timeline-cursor data-duration="${totalDuration}" aria-hidden="true"></span>` : ""}</div>
        <div class="timeline-pause-track" aria-hidden="true">${buildPauseMarkers(pauses)}</div>
        <div class="timeline-axis"><span>0s</span><span>${(timelineDuration / 1000).toFixed(2)}s</span></div>
      </div>
      <div class="timeline-stages" aria-label="阶段用时与回放入口">${cards}</div>
      ${buildStats(solve, pauses)}
      ${options.onSeek && pauses.length ? `<div class="timeline-pauses"><div class="timeline-pauses-heading"><strong>重点停顿</strong><span>点击回到停顿前</span></div><div class="timeline-pause-links" aria-label="跳到停顿前的局面">${pauses.map((pause) => `<button type="button" class="ghost" data-seek-index="${pause.index}"><span>${escapeHtml(pause.stage)} · 第 ${pause.index + 1} 步前</span><strong>${(pause.gap / 1000).toFixed(2)}<small>s</small></strong></button>`).join("")}</div></div>` : ""}
    </div>
  `;
  if (options.onSeek) container.querySelectorAll<HTMLElement>("[data-seek-index]").forEach((item) => {
    item.addEventListener("click", () => options.onSeek?.(Number(item.dataset.seekIndex)));
  });
}

function filterSegmentsForStage(segments: TimelineSegment[], stage: FormulaPracticeCategory): TimelineSegment[] {
  if (stage === "F2L") return segments.filter((segment) => /^F2L(?:-|$)/.test(segment.label));
  return segments.filter((segment) => segment.label === stage);
}

function isSeekableIndex(index: number | undefined, moveCount: number): index is number {
  return index !== undefined && Number.isInteger(index) && index >= 0 && index < moveCount;
}

function buildBars(segments: TimelineSegment[], totalDuration: number): string {
  let elapsed = 0;
  return segments.map((segment) => {
    const left = elapsed / totalDuration * 100;
    const width = segment.duration / totalDuration * 100;
    elapsed += segment.duration;
    return `<span class="timeline-stage-bar" style="left:${left}%;width:${width}%;background:${segment.color}" aria-hidden="true"></span>`;
  }).join("");
}

function buildStageCards(segments: TimelineSegment[], moveCount: number, interactive: boolean): string {
  return segments.map((segment) => {
    const index = segment.startMoveIndex;
    const seekable = interactive && isSeekableIndex(index, moveCount);
    const tag = seekable ? "button" : "div";
    return `<${tag} ${seekable ? `type="button" data-seek-index="${index}" aria-label="跳到 ${escapeHtml(segment.label)} 起点"` : ""} class="timeline-stage" style="--stage-color:${segment.color}"><span class="timeline-stage-name">${escapeHtml(segment.label)}</span><strong>${(segment.duration / 1000).toFixed(2)}<small>s</small></strong><span class="timeline-stage-detail">${escapeHtml(segment.detail)}</span></${tag}>`;
  }).join("");
}

interface TimelinePauseMarker {
  index: number;
  left: number;
  gap: number;
  stage: string;
  move: string;
}

/** 专项时间轴只显示本阶段停顿，并以本阶段起点重新计时；缺少间隔时不猜位置。 */
export function getTimelinePauseMarkers(solve: AnalysisInput, focusStage?: FormulaPracticeCategory): TimelinePauseMarker[] {
  const timestamps = buildReplayTimestamps(solve.moves?.length ?? 0, solve.moveGaps);
  if (!timestamps) return [];
  const allSegments = buildTimelineSegments(solve);
  const focused = focusStage ? filterSegmentsForStage(allSegments, focusStage) : allSegments;
  const firstIndex = allSegments.indexOf(focused[0]);
  const offset = focusStage ? allSegments.slice(0, Math.max(0, firstIndex)).reduce((sum, segment) => sum + segment.duration, 0) : 0;
  const duration = focusStage ? focused.reduce((sum, segment) => sum + segment.duration, 0) : solve.totalDuration;
  if (duration <= 0) return [];
  return (solve.stepReview?.pauses ?? []).filter((pause) => Number.isInteger(pause.index) && pause.index >= 0
    && pause.index < timestamps.length - 1 && Number.isFinite(pause.gap) && pause.gap > 0 && typeof pause.stage === "string"
    && (!focusStage || pause.stage.toLowerCase() === focusStage.toLowerCase()))
    .map((pause) => ({ ...pause, stage: pause.stage.toLowerCase() === "cross" ? "Cross" : pause.stage.toUpperCase(), left: (timestamps[pause.index + 1] - offset) / duration * 100 }))
    .filter((pause) => pause.left >= 0 && pause.left <= 100);
}

function buildPauseMarkers(pauses: TimelinePauseMarker[]): string {
  return pauses.map((pause) => {
    const level = getPauseMarkerLevel(pause.gap);
    const duration = (pause.gap / 1000).toFixed(2);
    return `<span class="timeline-pause-marker timeline-pause-marker--${level}" style="left:${Math.min(99.5, pause.left)}%" title="${escapeHtml(pause.stage)} 停顿 ${duration}s"></span>`;
  }).join("");
}

function buildStats(solve: AnalysisInput, pauses: TimelinePauseMarker[]): string {
  return `<div class="timeline-stats"><span>全程 ${solve.moves?.length ?? 0} 步</span><span>${pauses.length} 处重点停顿</span>${pauses.length ? `<span>最长 ${(Math.max(...pauses.map((pause) => pause.gap)) / 1000).toFixed(2)}s</span>` : ""}</div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
