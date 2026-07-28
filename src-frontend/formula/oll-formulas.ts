/**
 * formula/oll-formulas.ts
 * CFOP OLL 全量 57 case 训练库。
 *
 * 口径对齐 ALGDB / SpeedCubeDB 常见 CFOP 分类：F2L 41 + OLL 57 + PLL 21 = 119。
 */

import type { Formula } from "./types.ts";

interface OllSeed {
  id: number;
  name: string;
  moves: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  tags: string[];
}

const OLL_SEEDS: OllSeed[] = [
  { id: 1, name: "Dot", moves: "R U2 R2 F R F' U2 R' F R F'", difficulty: 5, tags: ["full-oll", "dot"] },
  { id: 2, name: "Dot mirror", moves: "F R U R' U' F' f R U R' U' f'", difficulty: 5, tags: ["full-oll", "dot"] },
  { id: 3, name: "Dot slash", moves: "f R U R' U' f' U' F R U R' U' F'", difficulty: 5, tags: ["full-oll", "dot"] },
  { id: 4, name: "Dot backslash", moves: "f R U R' U' f' U F R U R' U' F'", difficulty: 5, tags: ["full-oll", "dot"] },
  { id: 5, name: "Square", moves: "r' U2 R U R' U r", difficulty: 3, tags: ["full-oll", "square"] },
  { id: 6, name: "Square mirror", moves: "r U2 R' U' R U' r'", difficulty: 3, tags: ["full-oll", "square"] },
  { id: 7, name: "Small lightning", moves: "r U R' U R U2 r'", difficulty: 2, tags: ["full-oll", "lightning"] },
  { id: 8, name: "Small lightning mirror", moves: "r' U' R U' R' U2 r", difficulty: 2, tags: ["full-oll", "lightning"] },
  { id: 9, name: "Fish", moves: "R U R' U' R' F R2 U R' U' F'", difficulty: 3, tags: ["full-oll", "fish"] },
  { id: 10, name: "Fish mirror", moves: "R U R' U R' F R F' R U2 R'", difficulty: 3, tags: ["full-oll", "fish"] },
  { id: 11, name: "Small lightning side", moves: "r U R' U R' F R F' R U2 r'", difficulty: 4, tags: ["full-oll", "lightning"] },
  { id: 12, name: "Small lightning side mirror", moves: "F R U R' U' F' U F R U R' U' F'", difficulty: 4, tags: ["full-oll", "lightning"] },
  { id: 13, name: "Knight move", moves: "F U R U' R2 F' R U R U' R'", difficulty: 4, tags: ["full-oll", "knight"] },
  { id: 14, name: "Knight move mirror", moves: "R' F R U R' F' R F U' F'", difficulty: 4, tags: ["full-oll", "knight"] },
  { id: 15, name: "Knight move inverse", moves: "l' U' l L' U' L U l' U l", difficulty: 4, tags: ["full-oll", "knight"] },
  { id: 16, name: "Knight move inverse mirror", moves: "r U r' R U R' U' r U' r'", difficulty: 4, tags: ["full-oll", "knight"] },
  { id: 17, name: "Dot easy", moves: "F R' F' R2 r' U R U' R' U' M'", difficulty: 5, tags: ["full-oll", "dot"] },
  { id: 18, name: "Dot bar", moves: "r U R' U R U2 r2 U' R U' R' U2 r", difficulty: 5, tags: ["full-oll", "dot"] },
  { id: 19, name: "Dot bar mirror", moves: "r' R U R U R' U' M' R' F R F'", difficulty: 5, tags: ["full-oll", "dot"] },
  { id: 20, name: "No edges", moves: "r U R' U' M2 U R U' R' U' M'", difficulty: 5, tags: ["full-oll", "dot"] },
  { id: 21, name: "H", moves: "R U R' U R U' R' U R U2 R'", difficulty: 2, tags: ["full-oll", "2-look", "corner-only", "h-shape"] },
  { id: 22, name: "Pi", moves: "R U2 R2 U' R2 U' R2 U2 R", difficulty: 3, tags: ["full-oll", "2-look", "corner-only", "pi-shape"] },
  { id: 23, name: "Headlights", moves: "R2 D R' U2 R D' R' U2 R'", difficulty: 4, tags: ["full-oll", "2-look", "corner-only", "headlights"] },
  { id: 24, name: "T", moves: "r U R' U' r' F R F'", difficulty: 3, tags: ["full-oll", "2-look", "corner-only", "t-shape"] },
  { id: 25, name: "Bowtie", moves: "F' r U R' U' r' F R", difficulty: 3, tags: ["full-oll", "2-look", "corner-only", "bowtie"] },
  { id: 26, name: "Anti-Sune", moves: "R U2 R' U' R U' R'", difficulty: 1, tags: ["full-oll", "2-look", "corner-only", "anti-sune"] },
  { id: 27, name: "Sune", moves: "R U R' U R U2 R'", difficulty: 1, tags: ["full-oll", "2-look", "corner-only", "sune"] },
  { id: 28, name: "Corners solved", moves: "r U R' U' M U R U' R'", difficulty: 4, tags: ["full-oll", "cross-only", "corners-solved"] },
  { id: 29, name: "Awkward shape", moves: "R U R' U' R U' R' F' U' F R U R'", difficulty: 4, tags: ["full-oll", "awkward"] },
  { id: 30, name: "Awkward mirror", moves: "F R' F R2 U' R' U' R U R' F2", difficulty: 4, tags: ["full-oll", "awkward"] },
  { id: 31, name: "P shape", moves: "R' U' F U R U' R' F' R", difficulty: 3, tags: ["full-oll", "p-shape"] },
  { id: 32, name: "P shape mirror", moves: "R U B' U' R' U R B R'", difficulty: 3, tags: ["full-oll", "p-shape"] },
  { id: 33, name: "T shape", moves: "R U R' U' R' F R F'", difficulty: 2, tags: ["full-oll", "t-shape"] },
  { id: 34, name: "C shape", moves: "R U R2 U' R' F R U R U' F'", difficulty: 3, tags: ["full-oll", "c-shape"] },
  { id: 35, name: "Fish shape", moves: "R U2 R2 F R F' R U2 R'", difficulty: 4, tags: ["full-oll", "fish"] },
  { id: 36, name: "W shape", moves: "L' U' L U' L' U L U L F' L' F", difficulty: 4, tags: ["full-oll", "w-shape"] },
  { id: 37, name: "Mountains", moves: "F R U' R' U' R U R' F'", difficulty: 3, tags: ["full-oll", "mountains"] },
  { id: 38, name: "W shape mirror", moves: "R U R' U R U' R' U' R' F R F'", difficulty: 4, tags: ["full-oll", "w-shape"] },
  { id: 39, name: "Big lightning", moves: "L F' L' U' L U F U' L'", difficulty: 4, tags: ["full-oll", "lightning"] },
  { id: 40, name: "Big lightning mirror", moves: "R' F R U R' U' F' U R", difficulty: 4, tags: ["full-oll", "lightning"] },
  { id: 41, name: "Awkward line", moves: "R U R' U R U2 R' F R U R' U' F'", difficulty: 4, tags: ["full-oll", "line"] },
  { id: 42, name: "Awkward line mirror", moves: "R' U' R U' R' U2 R F R U R' U' F'", difficulty: 4, tags: ["full-oll", "line"] },
  { id: 43, name: "P shape easy", moves: "F' U' L' U L F", difficulty: 2, tags: ["full-oll", "p-shape"] },
  { id: 44, name: "P shape easy mirror", moves: "F U R U' R' F'", difficulty: 2, tags: ["full-oll", "p-shape"] },
  { id: 45, name: "Line", moves: "F R U R' U' F'", difficulty: 1, tags: ["full-oll", "2-look", "line", "cross"] },
  { id: 46, name: "C shape easy", moves: "R' U' R' F R F' U R", difficulty: 3, tags: ["full-oll", "c-shape"] },
  { id: 47, name: "Small L", moves: "F' L' U' L U L' U' L U F", difficulty: 4, tags: ["full-oll", "l-shape"] },
  { id: 48, name: "Small L mirror", moves: "F R U R' U' R U R' U' F'", difficulty: 4, tags: ["full-oll", "l-shape"] },
  { id: 49, name: "L shape", moves: "r U' r2 U r2 U r2 U' r", difficulty: 4, tags: ["full-oll", "l-shape"] },
  { id: 50, name: "L shape mirror", moves: "r' U r2 U' r2 U' r2 U r'", difficulty: 4, tags: ["full-oll", "l-shape"] },
  { id: 51, name: "Line with block", moves: "F U R U' R' U R U' R' F'", difficulty: 4, tags: ["full-oll", "line"] },
  { id: 52, name: "Bowtie", moves: "R U R' U R U' B U' B' R'", difficulty: 3, tags: ["full-oll", "bowtie"] },
  { id: 53, name: "Frying pan", moves: "r' U' R U' R' U R U' R' U2 r", difficulty: 5, tags: ["full-oll", "frying-pan"] },
  { id: 54, name: "Frying pan mirror", moves: "r U R' U R U' R' U R U2 r'", difficulty: 5, tags: ["full-oll", "frying-pan"] },
  { id: 55, name: "Highway", moves: "R U2 R2 U' R U' R' U2 F R F'", difficulty: 4, tags: ["full-oll", "line"] },
  { id: 56, name: "Highway mirror", moves: "r U r' U R U' R' U R U' R' r U' r'", difficulty: 5, tags: ["full-oll", "line"] },
  { id: 57, name: "Cross", moves: "R U R' U' M' U R U' r'", difficulty: 3, tags: ["full-oll", "2-look", "cross-only", "corners-only"] },
];

