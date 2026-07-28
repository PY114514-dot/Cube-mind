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
}

export interface AnalysisResult {
  bottleneck: string;
  trainingAdvice: string;
  encouragement: string;
  rawResponse?: string;
}
