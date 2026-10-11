import type { TrainingProfileEntry } from "./training-plan-types.ts";

export interface AnalysisInput {
  /** 数据 schema 版本号，用于 localStorage 迁移；缺失视为 v0 */
  dataVersion?: number;
  analysisScope?: number;
  /** 本次选中的可信常规复原，顺序同时用于证据引用与回放定位。 */
  analysisSolves?: AnalysisSolve[];
  /** 所选窗口之前最多 30 把常规复原的个人基准，不与本次样本重叠。 */
  baseline?: AnalysisBaseline;
  /** 专项训练前后同 CASE 的实战表现，供教练调整训练内容。 */
  caseTransfer?: CaseTransferProgress[];
  completedAt?: number;
  deviceName?: string;
  deviceId?: string;
  groupId?: string;
  practiceMode?: "cross" | "f2l" | "cross-f2l";
  practiceKind?: "formula" | "cross" | "f2l" | "cross-f2l";
  practiceFormulaId?: string;
  /** 专项训练时所选解法快照；不同解法不能直接比较执行速度。 */
  practiceReferenceAlgorithm?: CaseAlgorithmReference;
  practiceOutcome?: "success" | "failed";
  recognitionDuration?: number;
  executionDuration?: number;
  /** 观察用时（毫秒），仅在启用观察且非练习模式时有效 */
  inspectionDuration?: number;
  crossPracticeSteps?: number;
  crossPracticePauses?: number;
  crossPracticeTps?: number;
  moveCount?: number;
  tps?: number;
  scramble?: string;
  moves?: string[];
  totalDuration: number;
  crossDuration: number;
  f2lDuration: number;
  ollDuration: number;
  pllDuration: number;
  crossMoves: number;
  f2lMoves: number;
  ollMoves: number;
  pllMoves: number;
  qualityStatus?: "valid" | "incomplete" | "invalid";
  qualityAnomalies?: string[];
  /** 实体魔方状态回读结果；用于判定成绩能否进入 PB/AO。 */
  physicalState?: "confirmed-solved" | "confirmed-unsolved" | "unavailable";
  /** 持久化的统一可信度结论；旧记录缺失时由 qualityStatus/physicalState 兼容推导。 */
  trustState?: "analysis-ready" | "score-only" | "rejected";
  /** 动作流是否足以支持 CFOP、停顿和 Agent 分析。 */
  analysisEligible?: boolean;
  penalty?: "none" | "plus2" | "dnf";
  moveGaps?: number[];
  f2lSlots?: Array<{
    slot: "FR" | "FL" | "BL" | "BR";
    completionOrder?: number;
    completedAtMove?: number;
    duration?: number;
    moves?: number;
    moveSequence?: string[];
    pauseCount: number;
    maxGap: number;
    breakCount: number;
    repairCount: number;
    completedWithCross: boolean;
    caseId?: string;
    caseFamily?: string;
    caseConfidence?: "exact" | "family" | "unknown";
    caseReason?: string;
  }>;
  stepReview?: {
    pauseThreshold: number;
    averageGap: number;
    maxGap: number;
    pauses: Array<{ index: number; move: string; gap: number; stage: string; reason: string }>;
  };
  /** 逐 case 证据：实际动作、起手停顿及保存成绩时所选解法的参照。 */
  caseEvents?: CaseEvent[];
  /** 会话级上下文：最近几把的瓶颈摘要，用于趋势判断 */
  sessionContext?: Array<{
    completedAt: number;
    totalDuration: number;
    bottleneckStage: string;
    topIssue: string;
  }>;
  /** 公式库练习掌握度摘要（练习次数/成功率/平均识别与执行），供 AI 给出有练习证据的建议 */
  practiceSummary?: Array<{
    formulaId: string;
    name: string;
    category: "F2L" | "OLL" | "PLL";
    attempts: number;
    successes: number;
    successRate: number;
    averageDuration: number | null;
    averageRecognitionDuration: number | null;
    averageExecutionDuration: number | null;
  }>;
  /** 历史公式指派的效果回流：每个已指派公式自上次指派以来的练习表现 */
  assignmentProgress?: AssignmentProgressEntry[];
  /** 纵向训练档案（跨天公式练习时间线）；前端同步后注入，后端只读渲染 */
  trainingProfile?: TrainingProfileEntry[];
}

export interface AnalysisIssue {
  stage: "Cross" | "F2L" | "OLL" | "PLL" | "General";
  severity: "high" | "medium" | "low";
  description: string;
  evidence: string;
  /** 必须对应本次确定性证据目录；模型不能自行指定回放步数。 */
  evidenceId?: string;
}

