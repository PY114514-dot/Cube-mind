import { readFileSync } from "node:fs";
import { createApp } from "./app.ts";

// 加载 .env（gitignored）：DeepSeek Key 走环境变量注入，绝不硬编码。
// 为什么不用 process.loadEnvFile：它不覆盖已存在的环境变量，本机遗留的旧 Key
// 会永远遮蔽 .env 里的新 Key；.env 是项目内显式配置，应优先于宿主环境。
function loadEnvOverride(path: string): void {
  try {
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (key) process.env[key] = trimmed.slice(eq + 1).trim();
    }
  } catch (error) {
    console.warn(
      "[server] 未找到 .env，DeepSeek 使用本地 fallback:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
loadEnvOverride(".env");

const PORT = Number(process.env.PORT ?? 3000);
const app = createApp();

app.listen(PORT, () => {
  console.log(`CubeMind backend listening on http://localhost:${PORT}`);
  console.log(`DeepSeek: ${process.env.DEEPSEEK_API_KEY ? "configured" : "local fallback"}`);
});
