import type { AnalysisInput, CaseEvent, SolveReviewGoal, SolveReviewTarget } from "../../src-shared/analysis-types.ts";
import { CubieCube, parseMove, SOLVED_FACELET } from "../utils/mathlib.ts";
import { isNormalAnalysisEligible, resolvePersistedSolveTrust } from "./solve-validation.ts";
import { isScrambleStateVerified } from "./scramble-verification.ts";
import { hasSameCaseReference } from "../../src-shared/analysis-coaching.ts";
import { compactMoves } from "./practice-transition.ts";

export interface SolveReviewSession {
  queue: SolveReviewTarget[];
  index: number;
  result: AnalysisInput | null;
  attempts: AnalysisInput[];
}

export interface ReviewComparison {
  completed: boolean;
  current: number | null;
  delta: number | null;
  note: string;
}

function validMoves(text: string): string[] | null {
  const moves = text.trim().split(/\s+/).filter(Boolean);
  return moves.length > 0 && moves.every((move) => /^[URFDLB](?:2|')?$/.test(move)) ? moves : null;
}

/** 原题必须有可重建的打乱和完整解法；熟题、DNF 与不可信成绩不入队。 */
export function canReviewSolve(solve: AnalysisInput): boolean {
  if (!isNormalAnalysisEligible(solve) || solve.penalty === "dnf" || !solve.scramble || !solve.moves?.length
    || !Number.isFinite(solve.totalDuration) || solve.totalDuration <= 0) return false;
  const scramble = validMoves(solve.scramble);
  const solution = validMoves(solve.moves.join(" "));
  return Boolean(scramble && solution && !isScrambleStateVerified(scramble, [])
    && isScrambleStateVerified([...scramble, ...solution], []));
}

/** 手选原题默认比较复原用时；命中具体 CASE 时比较该 CASE 的起手间隔。 */
export function createReviewTarget(solve: AnalysisInput, event?: CaseEvent): SolveReviewTarget | null {
  if (!canReviewSolve(solve)) return null;
  return {
    scramble: solve.scramble!, completedAt: solve.completedAt,
    totalDuration: solve.totalDuration, moveCount: compactMoves(solve.moves!).length,
    goal: event ? caseGoal(event) : { kind: "duration", baseline: solve.totalDuration, reason: "重做同一打乱，比较复原用时" },
  };
}

function caseGoal(event: CaseEvent): SolveReviewGoal {
  return { kind: "case-pause", baseline: event.recognitionPauseMs,
    reason: `${event.caseId} 起手前间隔 ${(event.recognitionPauseMs / 1000).toFixed(2)}s`,
    caseId: event.caseId, stage: event.stage, referenceAlgorithm: event.referenceAlgorithm };
}

export interface DailyReview {
  date: number;
  sampleCount: number;
  targets: SolveReviewTarget[];
}

function longestPause(solve: AnalysisInput): number | null {
  const value = solve.stepReview?.maxGap;
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : null;
}

/** 按本机日历取昨天，各维度取最差 10%（向上取整）；只使用已保存的可信实录。 */
export function selectDailyReview(records: AnalysisInput[], now = Date.now()): DailyReview {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const entries = records.flatMap((solve) => {
    if (solve.completedAt === undefined || !Number.isFinite(solve.completedAt)
      || solve.completedAt < yesterday.getTime() || solve.completedAt >= today.getTime()) return [];
    const target = createReviewTarget(solve);
    return target ? [{ solve, target, pause: longestPause(solve) }] : [];
  });
  const count = Math.ceil(entries.length / 10);
  const metrics = [
    { kind: "duration", label: "复原用时最慢的后 10%", values: entries.map((entry) => ({ ...entry, value: entry.solve.totalDuration })) },
    { kind: "moves", label: "步数最多的前 10%", values: entries.map((entry) => ({ ...entry, value: entry.target.moveCount })) },
    { kind: "pause", label: "最长停顿前 10%", values: entries.filter((entry) => entry.pause !== null && entry.pause > 300)
      .map((entry) => ({ ...entry, value: entry.pause! })) },
  ] as const;
  const selected = new Map<AnalysisInput, SolveReviewTarget>();
  for (const metric of metrics) {
    const ranked = [...metric.values].sort((a, b) => b.value - a.value || (b.solve.completedAt ?? 0) - (a.solve.completedAt ?? 0));
    for (const entry of ranked.slice(0, count)) {
      const value = metric.kind === "moves" ? `${entry.value} 步` : `${(entry.value / 1000).toFixed(2)}s`;
      const reason = `${metric.label}（${value}）`;
      const existing = selected.get(entry.solve);
      if (existing) existing.goal.reason += ` · ${reason}`;
      else selected.set(entry.solve, { ...entry.target, goal: { kind: metric.kind, baseline: entry.value, reason } });
    }
  }
  const unique = new Map<string, SolveReviewTarget>();
  for (const target of selected.values()) {
    const facelets = CubieCube.SOLVED.applyMoves(target.scramble.split(/\s+/).map(parseMove)).toFaceCube();
    if (facelets !== SOLVED_FACELET && !unique.has(facelets)) unique.set(facelets, target);
  }
  return { date: yesterday.getTime(), sampleCount: entries.length, targets: [...unique.values()] };
}

/** 比较原题目标；换解法导致 CASE 消失时，不将其误报为零停顿。 */
export function compareReviewSolve(current: AnalysisInput): ReviewComparison {
  const target = current.review;
  const unavailable = (note: string, completed = false): ReviewComparison => ({ completed, current: null, delta: null, note });
  if (!target || !current.scramble || !resolvePersistedSolveTrust(current).analysisEligible
    || current.penalty === "dnf" || !current.moves?.length) return unavailable("未完成可信的原题复原，请再练一次");
  const scramble = validMoves(current.scramble);
  const solution = validMoves(current.moves.join(" "));
  if (!scramble || !solution || !isScrambleStateVerified([...scramble, ...solution], [])
    || !isScrambleStateVerified(target.scramble.split(/\s+/), scramble)) return unavailable("本次局面与原题不一致，不能比较");
  const { goal } = target;
  let value = goal.kind === "duration" ? current.totalDuration : compactMoves(current.moves).length;
  if (goal.kind === "pause") {
    const pause = longestPause(current);
    if (pause === null) return unavailable("本次缺少完整停顿数据，不比较最长停顿", true);
    value = pause;
  }
  if (goal.kind === "case-pause") {
    const matches = (current.caseEvents ?? []).filter((event) => event.caseId === goal.caseId && event.stage === goal.stage);
    if (matches.length !== 1) return unavailable("本次未唯一命中原 CASE，不比较起手间隔", true);
    const event = matches[0];
    if (!hasSameCaseReference([goal, event])) {
      return unavailable("CASE 解法参照不同或缺失，不比较起手间隔", true);
    }
    value = event.recognitionPauseMs;
  }
  return { completed: true, current: value, delta: value - goal.baseline,
    note: "熟题重练反映本题表现，不代表实战水平提升" };
}

export function summarizeReviewSession(session: SolveReviewSession): string {
  const latest = session.queue.map((target) => [...session.attempts].reverse().find((attempt) => attempt.review === target));
  const comparisons = latest.filter((solve): solve is AnalysisInput => Boolean(solve)).map(compareReviewSolve);
  return `完成 ${comparisons.filter((item) => item.completed).length}/${session.queue.length} 题 · 重练 ${session.attempts.length} 次 · 目标改善 ${comparisons.filter((item) => item.delta !== null && item.delta < 0).length} 题`;
}
