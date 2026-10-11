/**
 * src-shared/analysis-evidence.ts
 * 证据编译层：把原始训练数据提炼成结构化证据与提示词文本。
 *
 * 前后端共享：本地规则 fallback 与 AGENT 提示词使用同一套严重度阈值与
 * case 过滤规则，保证两条路径的判定口径一致（模型不再自行猜测阈值）。
 */

import type { AnalysisInput } from "./analysis-types.ts";
import type { TrainingProfileEntry } from "./training-plan-types.ts";
import { buildCoachingEvidence, getAnalysisSolves, getStageMetrics, slotSeverity } from "./analysis-coaching.ts";
import type { CoachingEvidence } from "./analysis-coaching.ts";

// ====== 阈值与上限 ======
/** 实录解法最多送入提示词的步数，超出部分截断并追加省略说明 */
export const MAX_REPLAY_MOVES = 160;
export const MAX_PRACTICE_ENTRIES = 30;
export const MAX_ASSIGNMENT_ENTRIES = 10;
/** 训练档案段最多列出的公式数，按最近练习时间取前 N 个 */
export const MAX_PROFILE_FORMULAS = 6;
/** 训练档案段每个公式最多列出的天数 */
export const MAX_PROFILE_DAYS = 7;
/** 趋势对比的窗口天数：近窗与再往前至多同等天数的前窗 */
export const PROFILE_TREND_WINDOW_DAYS = 3;
/** 近窗 vs 前窗成功率差距阈值（10 个百分点），不足视为持平 */
export const PROFILE_TREND_MIN_DELTA = 0.1;

// ====== 训练档案（跨天公式练习时间线） ======

/** 趋势方向：up/down 为超出阈值的变化，flat 为变化不足阈值，new 为无前窗可比。 */
export type ProfileTrend = "up" | "down" | "flat" | "new";

/** 近窗与前窗的聚合成功率（0-1）及由此判定的趋势。 */
export interface ProfileTrendDetail {
  trend: ProfileTrend;
  recentRate: number;
  previousRate: number;
}

const TREND_ARROWS: Record<Exclude<ProfileTrend, "new">, string> = {
  up: "↑",
  down: "↓",
  flat: "→",
};

/** 同日同公式可能有多条（跨会话重复汇总），先按日期键求和归并，保证窗口按「天」计数。 */
function sumProfileByDay(entries: TrainingProfileEntry[]): TrainingProfileEntry[] {
  const byDate = new Map<string, TrainingProfileEntry>();
  for (const entry of entries) {
    const existing = byDate.get(entry.dateKey);
    if (!existing) {
      byDate.set(entry.dateKey, { ...entry });
      continue;
    }
    existing.attempts += entry.attempts;
    existing.successes += entry.successes;
    existing.lastPracticedAt = Math.max(existing.lastPracticedAt, entry.lastPracticedAt);
  }
  return [...byDate.values()].sort((left, right) => left.dateKey.localeCompare(right.dateKey));
}

/** 一组按天桶的聚合成功率（0-1）。 */
function aggregateProfileRate(days: TrainingProfileEntry[]): number {
  const attempts = days.reduce((sum, entry) => sum + entry.attempts, 0);
  const successes = days.reduce((sum, entry) => sum + entry.successes, 0);
  return attempts > 0 ? successes / attempts : 0;
}

/** 成功率转百分比文案，如 0.789 → "79%"。 */
function formatProfilePercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/**
 * 趋势判定：近窗（最近 3 个练习日）vs 前窗（再往前至多 3 天）的聚合成功率对比。
 * 差距 ≥10 个百分点判 up/down；前窗为空（记录 ≤3 天）判 new，无对比基准。
 */
