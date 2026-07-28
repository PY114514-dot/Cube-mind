import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeRouter } from "./routes/analyze.ts";
import { solvesRouter } from "./routes/solves.ts";
import { diagnosticsRouter } from "./routes/diagnostics.ts";
import { formulaAlternativesRouter } from "./routes/formula-alternatives.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = join(__dirname, "..", "dist");
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGINS ?? "http://localhost:8080,http://127.0.0.1:8080")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean));

/** 创建 HTTP 应用；监听端口由 server.ts 负责，便于集成测试复用。 */
export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: "16kb" }));

  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return res.status(403).json({ error: "不允许的请求来源。" });
    }
    if (origin) res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
  });

  app.use("/api", analyzeRouter);
  app.use("/api", solvesRouter);
  app.use("/api", diagnosticsRouter);
  app.use("/api", formulaAlternativesRouter);
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", deepseekConfigured: Boolean(process.env.DEEPSEEK_API_KEY), timestamp: Date.now() });
  });

  if (existsSync(FRONTEND_DIST)) {
    app.use(express.static(FRONTEND_DIST));
    app.get("*", (_req: Request, res: Response) => res.sendFile(join(FRONTEND_DIST, "index.html")));
  }

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof SyntaxError && "body" in error) {
      return res.status(400).json({ error: "请求 JSON 格式无效。" });
    }
    next(error);
  });
  return app;
}
