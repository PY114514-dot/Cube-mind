import { Router, type Request, type Response } from "express";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const diagnosticsRouter = Router();

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, "..", "data", "diagnostics.jsonl");
const MAX_SCRAMBLE_LENGTH = 500;
const MAX_MOVES = 400;
const MAX_ANOMALIES = 20;

type DiagnosticKind = "scramble" | "solve";
type DiagnosticMode = "normal" | "formula" | "cross" | "f2l" | "cross-f2l";

interface DiagnosticEvent {
  kind: DiagnosticKind;
  occurredAt: number;
  scramble: string;
  mode: DiagnosticMode;
  formulaId?: string;
  moves?: string[];
  totalDuration?: number;
  qualityStatus?: string;
  qualityAnomalies?: string[];
}

interface DiagnosticRecord extends DiagnosticEvent {
  id: string;
  receivedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDiagnosticMode(value: unknown): value is DiagnosticMode {
  return value === "normal" || value === "formula" || value === "cross" || value === "f2l" || value === "cross-f2l";
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.length <= maxLength ? value : undefined;
}

function optionalMoves(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_MOVES) return undefined;
  return value.every((move) => typeof move === "string" && move.length <= 12) ? value : undefined;
}

function optionalAnomalies(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_ANOMALIES) return undefined;
  return value.every((item) => typeof item === "string" && item.length <= 120) ? value as string[] : undefined;
}

/** 将浏览器诊断事件收窄为可安全落盘的本地记录。 */
export function parseDiagnosticEvent(value: unknown): DiagnosticEvent | null {
  if (!isRecord(value) || (value.kind !== "scramble" && value.kind !== "solve")
    || !isDiagnosticMode(value.mode) || typeof value.scramble !== "string" || value.scramble.length > MAX_SCRAMBLE_LENGTH
    || typeof value.occurredAt !== "number" || !Number.isFinite(value.occurredAt)) return null;

  const moves = optionalMoves(value.moves);
  const qualityAnomalies = optionalAnomalies(value.qualityAnomalies);
  const formulaId = optionalText(value.formulaId, 80);
  const qualityStatus = optionalText(value.qualityStatus, 40);
  const totalDuration = value.totalDuration;
  if (value.moves !== undefined && !moves) return null;
  if (value.qualityAnomalies !== undefined && !qualityAnomalies) return null;
  if (value.formulaId !== undefined && !formulaId) return null;
  if (value.qualityStatus !== undefined && !qualityStatus) return null;
  if (totalDuration !== undefined && (typeof totalDuration !== "number" || !Number.isFinite(totalDuration) || totalDuration < 0)) return null;

  return {
    kind: value.kind,
    occurredAt: value.occurredAt,
    scramble: value.scramble,
    mode: value.mode,
    formulaId,
    moves,
    totalDuration: totalDuration as number | undefined,
    qualityStatus,
    qualityAnomalies,
  };
}

async function appendDiagnostic(event: DiagnosticEvent): Promise<DiagnosticRecord> {
  await mkdir(dirname(DATA_FILE), { recursive: true });
  const record: DiagnosticRecord = { ...event, id: crypto.randomUUID(), receivedAt: Date.now() };
  await appendFile(DATA_FILE, `${JSON.stringify(record)}\n`, "utf-8");
  return record;
}

async function readDiagnostics(limit: number): Promise<DiagnosticRecord[]> {
  try {
    const content = await readFile(DATA_FILE, "utf-8");
    return content.trim().split("\n").flatMap((line) => {
      try {
        const event = parseDiagnosticEvent(JSON.parse(line));
        const raw = JSON.parse(line) as { id?: unknown; receivedAt?: unknown };
        return event && typeof raw.id === "string" && typeof raw.receivedAt === "number"
          ? [{ ...event, id: raw.id, receivedAt: raw.receivedAt }]
          : [];
      } catch (error) {
        console.error("[diagnostics] 忽略损坏日志行:", error);
        return [];
      }
    }).slice(-limit);
  } catch (error: unknown) {
    if (isRecord(error) && error.code === "ENOENT") return [];
    console.error("[diagnostics] 无法读取诊断日志:", error);
    return [];
  }
}

diagnosticsRouter.post("/diagnostics", async (req: Request, res: Response) => {
  const event = parseDiagnosticEvent(req.body);
  if (!event) return res.status(400).json({ error: "诊断日志格式无效。" });
  try {
    const record = await appendDiagnostic(event);
    res.status(201).json({ id: record.id, receivedAt: record.receivedAt });
  } catch (error) {
    console.error("[diagnostics] 写入诊断日志失败:", error);
    res.status(500).json({ error: "写入诊断日志失败。" });
  }
});

diagnosticsRouter.get("/diagnostics", async (req: Request, res: Response) => {
  const requested = Number(req.query.limit ?? 100);
  const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 200) : 100;
  res.json({ records: await readDiagnostics(limit) });
});
