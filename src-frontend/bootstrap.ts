/** 前端入口错误边界，避免模块初始化失败时页面只剩静态骨架。 */
void import("./main.ts").catch((error: unknown) => {
  console.error("[bootstrap] 前端初始化失败:", error);
  const root = document.getElementById("cube-3d");
  if (!root) return;
  const message = error instanceof Error ? error.message : String(error);
  root.innerHTML = `<p style="padding: 24px; color: #b91c1c; font-family: monospace;">前端初始化失败：${escapeHtml(message)}。请将此信息反馈给开发者。</p>`;
});

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;",
  })[character] ?? character);
}
