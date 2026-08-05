import { Router, type Request, type Response } from "express";
import { analyze, analyzeStream } from "../services/deepseek.ts";
import { parseAnalysisInput } from "../validation.ts";

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;
const requestCounts = new Map<string, { count: number; resetAt: number }>();

export const analyzeRouter = Router();

function isRateLimited(clientId: string, now: number): boolean {
  for (const [id, record] of requestCounts) {
    if (record.resetAt <= now) requestCounts.delete(id);
  }
  const current = requestCounts.get(clientId);
  if (!current || current.resetAt <= now) {
    requestCounts.set(clientId, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  current.count++;
  return current.count > MAX_REQUESTS_PER_WINDOW;
}

/** 写一条 SSE 事件 */
function sseWrite(res: Response, payload: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

analyzeRouter.post("/analyze", async (req: Request, res: Response) => {
  const clientId = req.ip ?? req.socket.remoteAddress ?? "unknown";
  if (isRateLimited(clientId, Date.now())) {
    return res.status(429).json({ error: "请求过于频繁，请稍后重试。" });
  }

  const input = parseAnalysisInput(req.body);
  if (!input) {
    return res.status(400).json({ error: "分析数据格式无效。" });
  }

  const wantStream = req.query.stream === "true";

  if (!wantStream) {
    try {
      res.json(await analyze(input));
    } catch (error) {
      console.error("[analyze] 分析失败:", error);
      res.status(500).json({ error: "分析失败，请稍后重试。" });
    }
    return;
  }

  // SSE 流式模式
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // 客户端断开时标记，避免继续写入
  let aborted = false;
  req.on("close", () => { aborted = true; });

  try {
    const result = await analyzeStream(input, (delta) => {
      if (!aborted) sseWrite(res, { type: "chunk", text: delta });
    });
    if (!aborted) sseWrite(res, { type: "done", result });
  } catch (error) {
    console.error("[analyze] 流式分析失败:", error);
    if (!aborted) sseWrite(res, { type: "error", message: "分析失败，请稍后重试。" });
  } finally {
    res.end();
  }
});
