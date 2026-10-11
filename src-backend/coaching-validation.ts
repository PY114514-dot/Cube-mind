import type { AnalysisBaseline, CaseBaseline, CaseTransferProgress, CaseTransferMetrics, StageBaseline } from "../src-shared/analysis-types.ts";
import { MAX_ANALYSIS_SOLVES } from "../src-shared/analysis-coaching.ts";
import { isRecord, isNonNegativeNumber, isMoveCount } from "./validation-values.ts";

const STAGES = new Set(["Cross", "F2L", "OLL", "PLL"]);
const CASE_STAGES = new Set(["F2L", "OLL", "PLL"]);

function isFormula(value: unknown): value is Record<string, unknown> & { stage: CaseBaseline["stage"]; formulaId: string } {
  return isRecord(value) && typeof value.stage === "string" && CASE_STAGES.has(value.stage)
    && typeof value.formulaId === "string" && value.formulaId.length > 0 && value.formulaId.length <= 40;
}

export function parseAnalysisBaseline(value: unknown): AnalysisBaseline | undefined {
  if (!isRecord(value) || !isMoveCount(value.sampleCount) || value.sampleCount > MAX_ANALYSIS_SOLVES
    || !Array.isArray(value.stages) || value.stages.length > 4 || !Array.isArray(value.cases) || value.cases.length > 60) return undefined;
  const stages = value.stages.map((entry): StageBaseline | null => {
    if (!isRecord(entry) || typeof entry.stage !== "string" || !STAGES.has(entry.stage)
      || !isMoveCount(entry.sampleCount) || entry.sampleCount > Number(value.sampleCount) || !isNonNegativeNumber(entry.duration)) return null;
    return { stage: entry.stage as StageBaseline["stage"], sampleCount: entry.sampleCount, duration: entry.duration };
  });
  const cases = value.cases.map((entry): CaseBaseline | null => {
    if (!isRecord(entry) || !isFormula({ stage: entry.stage, formulaId: entry.caseId })
      || !isMoveCount(entry.sampleCount) || entry.sampleCount < 3 || entry.sampleCount > Number(value.sampleCount)
      || !isNonNegativeNumber(entry.recognitionPauseMs) || !isNonNegativeNumber(entry.execMoves)) return null;
    return { stage: entry.stage as CaseBaseline["stage"], caseId: entry.caseId as string,
      sampleCount: entry.sampleCount, recognitionPauseMs: entry.recognitionPauseMs, execMoves: entry.execMoves };
  });
  if (stages.some((entry) => entry === null) || cases.some((entry) => entry === null)) return undefined;
  if (new Set(stages.map((entry) => entry?.stage)).size !== stages.length
    || new Set(cases.map((entry) => `${entry?.stage}:${entry?.caseId}`)).size !== cases.length) return undefined;
  return { sampleCount: value.sampleCount, stages: stages as StageBaseline[], cases: cases as CaseBaseline[] };
}

function parseMetrics(value: unknown, limit: number): CaseTransferMetrics | null {
  if (!isRecord(value) || !isMoveCount(value.caseHits) || value.caseHits > limit) return null;
  if (value.caseHits === 0) {
    return value.averageRecognitionPauseMs === null && value.averageMoveDelta === null
      ? { caseHits: 0, averageRecognitionPauseMs: null, averageMoveDelta: null } : null;
  }
  if (!isNonNegativeNumber(value.averageRecognitionPauseMs)
    || typeof value.averageMoveDelta !== "number" || !Number.isFinite(value.averageMoveDelta)) return null;
  return { caseHits: value.caseHits, averageRecognitionPauseMs: value.averageRecognitionPauseMs, averageMoveDelta: value.averageMoveDelta };
}

export function parseCaseTransfer(value: unknown): CaseTransferProgress[] | undefined {
  if (!Array.isArray(value) || value.length > 20) return undefined;
  const entries = value.map((entry): CaseTransferProgress | null => {
    if (!isRecord(entry) || !isFormula(entry) || !isMoveCount(entry.normalSolveCount)
      || !isMoveCount(entry.targetSolveCount) || entry.targetSolveCount < 1 || entry.targetSolveCount > MAX_ANALYSIS_SOLVES
      || entry.normalSolveCount > entry.targetSolveCount) return null;
    const before = parseMetrics(entry.before, entry.targetSolveCount * 4);
    const after = parseMetrics(entry.after, entry.normalSolveCount * 4);
    if (!before || !after) return null;
    return { formulaId: entry.formulaId, stage: entry.stage,
      normalSolveCount: entry.normalSolveCount, targetSolveCount: entry.targetSolveCount, before, after,
      readyForComparison: before.caseHits >= 3 && after.caseHits >= 3 };
  });
  return entries.some((entry) => entry === null) ? undefined : entries as CaseTransferProgress[];
}