function moves(alg: string): string[] {
  return alg.split(" ");
}

function caseImage(seed: OllSeed): string {
  return `${seed.id.toString().padStart(2, "0")}\nOLL case\n${seed.tags[1] ?? seed.tags[0]}`;
}

export const OLL_FORMULAS: Formula[] = OLL_SEEDS.map((seed) => ({
  id: `OLL-${seed.id.toString().padStart(2, "0")}`,
  category: "OLL",
  name: `OLL #${seed.id}: ${seed.name}`,
  caseImage: caseImage(seed),
  moves: moves(seed.moves),
  recognition: `识别 OLL #${seed.id}：先看顶面黄块形状，再用侧面黄贴纸确认方向。该 case 属于 ${seed.tags.join(" / ")}。`,
  execution: `按 ${seed.moves} 执行。练习时先固定 AUF 方向，确认起手面，再逐步压到一口气完成整条 OLL。`,
  difficulty: seed.difficulty,
  tags: seed.tags,
  source: "ALGDB / SpeedCubeDB CFOP OLL 57 case",
}));

/** 2-look OLL 推荐集合：十字成形 + 角块朝向高频 case */
export const OLL_2LOOK: Formula[] = OLL_FORMULAS.filter((formula) => formula.tags.includes("2-look"));

export function getOll2Look(): Formula[] {
  return OLL_2LOOK;
}

export function getOllFull(): Formula[] {
  return OLL_FORMULAS;
}
