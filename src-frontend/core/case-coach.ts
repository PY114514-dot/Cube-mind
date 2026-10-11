/**
 * 基于实战 caseEvents 的本地教练选择器。
 * 不等待 AI 才给训练方向：用起手停顿与同一解法参照的步数差选出下一项 CASE。
 */

import type { AnalysisInput, CaseEvent } from "../../src-shared/analysis-types.ts";
import { hasSameCaseReference } from "../../src-shared/analysis-coaching.ts";
import { resolvePersistedSolveTrust } from "./solve-validation.ts";

export interface CaseCoachRecommendation {
  formulaId: string;
  stage: "F2L" | "OLL" | "PLL";
  samples: number;
  hits: number;
  averageRecognitionPauseMs: number;
  averageMoveDelta: number | null;
  reason: string;
}

const MAX_SOLVES = 20;
const MIN_CASE_HITS = 2;

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function averageMoveDeltaFor(events: CaseEvent[]): number | null {
  return hasSameCaseReference(events) ? average(events.map((event) => event.moveDelta)) : null;
}

function score(events: CaseEvent[]): number {
  // 排序使用可比的步数差，不能把更换参照的成绩混成同一个手法的弱项。
  return average(events.map((event) => event.recognitionPauseMs)) / 1000
    + Math.max(0, averageMoveDeltaFor(events) ?? 0) * 0.67;
}

/** 从最近最多 20 把可信常规复原中选出最值得立刻训练的一个 CASE。 */
export function pickNextCaseTraining(solves: AnalysisInput[]): CaseCoachRecommendation | null {
  const recent = solves
    .filter((solve) => solve.practiceKind === undefined && resolvePersistedSolveTrust(solve).analysisEligible)
    .slice(-MAX_SOLVES);
  const byCase = new Map<string, CaseEvent[]>();
  for (const solve of recent) {
    for (const event of solve.caseEvents ?? []) {
      const events = byCase.get(event.caseId) ?? [];
      events.push(event);
      byCase.set(event.caseId, events);
    }
  }
  const candidates = [...byCase.entries()]
    .filter(([, events]) => events.length >= MIN_CASE_HITS)
    .map(([formulaId, events]) => ({ formulaId, events, score: score(events) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.formulaId.localeCompare(right.formulaId));
  const candidate = candidates[0];
  if (!candidate) return null;
  const first = candidate.events[0];
  const averageRecognitionPauseMs = average(candidate.events.map((event) => event.recognitionPauseMs));
  const averageMoveDelta = averageMoveDeltaFor(candidate.events);
  const pauseText = `${(averageRecognitionPauseMs / 1000).toFixed(2)}s 起手前停顿`;
  const moveText = averageMoveDelta === null ? "解法参照不一致，暂不汇总步数差"
    : averageMoveDelta > 0 ? `比所选解法平均多 ${averageMoveDelta.toFixed(1)} 步` : "步数接近所选解法参照";
  return {
    formulaId: candidate.formulaId,
    stage: first.stage,
    samples: recent.length,
    hits: candidate.events.length,
    averageRecognitionPauseMs,
    averageMoveDelta,
    reason: `最近 ${recent.length} 把实战命中 ${candidate.events.length} 次 · ${pauseText} · ${moveText}`,
  };
}
