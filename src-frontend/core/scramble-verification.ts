import { CubieCube, parseMove } from "../utils/mathlib.ts";

/** 比较目标打乱和设备实际执行的动作是否到达同一状态。 */
export function isScrambleStateVerified(expectedMoves: string[], performedMoves: string[]): boolean {
  try {
    const expected = CubieCube.SOLVED.applyMoves(expectedMoves.map(parseMove)).toFaceCube();
    const performed = CubieCube.SOLVED.applyMoves(performedMoves.map(parseMove)).toFaceCube();
    return expected === performed;
  } catch (error) {
    console.error("[scramble-verification] 无法验证打乱状态:", error);
    return false;
  }
}
