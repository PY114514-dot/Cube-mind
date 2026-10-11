import type { AnalysisInput, AnalysisSolve, AssignmentProgressEntry } from "../src-shared/analysis-types.ts";
import type { TrainingProfileEntry } from "../src-shared/training-plan-types.ts";
import { MAX_ANALYSIS_SOLVES, toAnalysisSolve } from "../src-shared/analysis-coaching.ts";
import { parseAnalysisBaseline, parseCaseTransfer } from "./coaching-validation.ts";
import { isRecord, isNonNegativeNumber, isMoveCount, isInteger } from "./validation-values.ts";

const MAX_TOTAL_RECENT_PAUSES = 40;
const MAX_SCRAMBLE_LENGTH = 500;
const MAX_MOVES_LENGTH = 200;
const MAX_MOVE_TOKEN_LENGTH = 5;
const MAX_F2L_SLOTS = 4;
const MAX_FORMULA_ID_LENGTH = 40;
/** 输入侧 case 事件上限（渲染层 flagCaseEvents 还会再截断到 6 条） */
const MAX_CASE_EVENTS_INPUT = 60;
const MAX_ASSIGNMENT_PROGRESS = 30;
/** 训练档案输入上限，与 core/training-profile.ts 的 MAX_PROFILE_ENTRIES 对齐 */
const MAX_PROFILE_ENTRIES_INPUT = 200;
const VALID_STAGES = new Set(["F2L", "OLL", "PLL"]);
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function optionalString(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.length <= maxLength ? value : undefined;
}

function parseMoves(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_MOVES_LENGTH) return undefined;
  const moves = value.filter(
    (token): token is string => typeof token === "string" && token.length <= MAX_MOVE_TOKEN_LENGTH,
  );
  return moves.length === value.length ? moves : undefined;
}

function parseMoveGaps(value: unknown, moves: string[] | undefined): number[] | undefined {
  if (!Array.isArray(value) || value.length !== moves?.length || !value.every(isNonNegativeNumber)) return undefined;
  return value as number[];
}

const VALID_SLOTS = new Set(["FR", "FL", "BL", "BR"]);

function parseF2lSlots(value: unknown): AnalysisInput["f2lSlots"] | undefined {
  if (!Array.isArray(value) || value.length > MAX_F2L_SLOTS) return undefined;
  const slots = value.map((item) => {
    if (!isRecord(item)) return null;
    if (typeof item.slot !== "string" || !VALID_SLOTS.has(item.slot)) return null;
    const moveSequence = item.moveSequence === undefined ? undefined : parseMoves(item.moveSequence);
    if (item.moveSequence !== undefined && !moveSequence) return null;
    return {
      slot: item.slot as "FR" | "FL" | "BL" | "BR",
      completionOrder: isMoveCount(item.completionOrder) ? item.completionOrder : undefined,
      completedAtMove: isMoveCount(item.completedAtMove) ? item.completedAtMove : undefined,
      duration: isNonNegativeNumber(item.duration) ? item.duration : undefined,
      moves: isMoveCount(item.moves) ? item.moves : undefined,
      moveSequence,
      pauseCount: isMoveCount(item.pauseCount) ? item.pauseCount : 0,
      maxGap: isNonNegativeNumber(item.maxGap) ? item.maxGap : 0,
      breakCount: isMoveCount(item.breakCount) ? item.breakCount : 0,
      repairCount: isMoveCount(item.repairCount) ? item.repairCount : 0,
      completedWithCross: item.completedWithCross === true,
    };
  });
  return slots.some((slot) => slot === null) ? undefined : slots as NonNullable<AnalysisInput["f2lSlots"]>;
}

const MAX_SESSION_ENTRIES = 5;

function parseSessionContext(value: unknown): AnalysisInput["sessionContext"] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const entries = value.slice(0, MAX_SESSION_ENTRIES).map((item): AnalysisInput["sessionContext"] extends (infer T)[] | undefined ? T | null : never => {
    if (!isRecord(item)) return null;
    if (!isNonNegativeNumber(item.completedAt) || !isNonNegativeNumber(item.totalDuration)) return null;
    const bottleneckStage = typeof item.bottleneckStage === "string" ? item.bottleneckStage.slice(0, 20) : "";
    const topIssue = typeof item.topIssue === "string" ? item.topIssue.slice(0, 200) : "";
    return { completedAt: item.completedAt, totalDuration: item.totalDuration, bottleneckStage, topIssue };
  });
  return entries.some((e) => e === null) ? undefined : entries as NonNullable<AnalysisInput["sessionContext"]>;
}

