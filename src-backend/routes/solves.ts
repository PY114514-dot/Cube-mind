import { Router, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSolveInput, type SolveInput } from "../validation.ts";

export const solvesRouter = Router();

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, "..", "data", "history.json");
const MAX_RECORDS = 100;

interface SolveRecord extends SolveInput {
  id: string;
  timestamp: number;
}

function isStoredRecord(value: unknown): value is SolveRecord {
  if (typeof value !== "object" || value === null) return false;
  const parsed = parseSolveInput(value);
  const record = value as { id?: unknown; timestamp?: unknown };
  return parsed !== null && typeof record.id === "string" && typeof record.timestamp === "number";
}

async function readHistory(): Promise<SolveRecord[]> {
  if (!existsSync(DATA_FILE)) return [];
  try {
    const parsed: unknown = JSON.parse(await readFile(DATA_FILE, "utf-8"));
    return Array.isArray(parsed) ? parsed.filter(isStoredRecord) : [];
  } catch (error) {
    console.error("[solves] 无法读取历史记录:", error);
    return [];
  }
}

async function writeHistory(records: SolveRecord[]): Promise<void> {
  await mkdir(dirname(DATA_FILE), { recursive: true });
  const tempFile = `${DATA_FILE}.${crypto.randomUUID()}.tmp`;
  await writeFile(tempFile, JSON.stringify(records, null, 2), "utf-8");
  await rename(tempFile, DATA_FILE);
}

solvesRouter.get("/solves", async (_req: Request, res: Response) => {
  res.json({ records: await readHistory() });
});

solvesRouter.post("/solves", async (req: Request, res: Response) => {
  const input = parseSolveInput(req.body);
  if (!input) return res.status(400).json({ error: "成绩数据格式无效。" });

  try {
    const records = await readHistory();
    const record: SolveRecord = { ...input, id: crypto.randomUUID(), timestamp: Date.now() };
    records.push(record);
    if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
    await writeHistory(records);
    res.status(201).json({ id: record.id, total: records.length });
  } catch (error) {
    console.error("[solves] 保存历史记录失败:", error);
    res.status(500).json({ error: "保存历史记录失败。" });
  }
});

solvesRouter.delete("/solves/:id", async (req: Request, res: Response) => {
  try {
    const records = await readHistory();
    const filtered = records.filter((record) => record.id !== req.params.id);
    await writeHistory(filtered);
    res.json({ deleted: records.length - filtered.length });
  } catch (error) {
    console.error("[solves] 删除历史记录失败:", error);
    res.status(500).json({ error: "删除历史记录失败。" });
  }
});
