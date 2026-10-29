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

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length ? (sorted[middle] + sorted[Math.max(0, middle - (sorted.length % 2 === 0 ? 1 : 0))]) / 2 : 0;
}

/** 最近 100 把中选最多 10 个不同局面，每题只保留一个有实录依据的目标。 */
export function selectReviewTargets(records: AnalysisInput[]): SolveReviewTarget[] {
  const recent = records.filter(canReviewSolve).slice(-100);
  const time = median(recent.map((solve) => solve.totalDuration));
  const moves = median(recent.map((solve) => compactMoves(solve.moves!).length));
  const ranked = recent.flatMap((solve) => {
    const target = createReviewTarget(solve)!;
    const goals: { goal: SolveReviewGoal; score: number }[] = [];
    if (recent.length >= 3 && solve.totalDuration >= Math.max(time * 1.2, time + 1000)) {
      goals.push({ goal: { kind: "duration", baseline: solve.totalDuration,
        reason: `用时高于近 ${recent.length} 把中位数 ${(time / 1000).toFixed(2)}s` }, score: solve.totalDuration / time });
    }
    if (recent.length >= 3 && target.moveCount >= moves + 5) {
      goals.push({ goal: { kind: "moves", baseline: target.moveCount,
        reason: `总步数高于近 ${recent.length} 把中位数 ${moves} 步；不等同于废步` }, score: target.moveCount / moves });
    }
    for (const event of solve.caseEvents ?? []) {
      if (event.recognitionPauseMs >= 1000 && (solve.caseEvents ?? []).filter((item) => item.caseId === event.caseId).length === 1) {
        goals.push({ goal: caseGoal(event), score: event.recognitionPauseMs / 1000 });
      }
    }
    const best = goals.sort((a, b) => b.score - a.score)[0];
    return best ? [{ target: { ...target, goal: best.goal }, score: best.score }] : [];
  }).sort((a, b) => b.score - a.score || (b.target.completedAt ?? 0) - (a.target.completedAt ?? 0));
  const unique = new Map<string, SolveReviewTarget>();
  for (const { target } of ranked) {
    const facelets = CubieCube.SOLVED.applyMoves(target.scramble.split(/\s+/).map(parseMove)).toFaceCube();
    if (facelets !== SOLVED_FACELET && !unique.has(facelets)) unique.set(facelets, target);
  }
  return [...unique.values()].slice(0, 10);
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