const MAX_PRACTICE_SUMMARY = 30;
const VALID_PRACTICE_CATEGORIES = new Set(["F2L", "OLL", "PLL"]);

function parsePracticeSummary(value: unknown): AnalysisInput["practiceSummary"] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_PRACTICE_SUMMARY) return undefined;
  const entries = value.map((item): AnalysisInput["practiceSummary"] extends (infer T)[] | undefined ? T | null : never => {
    if (!isRecord(item)) return null;
    const formulaId = typeof item.formulaId === "string" && item.formulaId.length > 0 && item.formulaId.length <= 40 ? item.formulaId : null;
    const name = typeof item.name === "string" && item.name.length <= 60 ? item.name : "";
    const category = typeof item.category === "string" && VALID_PRACTICE_CATEGORIES.has(item.category) ? item.category as "F2L" | "OLL" | "PLL" : null;
    if (!formulaId || !category) return null;
    if (!isMoveCount(item.attempts) || !isMoveCount(item.successes)) return null;
    if (typeof item.successRate !== "number" || !Number.isFinite(item.successRate) || item.successRate < 0 || item.successRate > 1) return null;
    const averageDuration = item.averageDuration === null ? null : isNonNegativeNumber(item.averageDuration) ? item.averageDuration : undefined;
    const averageRecognitionDuration = item.averageRecognitionDuration === null ? null : isNonNegativeNumber(item.averageRecognitionDuration) ? item.averageRecognitionDuration : undefined;
    const averageExecutionDuration = item.averageExecutionDuration === null ? null : isNonNegativeNumber(item.averageExecutionDuration) ? item.averageExecutionDuration : undefined;
    if (averageDuration === undefined || averageRecognitionDuration === undefined || averageExecutionDuration === undefined) return null;
    return { formulaId, name, category, attempts: item.attempts, successes: item.successes, successRate: item.successRate, averageDuration, averageRecognitionDuration, averageExecutionDuration };
  });
  return entries.some((e) => e === null) ? undefined : entries as NonNullable<AnalysisInput["practiceSummary"]>;
}

/** 本把步级停顿复盘（stepReview）：pauseThreshold/averageGap/maxGap + 停顿明细。 */
function parseStepReview(value: unknown): AnalysisInput["stepReview"] {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !isNonNegativeNumber(value.pauseThreshold)
    || !isNonNegativeNumber(value.averageGap) || !isNonNegativeNumber(value.maxGap)
    || !Array.isArray(value.pauses) || value.pauses.length > MAX_TOTAL_RECENT_PAUSES) return undefined;
  type StepPause = NonNullable<AnalysisInput["stepReview"]>["pauses"][number];
  const pauses = value.pauses.map((pause): StepPause | null => {
    if (!isRecord(pause) || !isMoveCount(pause.index)
      || typeof pause.move !== "string" || pause.move.length > 10
      || !isNonNegativeNumber(pause.gap)
      || typeof pause.stage !== "string" || pause.stage.length > 20
      || typeof pause.reason !== "string" || pause.reason.length > 200) return null;
    return { index: pause.index, move: pause.move, gap: pause.gap, stage: pause.stage, reason: pause.reason };
  });
  if (pauses.some((pause) => pause === null)) return undefined;
  return {
    pauseThreshold: value.pauseThreshold,
    averageGap: value.averageGap,
    maxGap: value.maxGap,
    pauses: pauses as StepPause[],
  };
}

