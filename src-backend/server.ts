import { createApp } from "./app.ts";

const PORT = Number(process.env.PORT ?? 3000);
const app = createApp();

app.listen(PORT, () => {
  console.log(`CubeMind backend listening on http://localhost:${PORT}`);
  console.log(`DeepSeek: ${process.env.DEEPSEEK_API_KEY ? "configured" : "local fallback"}`);
});
