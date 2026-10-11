import express from "express";
import * as esbuild from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 独立进程、端口和构建目录，不读取 .env，也不向模型或诊断存储发送测试数据。
process.env.DEEPSEEK_API_KEY = "";
process.env.ALLOWED_ORIGINS = "";
const { createApp } = await import("../src-backend/app.ts");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = await mkdtemp(join(tmpdir(), "cubemind-simulator-"));

const context = await esbuild.context({
  absWorkingDir: root,
  entryPoints: { bundle: "src-frontend/testing/simulator.ts", "cross-scramble-worker": "src-frontend/core/cross-scramble-worker.ts" },
  bundle: true, format: "iife", target: "es2020", outdir: output, logLevel: "warning",
  plugins: [{
    name: "simulated-gan",
    setup(build) {
      build.onResolve({ filter: /gan-cube-protocol\.ts$/ }, () => ({ path: join(root, "src-frontend/testing/simulated-cube.ts") }));
    },
  }],
});
try {
  await context.rebuild();
  await context.watch();
} catch (error) {
  console.error("[模拟验收] 构建失败:", error);
  await cleanup();
  process.exit(1);
}
const app = express();
app.post("/api/diagnostics", (_req, res) => res.sendStatus(204));
app.get("/api/formula-alternatives", (_req, res) => res.json({ alternatives: [] }));
app.get("/", async (_req, res, next) => {
  try {
    const [html, panel] = await Promise.all([
      readFile(join(root, "index.html"), "utf8"),
      readFile(join(root, "src-frontend/testing/simulator-panel.html"), "utf8"),
    ]);
    res.set("Cache-Control", "no-store").send(html.replace('<main id="main-content"', `${panel}<main id="main-content"`));
  } catch (error) { next(error); }
});
app.use(express.static(output, { setHeaders: (res) => res.setHeader("Cache-Control", "no-store") }));
app.use(createApp());
const server = app.listen(3001, "127.0.0.1", () => {
  console.info("无设备验收：http://localhost:3001 · 修改前端后刷新页面 · Ctrl+C 停止");
});

async function cleanup() {
  await context.dispose();
  // 只删除本进程在系统临时目录中创建的构建目录。
  if (dirname(output) !== resolve(tmpdir()) || !basename(output).startsWith("cubemind-simulator-")) {
    throw new Error("模拟构建目录越界，未删除");
  }
  await rm(output, { recursive: true, force: true });
}

server.on("error", async (error) => {
  console.error("[模拟验收] 服务启动失败:", error);
  await cleanup();
  process.exitCode = 1;
});
const stop = () => server.close(() => {
  void cleanup().catch((error) => { console.error("[模拟验收] 清理失败:", error); process.exitCode = 1; });
});
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
