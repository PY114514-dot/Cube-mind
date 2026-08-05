export interface AnalysisInput {
  analysisScope?: number;
  completedAt?: number;
  deviceName?: string;
  deviceId?: string;
  groupId?: string;
  practiceMode?: "cross" | "f2l" | "cross-f2l";
  practiceKind?: "formula" | "cross" | "f2l" | "cross-f2l";
  practiceFormulaId?: string;
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
  recentSolves?: Array<{
    totalDuration: number;
    crossDuration: number;
    f2lDuration: number;
    ollDuration: number;
    pllDuration: number;
  }>;
  qualityStatus?: "valid" | "incomplete" | "invalid";
  qualityAnomalies?: string[];
  /** 实体魔方状态回读结果；用于判定成绩能否进入 PB/AO。 */
  physicalState?: "confirmed-solved" | "confirmed-unsolved" | "unavailable";
  /** 动作流是否足以支持 CFOP、停顿和 Agent 分析。 */
  analysisEligible?: boolean;
  penalty?: "none" | "plus2" | "dnf";
  moveGaps?: number[];
  f2lSlots?: Array<{
    slot: "FR" | "FL" | "BL" | "BR";
    completionOrder?: number;
    duration?: number;
    moves?: number;
    pauseCount: number;
    maxGap: number;
    breakCount: number;
    repairCount: number;
    completedWithCross: boolean;
  }>;
  stepReview?: {
    pauseThreshold: number;
    averageGap: number;
    maxGap: number;
    pauses: Array<{ index: number; move: string; gap: number; stage: string; reason: string }>;
  };
  recentStepReviews?: Array<{
    pauses: Array<{ move: string; gap: number; stage: string }>;
    maxGap: number;
  }>;
  /** 会话级上下文：最近几把的瓶颈摘要，用于趋势判断 */
  sessionContext?: Array<{
    completedAt: number;
    totalDuration: number;
    bottleneckStage: string;
    topIssue: string;
  }>;
}

export interface AnalysisIssue {
  stage: "Cross" | "F2L" | "OLL" | "PLL" | "General";
  severity: "high" | "medium" | "low";
  description: string;
  evidence: string;
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
}