/** 逐 case 证据流：stage/caseId 白名单 + 数值域校验，防止恶意长列表撑爆提示词。 */
function parseCaseEvents(value: unknown): AnalysisInput["caseEvents"] | undefined {
  if (!Array.isArray(value) || value.length > MAX_CASE_EVENTS_INPUT) return undefined;
  type CaseEvent = NonNullable<AnalysisInput["caseEvents"]>[number];
  const events = value.map((item): CaseEvent | null => {
    if (!isRecord(item)) return null;
    if (typeof item.stage !== "string" || !VALID_STAGES.has(item.stage)) return null;
    if (typeof item.caseId !== "string" || item.caseId.length === 0 || item.caseId.length > MAX_FORMULA_ID_LENGTH) return null;
    if (!isNonNegativeNumber(item.recognitionPauseMs)
      || !isMoveCount(item.execMoves) || !isMoveCount(item.expectedMoves) || !isInteger(item.moveDelta)
      || item.moveDelta !== item.execMoves - item.expectedMoves) return null;
    if ((item.startMoveIndex !== undefined || item.endMoveIndex !== undefined)
      && (!isMoveCount(item.startMoveIndex) || !isMoveCount(item.endMoveIndex)
        || item.endMoveIndex - item.startMoveIndex !== item.execMoves)) return null;
    let referenceAlgorithm: CaseEvent["referenceAlgorithm"];
    if (item.referenceAlgorithm !== undefined) {
      const reference = item.referenceAlgorithm;
      if (!isRecord(reference) || typeof reference.name !== "string"
        || reference.name.trim().length === 0 || reference.name.length > 60) return null;
      const moves = parseMoves(reference.moves);
      if (!moves || moves.length === 0 || moves.length > 80 || moves.length !== item.expectedMoves
        || moves.some((move) => !/^(?:[URFDLB]w?|[MESxyzurfdlb])[2']?$/.test(move))) return null;
      referenceAlgorithm = { name: reference.name, moves };
    }
    return {
      stage: item.stage as CaseEvent["stage"],
      caseId: item.caseId,
      recognitionPauseMs: item.recognitionPauseMs,
      execMoves: item.execMoves,
      expectedMoves: item.expectedMoves,
      moveDelta: item.moveDelta,
      referenceAlgorithm,
      startMoveIndex: item.startMoveIndex as number | undefined,
      endMoveIndex: item.endMoveIndex as number | undefined,
    };
  });
  return events.some((event) => event === null) ? undefined : events as CaseEvent[];
}

/** 指派效果回流条目：成功率必须是 0-1 有限数或 null。 */
function parseAssignmentProgress(value: unknown): AnalysisInput["assignmentProgress"] | undefined {
  if (!Array.isArray(value) || value.length > MAX_ASSIGNMENT_PROGRESS) return undefined;
  const entries = value.map((item): AssignmentProgressEntry | null => {
    if (!isRecord(item)) return null;
    if (typeof item.formulaId !== "string" || item.formulaId.length === 0 || item.formulaId.length > MAX_FORMULA_ID_LENGTH) return null;
    if (typeof item.stage !== "string" || !VALID_STAGES.has(item.stage)) return null;
    if (!isNonNegativeNumber(item.lastAssignedAt) || !isMoveCount(item.practiceAttempts)) return null;
    const rate = item.practiceSuccessRate;
    if (rate !== null && (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 1)) return null;
    return {
      formulaId: item.formulaId,
      stage: item.stage as AssignmentProgressEntry["stage"],
      lastAssignedAt: item.lastAssignedAt,
      practiceAttempts: item.practiceAttempts,
      practiceSuccessRate: rate,
    };
  });
  return entries.some((entry) => entry === null) ? undefined : entries as AssignmentProgressEntry[];
}

/** 纵向训练档案：日期键格式 + 计数域校验，与前端 store 的 isProfileEntry 同口径。 */
function parseTrainingProfile(value: unknown): AnalysisInput["trainingProfile"] | undefined {
  if (!Array.isArray(value) || value.length > MAX_PROFILE_ENTRIES_INPUT) return undefined;
  const entries = value.map((item): TrainingProfileEntry | null => {
    if (!isRecord(item)) return null;
    if (typeof item.formulaId !== "string" || item.formulaId.length === 0 || item.formulaId.length > MAX_FORMULA_ID_LENGTH) return null;
    if (typeof item.stage !== "string" || !VALID_STAGES.has(item.stage)) return null;
    if (typeof item.dateKey !== "string" || !DATE_KEY_PATTERN.test(item.dateKey)) return null;
    if (!isMoveCount(item.attempts) || !isMoveCount(item.successes) || !isNonNegativeNumber(item.lastPracticedAt)) return null;
    if (item.avgExecutionMs !== null && !isNonNegativeNumber(item.avgExecutionMs)) return null;
    return {
      formulaId: item.formulaId,
      stage: item.stage as TrainingProfileEntry["stage"],
      dateKey: item.dateKey,
      attempts: item.attempts,
      successes: item.successes,
      avgExecutionMs: item.avgExecutionMs,
      lastPracticedAt: item.lastPracticedAt,
    };
  });
  return entries.some((entry) => entry === null) ? undefined : entries as TrainingProfileEntry[];
}

function parseAnalysisSolves(value: unknown): AnalysisSolve[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ANALYSIS_SOLVES) return undefined;
  const solves = value.map((item): AnalysisSolve | null => {
    if (!isRecord(item) || item.analysisSolves !== undefined || item.baseline !== undefined || item.caseTransfer !== undefined) return null;
    // 只解析一层实录，不能让未知的嵌套字段递归构建分析请求。
    const parsed = parseAnalysisInput({ ...item, analysisSolves: undefined, baseline: undefined, caseTransfer: undefined });
    return parsed ? toAnalysisSolve(parsed) : null;
  });
  return solves.some((solve) => solve === null) ? undefined : solves as AnalysisSolve[];
}

function hasInvalidIndexes(input: AnalysisInput): boolean {
  const moves = input.moves;
  if (!moves) return false;
  return (input.caseEvents ?? []).some((event) => event.endMoveIndex !== undefined && event.endMoveIndex > moves.length)
    || (input.stepReview?.pauses ?? []).some((pause) => pause.index >= moves.length || pause.move.trim() !== moves[pause.index].trim())
    || (input.f2lSlots ?? []).some((slot) => slot.completedAtMove !== undefined
      && (slot.completedAtMove > moves.length || slot.completedAtMove < (slot.moves ?? 0)));
}

/** 将不可信请求体收窄为分析服务所需的安全输入。 */
export function parseAnalysisInput(value: unknown): AnalysisInput | null {
  if (!isRecord(value)) return null;
  const requiredDurations = ["totalDuration", "crossDuration", "f2lDuration", "ollDuration", "pllDuration"] as const;
  const requiredMoves = ["crossMoves", "f2lMoves", "ollMoves", "pllMoves"] as const;
  if (requiredDurations.some((field) => !isNonNegativeNumber(value[field]))
    || requiredMoves.some((field) => !isMoveCount(value[field]))) return null;

  const analysisSolves = parseAnalysisSolves(value.analysisSolves);
  const baseline = parseAnalysisBaseline(value.baseline);
  const caseTransfer = parseCaseTransfer(value.caseTransfer);
  if (value.analysisSolves !== undefined && !analysisSolves) return null;
  if (value.baseline !== undefined && !baseline) return null;
  if (value.caseTransfer !== undefined && !caseTransfer) return null;
  const scramble = optionalString(value.scramble, MAX_SCRAMBLE_LENGTH);
  const moves = parseMoves(value.moves);
  const moveGaps = parseMoveGaps(value.moveGaps, moves);
  const f2lSlots = parseF2lSlots(value.f2lSlots);
  const sessionContext = parseSessionContext(value.sessionContext);
  const practiceSummary = parsePracticeSummary(value.practiceSummary);
  const stepReview = parseStepReview(value.stepReview);
  const caseEvents = parseCaseEvents(value.caseEvents);
  const assignmentProgress = parseAssignmentProgress(value.assignmentProgress);
  const trainingProfile = parseTrainingProfile(value.trainingProfile);
  const moveCount = isMoveCount(value.moveCount) ? value.moveCount : undefined;
  if (value.moves !== undefined && !moves) return null;
  if (value.moveGaps !== undefined && (!moveGaps || moveGaps.reduce((sum, gap) => sum + gap, 0) > (value.totalDuration as number))) return null;
  if (value.f2lSlots !== undefined && !f2lSlots) return null;
  if (value.practiceSummary !== undefined && !practiceSummary) return null;
  if (value.stepReview !== undefined && !stepReview) return null;
  if (value.caseEvents !== undefined && !caseEvents) return null;
  if (value.assignmentProgress !== undefined && !assignmentProgress) return null;
  if (value.trainingProfile !== undefined && !trainingProfile) return null;

  const input: AnalysisInput = {
    totalDuration: value.totalDuration as number,
    crossDuration: value.crossDuration as number,
    f2lDuration: value.f2lDuration as number,
    ollDuration: value.ollDuration as number,
    pllDuration: value.pllDuration as number,
    crossMoves: value.crossMoves as number,
    f2lMoves: value.f2lMoves as number,
    ollMoves: value.ollMoves as number,
    pllMoves: value.pllMoves as number,
    analysisScope: analysisSolves?.length ?? 1,
    analysisSolves,
    baseline,
    caseTransfer,
    scramble,
    moves,
    moveGaps,
    f2lSlots,
    sessionContext,
    practiceSummary,
    moveCount,
    stepReview,
    caseEvents,
    assignmentProgress,
    trainingProfile,
  };
  if (hasInvalidIndexes(input)) return null;
  return analysisSolves ? { ...input, ...analysisSolves[analysisSolves.length - 1] } : input;
}
