import { Router, type Request, type Response } from "express";

const SPEED_CUBE_DB_URL = "https://speedcubedb.com/a/3x3";
const CACHE_TTL_MS = 30 * 60 * 1000;

interface FormulaAlternativesPayload {
  alternatives: Record<string, string[][]>;
  diagrams: Record<string, SpeedCubeDbDiagram>;
  source: "SpeedCubeDB";
}

interface SpeedCubeDbDiagram {
  us: string;
  ub: string;
  uf: string;
  ul: string;
  ur: string;
}

let cache: { expiresAt: number; payload: FormulaAlternativesPayload } | null = null;

function decodeHtml(value: string): string {
  return value.replace(/&(?:#39|apos);/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

function toFormulaId(category: string, name: string): string | null {
  if (category === "OLL") {
    const match = /^OLL\s+(\d+)$/i.exec(name);
    return match ? `OLL-${match[1].padStart(2, "0")}` : null;
  }
  if (category === "PLL") return `PLL-${name}`;
  const match = /^F2L\s+(\d+)$/i.exec(name);
  return match ? `F2L-${match[1].padStart(2, "0")}` : null;
}

/** 从 SpeedCubeDB 分类页提取同一 case 的真实备用算法，不生成 AUF 伪变体。 */
export function parseSpeedCubeDbAlternatives(category: string, html: string): Record<string, string[][]> {
  const alternatives: Record<string, string[][]> = {};
  const cases = html.split(/(?=<div class="row singlealgorithm\b)/);
  for (const item of cases) {
    const name = /data-alg="([^"]+)"/.exec(item)?.[1];
    if (!name) continue;
    const formulaId = toFormulaId(category, decodeHtml(name));
    if (!formulaId) continue;
    const unique = new Set<string>();
    const moves: string[][] = [];
    for (const match of item.matchAll(/class="formatted-alg">([\s\S]*?)<\/div>/g)) {
      const algorithm = decodeHtml(match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
      if (!algorithm || unique.has(algorithm)) continue;
      unique.add(algorithm);
      moves.push(algorithm.split(" "));
      if (moves.length === 4) break;
    }
    if (moves.length > 0) alternatives[formulaId] = moves;
  }
  return alternatives;
}

/** 读取 SpeedCubeDB jcube 的原始展开图参数，避免本地反推造成朝向偏差。 */
export function parseSpeedCubeDbDiagrams(category: string, html: string): Record<string, SpeedCubeDbDiagram> {
  const diagrams: Record<string, SpeedCubeDbDiagram> = {};
  const cases = html.split(/(?=<div class="row singlealgorithm\b)/);
  for (const item of cases) {
    const name = /data-alg="([^"]+)"/.exec(item)?.[1];
    const formulaId = name ? toFormulaId(category, decodeHtml(name)) : null;
    const image = /<div class="jcube"([^>]*)>/.exec(item)?.[1];
    if (!formulaId || !image) continue;
    const attr = (key: string): string | null => new RegExp(`${key}="([^"]+)"`).exec(image)?.[1] ?? null;
    const us = attr("data-us");
    const ub = attr("data-ub");
    const uf = attr("data-uf");
    const ul = attr("data-ul");
    const ur = attr("data-ur");
    if (us && ub && uf && ul && ur) diagrams[formulaId] = { us, ub, uf, ul, ur };
  }
  return diagrams;
}

interface SpeedCubeDbCategoryData {
  alternatives: Record<string, string[][]>;
  diagrams: Record<string, SpeedCubeDbDiagram>;
}

async function fetchCategory(category: "F2L" | "OLL" | "PLL"): Promise<SpeedCubeDbCategoryData> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${SPEED_CUBE_DB_URL}/${category}`, {
      headers: { "User-Agent": "CubeMind formula library/0.3" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    return { alternatives: parseSpeedCubeDbAlternatives(category, html), diagrams: parseSpeedCubeDbDiagrams(category, html) };
  } finally {
    clearTimeout(timeout);
  }
}

export const formulaAlternativesRouter = Router();

formulaAlternativesRouter.get("/formula-alternatives", async (_req: Request, res: Response): Promise<void> => {
  if (cache && cache.expiresAt > Date.now()) {
    res.json(cache.payload);
    return;
  }
  try {
    const results = await Promise.allSettled([fetchCategory("F2L"), fetchCategory("OLL"), fetchCategory("PLL")]);
    const entries = results
      .filter((result): result is PromiseFulfilledResult<SpeedCubeDbCategoryData> => result.status === "fulfilled")
      .map((result) => result.value);
    if (entries.length === 0) throw new Error("所有分类页均不可用");
    const payload: FormulaAlternativesPayload = {
      alternatives: Object.assign({}, ...entries.map((entry) => entry.alternatives)),
      diagrams: Object.assign({}, ...entries.map((entry) => entry.diagrams)),
      source: "SpeedCubeDB",
    };
    cache = { expiresAt: Date.now() + CACHE_TTL_MS, payload };
    res.json(payload);
  } catch (error) {
    console.error("[formula-alternatives] SpeedCubeDB 读取失败:", error);
    res.status(502).json({ error: "暂时无法读取 SpeedCubeDB 公式库。" });
  }
});
