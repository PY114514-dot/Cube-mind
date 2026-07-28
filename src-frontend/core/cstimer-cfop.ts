/**
 * CSTimer CFOP progress algorithm, adapted from cstimer/src/js/lib/cubeutil.js.
 *
 * Copyright (C) cs0x7f and CSTimer contributors.
 * The upstream project is licensed under GPL-3.0; see cstimer/LICENSE.
 * This module keeps only the facelet masks and six-axis progress calculation.
 */

import type { CubieCube } from "../utils/mathlib.ts";

export type CfopPhase = "scramble" | "cross" | "f2l" | "oll" | "solved";

const ROTATIONS: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53],
  [42, 39, 36, 43, 40, 37, 44, 41, 38, 6, 3, 0, 7, 4, 1, 8, 5, 2, 24, 21, 18, 25, 22, 19, 26, 23, 20, 15, 12, 9, 16, 13, 10, 17, 14, 11, 33, 30, 27, 34, 31, 28, 35, 32, 29, 47, 50, 53, 46, 49, 52, 45, 48, 51],
  [24, 21, 18, 25, 22, 19, 26, 23, 20, 8, 7, 6, 5, 4, 3, 2, 1, 0, 15, 12, 9, 16, 13, 10, 17, 14, 11, 51, 48, 45, 52, 49, 46, 53, 50, 47, 27, 28, 29, 30, 31, 32, 33, 34, 35, 38, 41, 44, 37, 40, 43, 36, 39, 42],
  [33, 30, 27, 34, 31, 28, 35, 32, 29, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 2, 5, 8, 1, 4, 7, 0, 3, 6, 53, 52, 51, 50, 49, 48, 47, 46, 45, 44, 43, 42, 41, 40, 39, 38, 37, 36],
  [17, 16, 15, 14, 13, 12, 11, 10, 9, 20, 23, 26, 19, 22, 25, 18, 21, 24, 2, 5, 8, 1, 4, 7, 0, 3, 6, 36, 37, 38, 39, 40, 41, 42, 43, 44, 51, 48, 45, 52, 49, 46, 53, 50, 47, 29, 32, 35, 28, 31, 34, 27, 30, 33],
  [53, 52, 51, 50, 49, 48, 47, 46, 45, 11, 14, 17, 10, 13, 16, 9, 12, 15, 0, 1, 2, 3, 4, 5, 6, 7, 8, 18, 19, 20, 21, 22, 23, 24, 25, 26, 42, 39, 36, 43, 40, 37, 44, 41, 38, 35, 34, 33, 32, 31, 30, 29, 28, 27],
];

const CROSS_MASK = "----U--------R--R-----F--F--D-DDD-D-----L--L-----B--B-";
const F2L_MASK = "----U-------RRRRRR---FFFFFFDDDDDDDDD---LLLLLL---BBBBBB";
const OLL_MASK = "UUUUUUUUU---RRRRRR---FFFFFFDDDDDDDDD---LLLLLL---BBBBBB";
const SOLVED_MASK = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";

function toEquivalences(mask: string): number[][] {
  const groups = new Map<string, number[]>();
  for (let index = 0; index < mask.length; index++) {
    const color = mask[index];
    if (color === "-") continue;
    const group = groups.get(color) ?? [];
    group.push(index);
    groups.set(color, group);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

const MASKS = {
  cross: toEquivalences(CROSS_MASK),
  f2l: toEquivalences(F2L_MASK),
  oll: toEquivalences(OLL_MASK),
  solved: toEquivalences(SOLVED_MASK),
};

function solvedProgress(facelets: string, mask: number[][], rotation: number[]): boolean {
  return mask.every((group) => {
    const color = facelets[rotation[group[0]]];
    return group.slice(1).every((index) => facelets[rotation[index]] === color);
  });
}

function solvedOnAnyAxis(facelets: string, mask: number[][]): boolean {
  return ROTATIONS.some((rotation) => solvedProgress(facelets, mask, rotation));
}

export function getCfopPhase(facelets: string): CfopPhase {
  if (solvedOnAnyAxis(facelets, MASKS.solved)) return "solved";
  if (solvedOnAnyAxis(facelets, MASKS.oll)) return "oll";
  if (solvedOnAnyAxis(facelets, MASKS.f2l)) return "f2l";
  if (solvedOnAnyAxis(facelets, MASKS.cross)) return "cross";
  return "scramble";
}

export function getCfopPhaseFromCube(cube: CubieCube): CfopPhase {
  return getCfopPhase(cube.toFaceCube());
}
