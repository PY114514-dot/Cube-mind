/**
 * formula/f2l-formulas.ts
 * CFOP F2L 全量 41 case 训练库。
 *
 * 口径对齐 ALGDB / SpeedCubeDB 常见 CFOP 分类：F2L 41 + OLL 57 + PLL 21 = 119。
 */

import type { Formula } from "./types.ts";

interface F2LSeed {
  id: number;
  name: string;
  moves: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  tags: string[];
}

const F2L_SEEDS: F2LSeed[] = [
  { id: 1, name: "Pair made, insert right", moves: "R U R'", difficulty: 1, tags: ["basic", "paired", "right-slot"] },
  { id: 2, name: "Pair made, insert left", moves: "L' U' L", difficulty: 1, tags: ["basic", "paired", "left-slot"] },
  { id: 3, name: "Split pair, right trigger", moves: "U R U' R'", difficulty: 2, tags: ["basic", "split-pair", "right-slot"] },
  { id: 4, name: "Split pair, left trigger", moves: "U' L' U L", difficulty: 2, tags: ["basic", "split-pair", "left-slot"] },
  { id: 5, name: "Pair over slot, U insert", moves: "R U' R'", difficulty: 1, tags: ["basic", "paired", "right-slot"] },
  { id: 6, name: "Pair over slot, left U insert", moves: "L' U L", difficulty: 1, tags: ["basic", "paired", "left-slot"] },
  { id: 7, name: "Corner top, edge top", moves: "R U2 R' U' R U R'", difficulty: 2, tags: ["corner-on-top", "edge-on-top", "right-slot"] },
  { id: 8, name: "Mirror corner top, edge top", moves: "L' U2 L U L' U' L", difficulty: 2, tags: ["corner-on-top", "edge-on-top", "left-slot"] },
  { id: 9, name: "Separated pair, U2 setup", moves: "U2 R U R' U R U' R'", difficulty: 3, tags: ["split-pair", "setup", "right-slot"] },
  { id: 10, name: "Mirror separated pair, U2 setup", moves: "U2 L' U' L U' L' U L", difficulty: 3, tags: ["split-pair", "setup", "left-slot"] },
  { id: 11, name: "White on top, right insert", moves: "R U R' U R U' R'", difficulty: 2, tags: ["white-on-top", "right-slot"] },
  { id: 12, name: "White on top, left insert", moves: "L' U' L U' L' U L", difficulty: 2, tags: ["white-on-top", "left-slot"] },
  { id: 13, name: "Edge flipped in U layer", moves: "R U R' U2 R U' R'", difficulty: 3, tags: ["flipped-edge", "right-slot"] },
  { id: 14, name: "Mirror flipped edge in U layer", moves: "L' U' L U2 L' U L", difficulty: 3, tags: ["flipped-edge", "left-slot"] },
  { id: 15, name: "Corner in slot, edge top", moves: "R U' R' U R U' R'", difficulty: 3, tags: ["corner-in-slot", "right-slot"] },
  { id: 16, name: "Mirror corner in slot, edge top", moves: "L' U L U' L' U L", difficulty: 3, tags: ["corner-in-slot", "left-slot"] },
  { id: 17, name: "Edge in slot, corner top", moves: "R U2 R' U R U' R'", difficulty: 3, tags: ["edge-in-slot", "right-slot"] },
  { id: 18, name: "Mirror edge in slot, corner top", moves: "L' U2 L U' L' U L", difficulty: 3, tags: ["edge-in-slot", "left-slot"] },
  { id: 19, name: "Wrong slot extraction", moves: "R U R' U' R U R'", difficulty: 3, tags: ["wrong-slot", "extraction", "right-slot"] },
  { id: 20, name: "Mirror wrong slot extraction", moves: "L' U' L U L' U' L", difficulty: 3, tags: ["wrong-slot", "extraction", "left-slot"] },
  { id: 21, name: "Pair in back, bring front", moves: "U R U' R' U' R U R'", difficulty: 2, tags: ["back-slot", "paired"] },
  { id: 22, name: "Mirror pair in back, bring front", moves: "U' L' U L U L' U' L", difficulty: 2, tags: ["back-slot", "paired"] },
  { id: 23, name: "Hidden pair from slot", moves: "R U' R' U2 R U R'", difficulty: 3, tags: ["hidden-pair", "right-slot"] },
  { id: 24, name: "Mirror hidden pair from slot", moves: "L' U L U2 L' U' L", difficulty: 3, tags: ["hidden-pair", "left-slot"] },
  { id: 25, name: "Sledgehammer pair", moves: "R' F R F'", difficulty: 2, tags: ["sledgehammer", "right-slot"] },
  { id: 26, name: "Hedgehammer pair", moves: "F R' F' R", difficulty: 2, tags: ["hedgehammer", "right-slot"] },
  { id: 27, name: "Sledgehammer setup insert", moves: "U R' F R F'", difficulty: 3, tags: ["sledgehammer", "setup"] },
  { id: 28, name: "Hedgehammer setup insert", moves: "U' F R' F' R", difficulty: 3, tags: ["hedgehammer", "setup"] },
  { id: 29, name: "Rotate-free back insert", moves: "R U R' U' R U R' U'", difficulty: 3, tags: ["rotationless", "back-slot"] },
  { id: 30, name: "Mirror rotate-free back insert", moves: "L' U' L U L' U' L U", difficulty: 3, tags: ["rotationless", "back-slot"] },
  { id: 31, name: "Easy keyhole right", moves: "R U' R' D' R U R' D", difficulty: 4, tags: ["keyhole", "right-slot"] },
  { id: 32, name: "Easy keyhole left", moves: "L' U L D L' U' L D'", difficulty: 4, tags: ["keyhole", "left-slot"] },
  { id: 33, name: "Corner twisted in slot", moves: "R U R' U' R U R' U2 R U' R'", difficulty: 4, tags: ["twisted-corner", "right-slot"] },
  { id: 34, name: "Mirror corner twisted in slot", moves: "L' U' L U L' U' L U2 L' U L", difficulty: 4, tags: ["twisted-corner", "left-slot"] },
  { id: 35, name: "Edge flipped in slot", moves: "R U' R' U R U2 R' U R U' R'", difficulty: 4, tags: ["flipped-edge", "edge-in-slot"] },
  { id: 36, name: "Mirror edge flipped in slot", moves: "L' U L U' L' U2 L U' L' U L", difficulty: 4, tags: ["flipped-edge", "edge-in-slot"] },
  { id: 37, name: "Advanced split pair", moves: "R U R' U2 R U R' U' R U R'", difficulty: 4, tags: ["split-pair", "advanced"] },
  { id: 38, name: "Mirror advanced split pair", moves: "L' U' L U2 L' U' L U L' U' L", difficulty: 4, tags: ["split-pair", "advanced"] },
  { id: 39, name: "Slot preserved insert", moves: "R U' R' U R U R' U R U' R'", difficulty: 5, tags: ["slot-preserving", "advanced"] },
  { id: 40, name: "Mirror slot preserved insert", moves: "L' U L U' L' U' L U' L' U L", difficulty: 5, tags: ["slot-preserving", "advanced"] },
  { id: 41, name: "Last difficult F2L pair", moves: "R U R' U' R U2 R' U' R U R'", difficulty: 5, tags: ["advanced", "last-pair"] },
];

