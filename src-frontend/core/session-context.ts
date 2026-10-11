/**
 * core/session-context.ts
 * 会话级训练上下文：记录最近 N 把的瓶颈和问题，供 AI 分析时判断趋势。
 *
 * 设计：
 *   - 每次 AI 分析完成后，将结构化结果摘要追加到 session
 *   - 保留最近 5 条，超出时淘汰最旧的
 *   - 持久化到 localStorage，跨刷新保持
 *   - 超过 4 小时未活动视为新会话，自动清空
 */

export interface SessionEntry {
  completedAt: number;
  totalDuration: number;
  bottleneckStage: string;
  topIssue: string;
}

export interface SessionContext {
  entries: SessionEntry[];
  lastActiveAt: number;
}

const STORAGE_KEY = "cubemind:session";
const MAX_ENTRIES = 5;
const SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000;

export function loadSessionContext(): SessionContext {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { entries: [], lastActiveAt: Date.now() };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { entries: [], lastActiveAt: Date.now() };
    const ctx = parsed as SessionContext;
    if (!Array.isArray(ctx.entries)) return { entries: [], lastActiveAt: Date.now() };
    // 超时视为新会话
    if (Date.now() - (ctx.lastActiveAt ?? 0) > SESSION_TIMEOUT_MS) {
      return { entries: [], lastActiveAt: Date.now() };
    }
    return { entries: ctx.entries.slice(-MAX_ENTRIES), lastActiveAt: ctx.lastActiveAt };
  } catch (error) {
    console.error("[session-context] 读取失败，回退为新会话:", error);
    return { entries: [], lastActiveAt: Date.now() };
  }
}

export function appendSessionEntry(entry: SessionEntry): SessionContext {
  const ctx = loadSessionContext();
  ctx.entries.push(entry);
  if (ctx.entries.length > MAX_ENTRIES) {
    ctx.entries = ctx.entries.slice(-MAX_ENTRIES);
  }
  ctx.lastActiveAt = Date.now();
  persist(ctx);
  return ctx;
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

function persist(ctx: SessionContext): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
  } catch (error) {
    // QuotaExceeded 时放弃写入，但错误必须可见（4.4）
    console.error("[session-context] 持久化失败:", error);
  }
}
