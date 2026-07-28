import type { Formula } from "./types.ts";
import { getCfopPhase } from "../core/cstimer-cfop.ts";
import { invertAlgorithm } from "./cube-case-diagram.ts";
import { CubieCube, parseMove } from "../utils/mathlib.ts";

const SIDE_FACES = ["F", "R", "L", "B"] as const;
const SOLVED = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";

export function isFormulaDevicePracticeSafe(formula: Formula): boolean {
  if (!formula.moves.every((move) => /^[URFDLB][2']?$/.test(move))) return false;
  const setupMoves = getFormulaSetupMoves(formula);
  if (!setupMoves.every((move) => /^[URFDLB][2']?$/.test(move))) return false;
  const setupState = toFacelets(setupMoves);
  const finalState = toFacelets([...setupMoves, ...formula.moves]);
  if (formula.category === "F2L") {
    // 仅十字完成才是可计时的 F2L 起点；F2L 已完成的 setup 会让首个动作被误记为完成。
    return isCrossSolved(setupState) && getCfopPhase(setupState) === "cross" && isF2lSolved(finalState);
  }
  if (formula.category === "OLL") return isF2lSolved(setupState);
  return isF2lSolved(setupState) && isOllSolved(setupState) && finalState === SOLVED;
}

export function getFormulaSetupMoves(formula: Formula): string[] {
  return formula.setupMoves ?? invertAlgorithm(formula.moves);
}

function toFacelets(moves: string[]): string {
  let cube = CubieCube.SOLVED;
  for (const move of moves) cube = cube.applyMove(parseMove(move));
  return cube.toFaceCube();
}

function getFace(facelets: string, face: typeof SIDE_FACES[number] | "U" | "D"): string {
  const index = "URFDLB".indexOf(face);
  return facelets.slice(index * 9, index * 9 + 9);
}

function isDLayerSolved(facelets: string): boolean {
  return getFace(facelets, "D").split("").every((sticker) => sticker === "D")
    && SIDE_FACES.every((face) => getFace(facelets, face).slice(6, 9).split("").every((sticker) => sticker === face));
}

function isCrossSolved(facelets: string): boolean {
  const down = getFace(facelets, "D");
  return [1, 3, 5, 7].every((index) => down[index] === "D")
    && SIDE_FACES.every((face) => getFace(facelets, face)[7] === face);
}

function isF2lSolved(facelets: string): boolean {
  return isDLayerSolved(facelets)
    && SIDE_FACES.every((face) => getFace(facelets, face).slice(3, 9).split("").every((sticker) => sticker === face));
}

function isOllSolved(facelets: string): boolean {
  return getFace(facelets, "U").split("").every((sticker) => sticker === "U");
}
