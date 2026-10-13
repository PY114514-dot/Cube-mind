import { CubieCube, parseMove } from "../utils/mathlib.ts";
import { isCrossSolved } from "./cross-solver.ts";
import { isF2lComplete } from "./last-layer-recognizer.ts";
import type { F2lSlotReview } from "./f2l-slot-tracker.ts";

const WHITE_BOTTOM_MOVE_MAP: Record<string, string> = {
  U: "D", D: "U", R: "R", L: "L", F: "B", B: "F",
};
const WHITE_BOTTOM_SLOT_MAP: Record<F2lSlotReview["slot"], F2lSlotReview["slot"]> = {
  FR: "BR", FL: "BL", BL: "FL", BR: "FR",
};
const X2_ROTATION = new CubieCube();
X2_ROTATION.ca = [7, 6, 5, 4, 3, 2, 1, 0];
X2_ROTATION.ea = [8, 14, 12, 10, 0, 6, 4, 2, 22, 20, 18, 16];

/** 将底层统一到 D 面供 CASE 签名比对；不改变输入局面。 */
export function normalizeCubeForD(cube: CubieCube, targetFace: "U" | "D"): CubieCube {
  if (targetFace === "D") return cube;
  const intermediate = new CubieCube();
  const normalized = new CubieCube();
  // 与 csTimer 的坐标共轭一致，同时换算块的位置和身份；x2 是自身的逆。
  CubieCube.CubeMult(X2_ROTATION, cube, intermediate);
  CubieCube.CubeMult(intermediate, X2_ROTATION, normalized);
  return normalized;
}

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
  if (isCrossSolved(cube, "U")) {
    // OLL-23、A-perm 等上下十字同时完整，按已复原的前两层消除歧义。
    if (isF2lComplete(cube) && !isF2lComplete(normalizeCubeForD(cube, "U"))) return "D";
    return "U";
  }
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
