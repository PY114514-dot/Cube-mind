/**
 * 校验一把成绩是否真的从当前打乱还原到标准状态。
 * 这里把校验放在核心层，避免 UI 的 3D 状态成为唯一事实来源。
 */

import { CubieCube, parseMove, SOLVED_FACELET } from "../utils/mathlib.ts";

export const SolveStatus = {
  Valid: "valid",
  Incomplete: "incomplete",
  Invalid: "invalid",
} as const;

export type SolveStatus = typeof SolveStatus[keyof typeof SolveStatus];
export type SolveAnomaly = "empty-solution" | "invalid-move" | "not-solved" | "duplicate-event" | "out-of-order-event" | "missing-event";

export interface MoveEventForValidation {
  move: string;
  moveCnt?: number;
  timestamp?: number;
}

export interface SolveValidation {
  status: SolveStatus;
  isSolved: boolean;
  anomalies: SolveAnomaly[];
  finalFacelets: string;
}

/** Move 流可被可靠回放；阶段专项允许未完整复原，但不接受丢步、重复或乱序。 */
export function isMoveStreamReliable(validation: SolveValidation): boolean {
  return !validation.anomalies.some((anomaly) =>
    anomaly === "invalid-move" || anomaly === "duplicate-event" || anomaly === "out-of-order-event" || anomaly === "missing-event"
  );
}

function applyMoves(cube: CubieCube, moves: string[]): CubieCube {
  let state = cube;
  for (const move of moves) state = state.applyMove(parseMove(move));
  return state;
}

function findEventAnomalies(events: MoveEventForValidation[]): SolveAnomaly[] {
  const anomalies: SolveAnomaly[] = [];
  const seen = new Set<number>();
  let previousTimestamp: number | undefined;
  let previousMoveCnt: number | undefined;
  for (const event of events) {
    if (event.moveCnt !== undefined) {
      if (seen.has(event.moveCnt)) anomalies.push("duplicate-event");
      if (previousMoveCnt !== undefined && ((event.moveCnt - previousMoveCnt + 256) & 0xff) !== 1) {
        anomalies.push("missing-event");
      }
      seen.add(event.moveCnt);
      previousMoveCnt = event.moveCnt;
    }
    if (event.timestamp !== undefined && previousTimestamp !== undefined && event.timestamp < previousTimestamp) {
      anomalies.push("out-of-order-event");
    }
    previousTimestamp = event.timestamp;
  }
  return anomalies;
}

export function validateSolve(
  scrambleMoves: string[],
  solutionEvents: MoveEventForValidation[],
): SolveValidation {
  const anomalies = findEventAnomalies(solutionEvents);
  if (solutionEvents.length === 0) anomalies.push("empty-solution");

  let finalFacelets = SOLVED_FACELET;
  try {
    const scrambled = applyMoves(CubieCube.SOLVED, scrambleMoves);
    finalFacelets = applyMoves(scrambled, solutionEvents.map((event) => event.move)).toFaceCube();
  } catch (error) {
    console.error("[solve-validation] 无法回放解法动作:", error);
    anomalies.push("invalid-move");
  }

  const isSolved = finalFacelets === SOLVED_FACELET;
  if (!isSolved && !anomalies.includes("invalid-move")) anomalies.push("not-solved");
  const streamAnomaly = anomalies.some((anomaly) =>
    anomaly === "invalid-move" || anomaly === "duplicate-event" || anomaly === "out-of-order-event" || anomaly === "missing-event"
  );
  const status: SolveStatus = anomalies.length === 0
    ? SolveStatus.Valid
    : streamAnomaly
      ? SolveStatus.Invalid
      : SolveStatus.Incomplete;

  return { status, isSolved, anomalies: [...new Set(anomalies)], finalFacelets };
}

export function isSolveEligible(status: SolveStatus | undefined): boolean {
  return status === undefined || status === SolveStatus.Valid;
}
