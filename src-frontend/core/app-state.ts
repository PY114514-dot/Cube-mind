import type { CubeMove } from "../ble/cube-driver.ts";
import type { AnalysisInput } from "../agent/types.ts";
import type { Formula } from "../formula/types.ts";
import type { InspectionPenalty } from "./inspection-rules.ts";
import { createScrambleProgress, type ScrambleProgress } from "./scramble-tracker.ts";
import type { SolveReviewSession } from "./solve-review-session.ts";

// ====== 公式练习子类型 ======

export type FormulaPracticeOrder = "random" | "sequential";

export interface FormulaPracticeSession {
  formula: Formula;
  candidates: Formula[];
  order: FormulaPracticeOrder;
  target: number;
  completed: number;
  startedAt: number;
}

// ====== 分域状态 ======

/** 打乱生成、执行与验证 */
export interface ScrambleState {
  currentScramble: string;
  selectedCrossSteps: number | null;
  showFullScramble: boolean;
  activeCrossScrambleWorker: Worker | null;
  generationId: number;
  isGenerationPending: boolean;
  progress: ScrambleProgress;
  performedMoves: string[];
  /** 本轮执行打乱前的已追踪局面，供过渡打乱的绝对回放起点使用。 */
  startingMoves: string[];
  stateVerified: boolean;
  wrongMoveCount: number;
}

/** 计时与成绩录制 */
export interface SolveState {
  events: CubeMove[];
  hasPermanentMoveGap: boolean;
  isFinalizing: boolean;
  lastDeviceMoveCnt: number | undefined;
  inspectionPenalty: InspectionPenalty;
  inspectionDuration: number;
}

/** 练习模式（块练习 + 公式练习 + 过渡状态） */
export interface PracticeState {
  blockMode: "cross" | "f2l" | "cross-f2l" | null;
  blockCompleted: boolean;
  pendingFormula: Formula | null;
  pendingCandidates: Formula[];
  pendingOrder: FormulaPracticeOrder;
  session: FormulaPracticeSession | null;
  needsRetry: boolean;
  caseVerified: boolean;
  awaitingNextScramble: boolean;
  postSolveMoves: string[];
}

/** BLE 诊断录制 */
export interface DiagnosticsState {
  isBleRecording: boolean;
}

// ====== 聚合 ======

export interface AppState {
  scramble: ScrambleState;
  solve: SolveState;
  practice: PracticeState;
  review: SolveReviewSession | null;
  diagnostics: DiagnosticsState;
  recentSolves: AnalysisInput[];
}

/** 创建初始状态；recentSolves 从 HistoryStore 注入。 */
export function createInitialState(recentSolves: AnalysisInput[]): AppState {
  return {
    scramble: {
      currentScramble: "",
      selectedCrossSteps: null,
      // 默认展示完整打乱并在原位灰化已完成步数（学 csTimer 的进度感），
      // 用户可经「仅看剩余」按钮切回紧凑视图。
      showFullScramble: true,
      activeCrossScrambleWorker: null,
      generationId: 0,
      isGenerationPending: false,
      progress: createScrambleProgress(""),
      performedMoves: [],
      startingMoves: [],
      stateVerified: false,
      wrongMoveCount: 0,
    },
    solve: {
      events: [],
      hasPermanentMoveGap: false,
      isFinalizing: false,
      lastDeviceMoveCnt: undefined,
      inspectionPenalty: "none",
      inspectionDuration: 0,
    },
    practice: {
      blockMode: null,
      blockCompleted: false,
      pendingFormula: null,
      pendingCandidates: [],
      pendingOrder: "random",
      session: null,
      needsRetry: false,
      caseVerified: false,
      awaitingNextScramble: false,
      postSolveMoves: [],
    },
    diagnostics: {
      isBleRecording: false,
    },
    review: null,
    recentSolves,
  };
}