export type AnalysisStage = "Cross" | "F2L" | "OLL" | "PLL";

export interface AnalysisSolve extends Pick<AnalysisInput,
  "totalDuration" | "crossDuration" | "f2lDuration" | "ollDuration" | "pllDuration"
  | "crossMoves" | "f2lMoves" | "ollMoves" | "pllMoves" | "scramble" | "moves"
  | "moveCount" | "tps" | "f2lSlots" | "stepReview" | "caseEvents" | "moveGaps"> {}

export interface StageBaseline {
  stage: AnalysisStage;
  sampleCount: number;
  duration: number;
}

export interface CaseBaseline {
  stage: CaseEvent["stage"];
  caseId: string;
  sampleCount: number;
  recognitionPauseMs: number;
  execMoves: number;
}

export interface AnalysisBaseline {
  sampleCount: number;
  stages: StageBaseline[];
  cases: CaseBaseline[];
}

export interface CaseTransferMetrics {
  caseHits: number;
  averageRecognitionPauseMs: number | null;
  averageMoveDelta: number | null;
}

export interface CaseTransferProgress {
  formulaId: string;
  stage: CaseEvent["stage"];
  normalSolveCount: number;
  targetSolveCount: number;
  before: CaseTransferMetrics;
  after: CaseTransferMetrics;
  readyForComparison: boolean;
}

export interface CaseAlgorithmReference {
  name: string;
  moves: string[];
}

/** 单次解法中命中的一个训练 case 的执行证据。 */
export interface CaseEvent {
  stage: "F2L" | "OLL" | "PLL";
  /** 公式库公式 id（如 F2L-24 / OLL-05 / PLL-T） */
  caseId: string;
  /** 该 case 首个 move 前的动作间隔，不能单凭间隔确定停顿原因（毫秒）。 */
  recognitionPauseMs: number;
  /** 实际执行步数 */
  execMoves: number;
  /** 所选解法的参照步数，不代表最短解或实际采用的手法。 */
  expectedMoves: number;
  /** 实际步数 - 参照步数 */
  moveDelta: number;
  /** 保存时的解法快照；之后修改公式不能改写这把成绩的参照。 */
  referenceAlgorithm?: CaseAlgorithmReference;
  /** 原始动作流的零基半开区间；起点局面在 startMoveIndex 步执行后。 */
  startMoveIndex?: number;
  endMoveIndex?: number;
}

/** 一次公式级指派自上次指派以来的练习效果（训练闭环的回流输入单元）。 */
export interface AssignmentProgressEntry {
  formulaId: string;
  stage: "F2L" | "OLL" | "PLL";
  /** 最近一次指派时间（毫秒时间戳） */
  lastAssignedAt: number;
  /** 自上次指派以来的练习次数 */
  practiceAttempts: number;
  /** 自上次指派以来的练习成功率；期间无练习记录为 null */
  practiceSuccessRate: number | null;
}

export interface AnalysisDrill {
  title: string;
  detail: string;
  reps: string;
}

export interface AnalysisResult {
  bottleneck: string;
  trainingAdvice: string;
  encouragement: string;
  rawResponse?: string;
  /** 分析来源：ai = DeepSeek 生成，fallback = 本地规则引擎 */
  source?: "ai" | "fallback";
  /** 结构化瓶颈阶段，避免从自由文本中反向解析 */
  bottleneckStage?: "Cross" | "F2L" | "OLL" | "PLL" | "";
  /** 结构化问题列表（按严重程度排序） */
  issues?: AnalysisIssue[];
  /** 推荐训练动作 */
  drills?: AnalysisDrill[];
  /** 下一把的核心聚焦点（一句话） */
  nextFocus?: string;
  /** 会话趋势判断（一句话，如「F2L 连续 3 把为瓶颈，BR 槽位持续偏慢」） */
  trend?: string;
  /** 结构化公式指派：复盘结论直接映射到公式库具体公式，打通「复盘 → 练习」闭环 */
  focusFormulas?: Array<{
    stage: "F2L" | "OLL" | "PLL";
    /** 公式库公式 id（如 F2L-24）；缺失时表示阶段级指派 */
    formulaId?: string;
    /** 一句话指派理由（引用练习数据或本把数据） */
    reason: string;
    /** 上次指派时间（毫秒时间戳）；仅当该公式此前被指派过，由客户端回流填充 */
    lastAssignedAt?: number;
    /** 上次指派后的练习成功率；期间无练习记录为 undefined */
    practiceSuccessRate?: number;
  }>;
}