export function profileTrendDetail(entries: TrainingProfileEntry[]): ProfileTrendDetail {
  const days = sumProfileByDay(entries);
  const recent = days.slice(-PROFILE_TREND_WINDOW_DAYS);
  const previous = days.slice(-PROFILE_TREND_WINDOW_DAYS * 2, -PROFILE_TREND_WINDOW_DAYS);
  if (previous.length === 0) return { trend: "new", recentRate: aggregateProfileRate(recent), previousRate: 0 };
  const recentRate = aggregateProfileRate(recent);
  const previousRate = aggregateProfileRate(previous);
  const delta = recentRate - previousRate;
  const trend = delta >= PROFILE_TREND_MIN_DELTA ? "up" : delta <= -PROFILE_TREND_MIN_DELTA ? "down" : "flat";
  return { trend, recentRate, previousRate };
}

/** 只取趋势方向的便捷入口（渲染与测试共用同一判定口径）。 */
export function profileTrend(entries: TrainingProfileEntry[]): ProfileTrend {
  return profileTrendDetail(entries).trend;
}

/** 一组条目的最近练习时间。 */
function groupLastPracticedAt(group: TrainingProfileEntry[]): number {
  return group.reduce((max, entry) => Math.max(max, entry.lastPracticedAt), 0);
}

/**
 * 渲染【训练档案】段：每行一个公式，列出最近若干天的「成功/尝试（成功率）」
 * 与近窗 vs 前窗趋势。为什么行内直接给聚合好的数字：让模型引用证据即可，
 * 无需自行做日期聚合。无档案时返回 null，调用方整段省略。
 */
export function buildProfileText(entries: TrainingProfileEntry[] | undefined): string | null {
  const list = entries ?? [];
  if (list.length === 0) return null;
  const byFormula = new Map<string, TrainingProfileEntry[]>();
  for (const entry of list) {
    const group = byFormula.get(entry.formulaId) ?? [];
    group.push(entry);
    byFormula.set(entry.formulaId, group);
  }
  // 只列近期活跃公式（按最近练习时间降序截断），避免长档案淹没重点。
  const formulas = [...byFormula.entries()]
    .sort((left, right) => groupLastPracticedAt(right[1]) - groupLastPracticedAt(left[1]))
    .slice(0, MAX_PROFILE_FORMULAS);
  return formulas.map(([formulaId, group]) => {
    const days = sumProfileByDay(group).slice(-MAX_PROFILE_DAYS);
    const stage = days[0]?.stage ?? "F2L";
    const dayText = days.map((day) =>
      `${day.dateKey.slice(5)} ${day.successes}/${day.attempts}（${formatProfilePercent(day.successes / day.attempts)}）`,
    ).join("、");
    const detail = profileTrendDetail(days);
    const trendText = detail.trend === "new"
      ? days.length === 1 ? "仅 1 天记录（无对比基准）" : "记录不足（无对比基准）"
      : `近 3 日成功率 ${formatProfilePercent(detail.previousRate)} → ${formatProfilePercent(detail.recentRate)}（${TREND_ARROWS[detail.trend]}）`;
    return `- ${formulaId}（${stage}）：${dayText}；${trendText}`;
  }).join("\n");
}

/** 从原始输入提炼出的证据（文本段 + 供 fallback/测试复用的结构化数据）。 */
export interface AnalysisEvidence {
  scope: number;
  totalDuration: number;
  moveCount: number | undefined;
  totalTps: string;
  stageText: string;
  scramble: string;
  replayText: string;
  historyText: string;
  reviewText: string;
  slotText: string;
  caseText: string;
  coaching: CoachingEvidence[];
  coachingText: string;
  transferText: string;
  practiceText: string;
  assignmentText: string;
  sessionText: string;
  /** 训练档案段全文；无档案时为 null，渲染时整段省略 */
  profileText: string | null;
}