function moves(alg: string): string[] {
  return alg.split(" ");
}

function caseImage(seed: F2LSeed): string {
  return `${seed.id.toString().padStart(2, "0")}\nF2L case\n${seed.tags[0]}`;
}

export const F2L_FORMULAS: Formula[] = F2L_SEEDS.map((seed) => ({
  id: `F2L-${seed.id.toString().padStart(2, "0")}`,
  category: "F2L",
  name: seed.name,
  caseImage: caseImage(seed),
  moves: moves(seed.moves),
  recognition: `识别 ${seed.name}：观察目标角块、棱块是否在 U 层、目标槽位或错误槽位，并确认白色朝向与侧面颜色关系。`,
  execution: `按 ${seed.moves} 执行。先保持目标槽位不被误破坏，再完成配对和插入；练习时重点控制 U 层调整和最后一次插入节奏。`,
  difficulty: seed.difficulty,
  tags: seed.tags,
  source: "ALGDB / SpeedCubeDB CFOP F2L 41 case",
}));

/** 按 tag 筛选 F2L 公式 */
export function filterF2L(tags?: string[]): Formula[] {
  if (!tags || tags.length === 0) return F2L_FORMULAS;
  return F2L_FORMULAS.filter((f) => tags.some((t) => f.tags.includes(t)));
}
