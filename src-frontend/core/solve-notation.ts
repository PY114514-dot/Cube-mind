import { CubieCube, parseMove } from "../utils/mathlib.ts";
import { isCrossSolved } from "./cross-solver.ts";
import type { F2lSlotReview } from "./f2l-slot-tracker.ts";

const WHITE_BOTTOM_MOVE_MAP: Record<string, string> = {
  U: "D", D: "U", R: "R", L: "L", F: "B", B: "F",
};
const WHITE_BOTTOM_SLOT_MAP: Record<F2lSlotReview["slot"], F2lSlotReview["slot"]> = {
  FR: "BR", FL: "BL", BL: "FL", BR: "FR",
};

/** 以 x2 将白顶设备记谱转为白底展示；数学局面与原始记录保持不变。 */
export function formatMovesForWhiteBottom(moves: string[], targetFace: "U" | "D"): string[] {
  if (targetFace === "D") return [...moves];
  return moves.map((move) => `${WHITE_BOTTOM_MOVE_MAP[move[0]?.toUpperCase()] ?? move[0]}${move.slice(1)}`);
}

/** 槽位与动作使用同一观察坐标。 */
export function formatF2lSlotForWhiteBottom(slot: F2lSlotReview["slot"], targetFace: "U" | "D"): F2lSlotReview["slot"] {
  return targetFace === "U" ? WHITE_BOTTOM_SLOT_MAP[slot] : slot;
}

/** 与逐槽位追踪共用底层判定，不能根据动作中 D/B 的数量猜持握。 */
export function getCrossTarget(cube: CubieCube): "U" | "D" | null {
  if (isCrossSolved(cube, "U")) return "U";
  if (isCrossSolved(cube, "D")) return "D";
  return null;
}

/** 从实际打乱和解法确认底层，使成绩与历史使用同一记谱方向。 */
export function getSolveTargetFace(scramble: string | undefined, moves: string[] | undefined): "U" | "D" | null {
  if (!scramble || !moves?.length) return null;
  try {
    let cube = CubieCube.SOLVED;
    for (const move of scramble.trim().split(/\s+/)) cube = cube.applyMove(parseMove(move));
    let target = getCrossTarget(cube);
    for (const move of moves) {
      if (target) break;
      cube = cube.applyMove(parseMove(move));
      target = getCrossTarget(cube);
    }
    return target;
  } catch (error) {
    console.error("[solve-notation] 无法确认底层:", error);
    return null;
  }
}