function buildTransferText(input: AnalysisInput): string {
  return (input.caseTransfer ?? []).slice(0, MAX_ASSIGNMENT_ENTRIES).map((entry) => {
    const sampleText = `${entry.formulaId}：训练前 ${entry.before.caseHits} 次命中，训练后 ${entry.after.caseHits} 次命中（已观察 ${entry.normalSolveCount}/${entry.targetSolveCount} 把常规复原）`;
    if (!entry.readyForComparison) return `${sampleText}；同 CASE 样本不足，暂不判断训练变化`;
    const beforePause = ((entry.before.averageRecognitionPauseMs ?? 0) / 1000).toFixed(2);
    const afterPause = ((entry.after.averageRecognitionPauseMs ?? 0) / 1000).toFixed(2);
    return `${sampleText}；起手前平均停顿 ${beforePause}s → ${afterPause}s；与参照步数的平均差 ${entry.before.averageMoveDelta?.toFixed(1)} → ${entry.after.averageMoveDelta?.toFixed(1)}；只描述观察变化，不证明训练导致变化`;
  }).join("\n") || "暂无专项后的同 CASE 实战观察";
}

export function buildEvidence(input: AnalysisInput): AnalysisEvidence {
  const solves = getAnalysisSolves(input);
  const totalDuration = solves.reduce((sum, solve) => sum + solve.totalDuration, 0) / solves.length;
  const stageText = getStageMetrics(input).map((stage) => {
    const tps = stage.duration > 0 ? (stage.moves / (stage.duration / 1000)).toFixed(1) : "—";
    const ratio = totalDuration > 0 ? (stage.duration / totalDuration) * 100 : 0;
    return `- ${stage.name}: ${(stage.duration / 1000).toFixed(2)}s / ${stage.moves.toFixed(1)} 步 / TPS ${tps}（时间占比 ${ratio.toFixed(0)}%，占比不表示异常）`;
  }).join("\n");
  const historyText = solves.map((solve, index) => `第 ${index + 1} 把：${(solve.totalDuration / 1000).toFixed(2)}s`).join("\n");
  const reviewText = solves.flatMap((solve, index) =>
    (solve.stepReview?.pauses ?? []).map((pause) => ({ pause, index })))
    .sort((a, b) => b.pause.gap - a.pause.gap).slice(0, 12)
    .map(({ pause, index }) => `第 ${index + 1} 把，第 ${pause.index + 1} 步 ${pause.move} 前（${pause.stage}）：${(pause.gap / 1000).toFixed(2)}s`)
    .join("\n") || "未记录明显停顿";
  const scramble = input.scramble?.trim() || "未保存";
  const movesText = input.moves?.slice(0, MAX_REPLAY_MOVES).join(" ") || "未保存";
  const moveSuffix = (input.moves?.length ?? 0) > MAX_REPLAY_MOVES ? " …（后续动作已省略）" : "";
  const slotText = (input.f2lSlots ?? []).map((slot) => {
    if (slot.completedWithCross) return `${slot.slot}：与 Cross 同时完成`;
    if (slot.duration === undefined) return `${slot.slot}：未完成`;
    const sequence = slot.moveSequence?.join(" ") || "未记录";
    const classification = slot.caseFamily && slot.caseFamily !== "unknown"
      ? `，类型 ${slot.caseFamily}（${slot.caseReason ?? "局部状态识别"}）`
      : "，类型未可靠识别";
    const severity = slotSeverity(slot.maxGap);
    return `${slot.slot}：第 ${slot.completionOrder ?? "—"} 对，${(slot.duration / 1000).toFixed(2)}s，${slot.moves ?? 0} 步${classification}，转动 ${sequence}，停顿 ${slot.pauseCount} 次，最长 ${(slot.maxGap / 1000).toFixed(2)}s，修复 ${slot.repairCount} 次，回退 ${slot.breakCount} 次，严重度 ${severity}`;
  }).join("\n") || "本把没有可靠的 F2L 槽位数据";
  const sessionText = (input.sessionContext ?? []).map((entry, index) =>
    `第 ${index + 1} 把：${(entry.totalDuration / 1000).toFixed(2)}s，瓶颈 ${entry.bottleneckStage || "未知"}，${entry.topIssue}`,
  ).join("\n") || "本次会话暂无历史分析记录";
  const practiceText = (input.practiceSummary ?? []).slice(0, MAX_PRACTICE_ENTRIES).map((entry) => {
    const rate = `${(entry.successRate * 100).toFixed(0)}%`;
    const avg = entry.averageDuration !== null ? `${(entry.averageDuration / 1000).toFixed(2)}s` : "—";
    const recognition = entry.averageRecognitionDuration !== null ? `${(entry.averageRecognitionDuration / 1000).toFixed(2)}s` : "—";
    const execution = entry.averageExecutionDuration !== null ? `${(entry.averageExecutionDuration / 1000).toFixed(2)}s` : "—";
    return `${entry.formulaId}（${entry.name}）：练习 ${entry.attempts} 次 · 成功率 ${rate} · 平均 ${avg} · 识别 ${recognition} · 执行 ${execution}`;
  }).join("\n") || "公式库暂无练习记录";
  // 指派效果回流：上次指派的公式练得怎么样，让 AGENT 能评价进展、避免重复指派已提升的公式。
  const assignmentText = (input.assignmentProgress ?? []).slice(0, MAX_ASSIGNMENT_ENTRIES).map((entry) => {
    const days = Math.max(0, Math.floor((Date.now() - entry.lastAssignedAt) / 86_400_000));
    const rate = entry.practiceSuccessRate === null ? "暂无练习" : `${(entry.practiceSuccessRate * 100).toFixed(0)}%`;
    return `- ${entry.formulaId}（${entry.stage}，上次指派 ${days} 天前）：练习 ${entry.practiceAttempts} 次，成功率 ${rate}`;
  }).join("\n") || "暂无历史指派";
  const coaching = buildCoachingEvidence(input);
  const caseText = coaching.filter((entry) => entry.kind === "case").map((entry) => `${entry.description}；${entry.evidence}`).join("\n")
    || "本窗未命中明显偏差的 case 证据，仅做阶段级分析。";
  const moveCount = solves.every((solve) => solve.moveCount !== undefined || solve.moves !== undefined)
    ? solves.reduce((sum, solve) => sum + (solve.moveCount ?? solve.moves?.length ?? 0), 0) / solves.length : undefined;
  const totalTps = totalDuration > 0 && moveCount !== undefined
    ? (moveCount / (totalDuration / 1000)).toFixed(1)
    : "—";
  return {
    scope: solves.length,
    totalDuration,
    moveCount,
    totalTps,
    stageText,
    scramble,
    replayText: `${movesText}${moveSuffix}`,
    historyText,
    reviewText,
    slotText,
    caseText,
    coaching,
    coachingText: coaching.map((entry) => `[${entry.id}] ${entry.stage}，严重度 ${entry.severity}：${entry.description}；${entry.evidence}`).join("\n"),
    transferText: buildTransferText(input),
    practiceText,
    assignmentText,
    sessionText,
    profileText: buildProfileText(input.trainingProfile),
  };
}

