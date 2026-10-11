import type {
  AnalysisInput, AnalysisSolve, AnalysisBaseline, AnalysisIssue, CaseEvent,
} from "./analysis-types.ts";

export const MAX_ANALYSIS_SOLVES = 30;
const MIN_BASELINE_SAMPLES = 3;
const STAGES = [
  { name: "Cross", duration: "crossDuration", moves: "crossMoves" },
  { name: "F2L", duration: "f2lDuration", moves: "f2lMoves" },
  { name: "OLL", duration: "ollDuration", moves: "ollMoves" },
  { name: "PLL", duration: "pllDuration", moves: "pllMoves" },
] as const;

export interface CoachingEvidence extends AnalysisIssue {
  id: string;
  kind: "case" | "pause" | "slot" | "stage";
  caseId?: string;
  replay?: { solveIndex: number; startMoveIndex: number; endMoveIndex: number };
}

interface CaseOccurrence {
  event: CaseEvent;
  solveIndex: number;
  averageGap: number;
}

/** 实录白名单只保留一把的证据，分析窗口与训练上下文不能混进样本。 */
export function toAnalysisSolve(solve: AnalysisInput): AnalysisSolve {
  return {
    scramble: solve.scramble, moves: solve.moves, moveGaps: solve.moveGaps,
    totalDuration: solve.totalDuration,
    crossDuration: solve.crossDuration, f2lDuration: solve.f2lDuration,
    ollDuration: solve.ollDuration, pllDuration: solve.pllDuration,
    crossMoves: solve.crossMoves, f2lMoves: solve.f2lMoves,
    ollMoves: solve.ollMoves, pllMoves: solve.pllMoves,
    moveCount: solve.moveCount ?? solve.moves?.length,
    tps: solve.totalDuration > 0 && (solve.moveCount !== undefined || solve.moves !== undefined)
      ? (solve.moveCount ?? solve.moves?.length ?? 0) / (solve.totalDuration / 1000) : undefined,
    f2lSlots: solve.f2lSlots, caseEvents: solve.caseEvents, stepReview: solve.stepReview,
  };
}