/** 把证据渲染成提示词的数据段落（与【复盘规则】分属不同关注点）。 */
export function evidenceToText(evidence: AnalysisEvidence): string {
  // 无档案时整段省略，保持旧版提示词结构不变（旧存档/未同步场景安全降级）
  const profileSection = evidence.profileText
    ? `【训练档案】（跨天累计，仅列近期活跃公式）\n${evidence.profileText}\n\n`
    : "";
  return `【本次数据】（${evidence.scope} 把可信常规复原的均值）
平均总用时：${(evidence.totalDuration / 1000).toFixed(2)}s（${evidence.moveCount?.toFixed(1) ?? "—"} 步，整体 TPS ${evidence.totalTps}）
${evidence.stageText}
最近一把打乱：${evidence.scramble}
最近一把实录解法：${evidence.replayText}

【近期趋势】
${evidence.historyText}

【识别停顿】
${evidence.reviewText}

【最近一把 F2L 逐对数据】
${evidence.slotText}

【逐 case 证据】（仅列出偏差明显的 case）
${evidence.caseText}

【可引用诊断证据】（ID 为本次请求内的稳定引用，回放绑定原始成绩）
${evidence.coachingText}

【公式库练习数据】
${evidence.practiceText}

【指派效果】
${evidence.assignmentText}

【专项后的实战观察】
${evidence.transferText}

${profileSection}【本次会话历史】
${evidence.sessionText}`;
}