export function getAnalysisSolves(input: AnalysisInput): AnalysisSolve[] {
  return input.analysisSolves ?? [input];
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length === 0 ? 0 : sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function getStageMetrics(input: AnalysisInput) {
  const solves = getAnalysisSolves(input);
  return STAGES.map((stage) => ({
    name: stage.name,
    duration: mean(solves.map((solve) => solve[stage.duration])),
    moves: mean(solves.map((solve) => solve[stage.moves])),
  }));
}

function groupCases(solves: AnalysisSolve[]): CaseOccurrence[][] {
  const groups = new Map<string, CaseOccurrence[]>();
  solves.forEach((solve, solveIndex) => {
    for (const event of solve.caseEvents ?? []) {
      const key = `${event.stage}:${event.caseId}`;
      const group = groups.get(key) ?? [];
      group.push({ event, solveIndex, averageGap: solve.stepReview?.averageGap ?? 0 });
      groups.set(key, group);
    }
  });
  return [...groups.values()];
}

/** 基准只由本次窗口之前的常规成绩构建；跳过阶段不计入该阶段的中位数。 */
export function buildAnalysisBaseline(solves: AnalysisSolve[]): AnalysisBaseline {
  return {
    sampleCount: solves.length,
    stages: STAGES.map((stage) => {
      const durations = solves.filter((solve) => solve[stage.moves] > 0).map((solve) => solve[stage.duration]);
      return { stage: stage.name, sampleCount: durations.length, duration: median(durations) };
    }),
    cases: groupCases(solves).flatMap((group) => {
      const sampleCount = new Set(group.map((item) => item.solveIndex)).size;
      return sampleCount < MIN_BASELINE_SAMPLES ? [] : [{
        stage: group[0].event.stage,
        caseId: group[0].event.caseId,
        sampleCount,
        recognitionPauseMs: median(group.map((item) => item.event.recognitionPauseMs)),
        execMoves: median(group.map((item) => item.event.execMoves)),
      }];
    }),
  };
}

/** 阶段占比只展示时间分布；严重度取相对个人基准的增长幅度。 */
export function stageSeverity(deltaPercent: number | null): AnalysisIssue["severity"] {
  return deltaPercent !== null && deltaPercent >= 35 ? "high"
    : deltaPercent !== null && deltaPercent >= 20 ? "medium" : "low";
}

export function slotSeverity(maxGap: number): AnalysisIssue["severity"] {
  return maxGap > 2000 ? "high" : "medium";
}

export function caseEventSeverity(moveDelta: number, recognitionPauseMs: number): AnalysisIssue["severity"] {
  return moveDelta >= 5 || recognitionPauseMs > 2000 ? "high" : "medium";
}

export function pauseSeverity(gap: number): AnalysisIssue["severity"] {
  return gap > 2000 ? "high" : "medium";
}

export function flagCaseEvents(events: CaseEvent[] | undefined, averageGap: number, limit: number): CaseEvent[] {
  return (events ?? []).filter((event) => event.moveDelta >= 3
    || event.recognitionPauseMs > Math.max(300, averageGap > 0 ? averageGap * 1.5 : 2000)).slice(0, limit);
}

/** 同一解法快照才允许汇总或比较参照步数差。 */
export function hasSameCaseReference(events: CaseEvent[]): boolean {
  const moves = events[0]?.referenceAlgorithm?.moves.join(" ");
  return moves !== undefined && events.every((event) => event.referenceAlgorithm?.moves.join(" ") === moves);
}

function replayFor(solve: AnalysisSolve, solveIndex: number, start: number | undefined, end: number | undefined): CoachingEvidence["replay"] {
  if (typeof start !== "number" || typeof end !== "number" || !Number.isInteger(start) || !Number.isInteger(end)
    || start < 0 || end <= start || end > (solve.moves?.length ?? 0) || typeof solve.scramble !== "string") return undefined;
  return { solveIndex, startMoveIndex: start, endMoveIndex: end };
}

function caseExecutionText(solve: AnalysisSolve, event: CaseEvent): string {
  const { startMoveIndex: start, endMoveIndex: end } = event;
  if (start === undefined || end === undefined || !Number.isInteger(start) || !Number.isInteger(end)
    || start < 0 || end <= start || end > (solve.moves?.length ?? 0)
    || solve.moveGaps?.length !== solve.moves?.length) return "执行时间未完整记录";
  const gaps = solve.moveGaps?.slice(start + 1, end);
  if (!gaps || gaps.length !== event.execMoves - 1
    || gaps.some((gap) => !Number.isFinite(gap) || gap < 0)) return "执行时间未完整记录";
  const duration = gaps.reduce((sum, gap) => sum + gap, 0);
  return `首末动作间隔 ${(duration / 1000).toFixed(2)}s（不含起手前等待，含片段内停顿）`;
}

function caseEvidence(input: AnalysisInput): CoachingEvidence[] {
  const solves = getAnalysisSolves(input);
  return groupCases(solves).flatMap((group): CoachingEvidence[] => {
    const { stage, caseId } = group[0].event;
    const baseline = input.baseline?.cases.find((entry) => entry.stage === stage && entry.caseId === caseId);
    const flagged = group.filter(({ event, averageGap }) => flagCaseEvents([event], averageGap, 1).length > 0
      || (baseline && event.recognitionPauseMs > Math.max(300, baseline.recognitionPauseMs * 1.5)));
    if (flagged.length === 0) return [];
    // 代表局面优先取偏差大且有准确区间的实录，不能根据模型文字反推动作位置。
    const ranked = [...flagged].sort((a, b) => b.event.recognitionPauseMs - a.event.recognitionPauseMs
      || b.event.moveDelta - a.event.moveDelta);
    const representative = ranked.find(({ event, solveIndex }) =>
      replayFor(solves[solveIndex], solveIndex, event.startMoveIndex, event.endMoveIndex)) ?? ranked[0];
    const { event, solveIndex } = representative;
    const solveCount = new Set(group.map((item) => item.solveIndex)).size;
    const pause = median(group.map((item) => item.event.recognitionPauseMs));
    const moves = median(group.map((item) => item.event.execMoves));
    const prior = baseline
      ? `；此前 ${baseline.sampleCount} 把同 CASE 中位数：停顿 ${(baseline.recognitionPauseMs / 1000).toFixed(2)}s、${baseline.execMoves} 步`
      : "；同 CASE 个人基准不足";
    const reference = event.referenceAlgorithm
      ? `${event.referenceAlgorithm.name}参照 ${event.expectedMoves} 步（${event.referenceAlgorithm.moves.join(" ")}）`
      : `参照 ${event.expectedMoves} 步`;
    return [{
      id: `case:${stage}:${caseId}`, kind: "case", stage, caseId,
      severity: caseEventSeverity(Math.max(...flagged.map((item) => item.event.moveDelta)), Math.max(...flagged.map((item) => item.event.recognitionPauseMs))),
      description: `${caseId} 在 ${solveCount} 把中命中 ${group.length} 次，${flagged.length} 次出现停顿或步数偏差`,
      evidence: `本窗中位数：起手前停顿 ${(pause / 1000).toFixed(2)}s、${moves} 步；代表为第 ${solveIndex + 1} 把：实际 ${event.execMoves} 步 vs ${reference}，起手前停顿 ${(event.recognitionPauseMs / 1000).toFixed(2)}s；${caseExecutionText(solves[solveIndex], event)}${prior}；${solveCount < 3 ? "样本较少，暂不判断持续弱项" : "重复命中可供复盘，仍不能证明停顿原因"}`,
      replay: replayFor(solves[solveIndex], solveIndex, event.startMoveIndex, event.endMoveIndex),
    }];
  }).sort((a, b) => Number(b.severity === "high") - Number(a.severity === "high")).slice(0, 6);
}

function stageEvidence(input: AnalysisInput): CoachingEvidence[] {
  const solves = getAnalysisSolves(input);
  return STAGES.map((stage) => {
    const durations = solves.filter((solve) => solve[stage.moves] > 0).map((solve) => solve[stage.duration]);
    const current = median(durations);
    const baseline = input.baseline?.stages.find((entry) => entry.stage === stage.name && entry.sampleCount >= MIN_BASELINE_SAMPLES);
    const delta = baseline && baseline.duration > 0 && durations.length > 0 ? (current / baseline.duration - 1) * 100 : null;
    return {
      id: `stage:${stage.name}`, kind: "stage" as const, stage: stage.name,
      severity: stageSeverity(delta),
      description: delta !== null && delta >= 20 ? `${stage.name} 比此前个人基准偏慢` : `${stage.name} 阶段时间分布`,
      evidence: `本窗 ${durations.length} 把非跳过阶段，中位数 ${(current / 1000).toFixed(2)}s；${delta === null
        ? "个人基准不足，不能据耗时占比判定异常"
        : `此前 ${baseline?.sampleCount} 把中位数 ${((baseline?.duration ?? 0) / 1000).toFixed(2)}s，变化 ${delta >= 0 ? "+" : ""}${delta.toFixed(0)}%（局面难度可能影响用时）`}`,
    };
  });
}

function pauseEvidence(input: AnalysisInput): CoachingEvidence[] {
  return getAnalysisSolves(input).flatMap((solve, solveIndex) =>
    (solve.stepReview?.pauses ?? []).filter((pause) => pause.gap > Math.max(300, (solve.stepReview?.averageGap ?? 0) * 1.5)).map((pause): CoachingEvidence => {
      const stage = STAGES.find((item) => item.name.toLowerCase() === pause.stage.toLowerCase())?.name ?? "General";
      return {
        id: `pause:${solveIndex}:${pause.index}`, kind: "pause", stage,
        severity: pauseSeverity(pause.gap),
        description: `第 ${solveIndex + 1} 把，${stage === "General" ? "阶段未识别" : `${stage} 阶段`}第 ${pause.index + 1} 步 ${pause.move} 前有长停顿`,
        evidence: `动作间隔 ${(pause.gap / 1000).toFixed(2)}s；仅记录停顿，原因需要结合局面与本人确认`,
        replay: replayFor(solve, solveIndex, pause.index, pause.index + 1),
      };
    })).sort((a, b) => Number(b.severity === "high") - Number(a.severity === "high")).slice(0, 4);
}

function slotEvidence(input: AnalysisInput): CoachingEvidence[] {
  return getAnalysisSolves(input).flatMap((solve, solveIndex) =>
    (solve.f2lSlots ?? []).filter((slot) => !slot.completedWithCross && slot.duration !== undefined
      && (slot.maxGap > 1000 || slot.repairCount > 0 || slot.breakCount > 0)).map((slot): CoachingEvidence => ({
      id: `slot:${solveIndex}:${slot.slot}`, kind: "slot", stage: "F2L",
      severity: slotSeverity(slot.maxGap),
      description: `第 ${solveIndex + 1} 把，F2L 第 ${slot.completionOrder ?? "—"} 对 ${slot.slot} 有停顿或修复`,
      evidence: `${((slot.duration ?? 0) / 1000).toFixed(2)}s、${slot.moves ?? 0} 步、最长停顿 ${(slot.maxGap / 1000).toFixed(2)}s、修复 ${slot.repairCount} 次、回退 ${slot.breakCount} 次`,
      replay: replayFor(solve, solveIndex,
        slot.completedAtMove !== undefined && slot.moves !== undefined ? slot.completedAtMove - slot.moves : undefined,
        slot.completedAtMove),
    }))).slice(0, 4);
}

/** 前后端与模型共享同一证据目录，引用 ID 决定可信数据和回放目标。 */
export function buildCoachingEvidence(input: AnalysisInput): CoachingEvidence[] {
  const cases = caseEvidence(input);
  const pauses = pauseEvidence(input).filter((pause) => !cases.some((item) =>
    item.replay && pause.replay && item.replay.solveIndex === pause.replay.solveIndex
    && item.replay.startMoveIndex === pause.replay.startMoveIndex));
  return [...cases, ...pauses, ...slotEvidence(input), ...stageEvidence(input)]
    .sort((a, b) => Number(b.severity === "high") - Number(a.severity === "high")
      || Number(a.severity === "low") - Number(b.severity === "low"));
}

export function resolveCoachingReplay(input: AnalysisInput, evidenceId: string) {
  const evidence = buildCoachingEvidence(input).find((entry) => entry.id === evidenceId);
  const replay = evidence?.replay;
  if (!replay) return null;
  const solve = getAnalysisSolves(input)[replay.solveIndex];
  if (!solve.moves?.every((move) => /^[URFDLB](?:2|')?$/.test(move.trim()))) return null;
  return { ...replay, solve, label: evidence.description };
}
