import type { AnalysisInput, AnalysisResult, AnalysisIssue, AnalysisDrill } from "../../src-shared/analysis-types.ts";
import { localAnalysisFallback } from "../../src-shared/local-analysis-fallback.ts";

const DEEPSEEK_API = "https://api.deepseek.com/v1/chat/completions";
const MODEL = "deepseek-chat";
const REQUEST_TIMEOUT_MS = 18_000;
const MAX_ANALYSIS_FIELD_LENGTH = 500;
const MAX_RAW_RESPONSE_LENGTH = 1_500;
const DEEPSEEK_PLACEHOLDER = "sk-placeholder";
const MAX_REPLAY_MOVES = 160;
const MAX_ISSUES = 4;
const MAX_DRILLS = 3;

function asBoundedText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length === 0) return null;
  if (text.length <= MAX_ANALYSIS_FIELD_LENGTH) return text;
  return `${text.slice(0, MAX_ANALYSIS_FIELD_LENGTH - 1)}…`;
}

const VALID_STAGES = new Set(["Cross", "F2L", "OLL", "PLL", "General"]);
const VALID_SEVERITIES = new Set(["high", "medium", "low"]);

function parseIssues(raw: unknown): AnalysisIssue[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const issues: AnalysisIssue[] = [];
  for (const item of raw.slice(0, MAX_ISSUES)) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    const stage = typeof obj.stage === "string" && VALID_STAGES.has(obj.stage) ? obj.stage as AnalysisIssue["stage"] : "General";
    const severity = typeof obj.severity === "string" && VALID_SEVERITIES.has(obj.severity) ? obj.severity as AnalysisIssue["severity"] : "medium";
    const description = asBoundedText(obj.description);
    const evidence = asBoundedText(obj.evidence);
    if (description) issues.push({ stage, severity, description, evidence: evidence ?? "" });
  }
  return issues.length > 0 ? issues : undefined;
}

function parseDrills(raw: unknown): AnalysisDrill[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const drills: AnalysisDrill[] = [];
  for (const item of raw.slice(0, MAX_DRILLS)) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    const title = asBoundedText(obj.title);
    const detail = asBoundedText(obj.detail);
    const reps = asBoundedText(obj.reps);
    if (title && detail) drills.push({ title, detail, reps: reps ?? "" });
  }
  return drills.length > 0 ? drills : undefined;
}

/** 校验模型返回内容，避免把不可信 JSON 直接带回浏览器。 */
export function parseAnalysisResult(content: string): AnalysisResult {
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("DeepSeek response is not a JSON object");
  }
  const result = parsed as Record<string, unknown>;
  const bottleneck = asBoundedText(result.bottleneck);
  const trainingAdvice = asBoundedText(result.trainingAdvice);
  const encouragement = asBoundedText(result.encouragement);
  if (!bottleneck || !trainingAdvice || !encouragement) {
    throw new Error("DeepSeek response is missing analysis fields");
  }
  const validStages = new Set(["Cross", "F2L", "OLL", "PLL", ""]);
  const bottleneckStage = typeof result.bottleneckStage === "string" && validStages.has(result.bottleneckStage)
    ? result.bottleneckStage as AnalysisResult["bottleneckStage"]
    : undefined;
  return {
    bottleneck,
    trainingAdvice,
    encouragement,
    rawResponse: content.slice(0, MAX_RAW_RESPONSE_LENGTH),
    source: "ai",
    bottleneckStage,
    issues: parseIssues(result.issues),
    drills: parseDrills(result.drills),
    nextFocus: asBoundedText(result.nextFocus) ?? undefined,
    trend: asBoundedText(result.trend) ?? undefined,
  };
}

export function buildPrompt(input: AnalysisInput): string {
  const stages = [
    ["Cross", input.crossDuration, input.crossMoves],
    ["F2L", input.f2lDuration, input.f2lMoves],
    ["OLL", input.ollDuration, input.ollMoves],
    ["PLL", input.pllDuration, input.pllMoves],
  ];
  const stageText = stages.map(([name, duration, moves]) => {
    const dur = Number(duration);
    const mov = Number(moves);
    const tps = dur > 0 ? (mov / (dur / 1000)).toFixed(1) : "—";
    return `- ${name}: ${(dur / 1000).toFixed(2)}s / ${mov} 步 / TPS ${tps}`;
  }).join("\n");
  const historyText = (input.recentSolves ?? []).slice(-12).map((solve, index) =>
    `Solve ${index + 1}: ${(solve.totalDuration / 1000).toFixed(2)}s`).join("\n") || "No history";
  const reviewText = (input.recentStepReviews ?? []).slice(-12).flatMap((review, index) =>
    review.pauses.map((pause) => `Recent review ${index + 1}: ${pause.stage} pause before ${pause.move}, ${(pause.gap / 1000).toFixed(2)}s`),
  ).join("\n") || "No notable pauses";
  const scramble = input.scramble?.trim() || "未保存";
  const moves = input.moves?.slice(0, MAX_REPLAY_MOVES).join(" ") || "未保存";
  const moveSuffix = (input.moves?.length ?? 0) > MAX_REPLAY_MOVES ? " …（后续动作已省略）" : "";
  const slotText = (input.f2lSlots ?? []).map((slot) => {
    if (slot.completedWithCross) return `${slot.slot}：与 Cross 同时完成`;
    if (slot.duration === undefined) return `${slot.slot}：未完成`;
    return `${slot.slot}：第 ${slot.completionOrder ?? "—"} 对，${(slot.duration / 1000).toFixed(2)}s，${slot.moves ?? 0} 步，停顿 ${slot.pauseCount} 次，最长 ${(slot.maxGap / 1000).toFixed(2)}s，修复 ${slot.repairCount} 次，回退 ${slot.breakCount} 次`;
  }).join("\n") || "本把没有可靠的 F2L 槽位数据";
  const sessionText = (input.sessionContext ?? []).map((entry, index) =>
    `第 ${index + 1} 把：${(entry.totalDuration / 1000).toFixed(2)}s，瓶颈 ${entry.bottleneckStage || "未知"}，${entry.topIssue}`,
  ).join("\n") || "本次会话暂无历史分析记录";
  const totalTps = input.totalDuration > 0 && input.moveCount
    ? (input.moveCount / (input.totalDuration / 1000)).toFixed(1)
    : "—";
  return `你是一位严谨的 CFOP 竞速魔方复盘教练。请分析一组训练数据；界面会同时展示"打乱"和"完整解法"的 3D 回放，因此你的文字必须能对应这些动作，而非只给泛泛建议。

【本次数据】
总用时：${(input.totalDuration / 1000).toFixed(2)}s（${input.moveCount ?? "—"} 步，整体 TPS ${totalTps}）
${stageText}
打乱：${scramble}
实录解法：${moves}${moveSuffix}

【近期趋势】
${historyText}

【识别停顿】
${reviewText}

【F2L 逐对数据】
${slotText}

【本次会话历史】
${sessionText}

【复盘规则】
1. issues 数组：列出 1-4 个具体问题，按严重程度排序。每个问题必须有数据证据（引用具体槽位/步数/停顿/用时占比）。severity 判定：high = 占总用时 >35% 或停顿 >2s；medium = 占比 20-35% 或停顿 1-2s；low = 其余。
2. drills 数组：给出 1-3 个针对性训练动作。title 是动作名（如"F2L 第 3 对慢拧"），detail 是具体做法（含观察要点），reps 是建议量（如"10 次 × 2 组"）。
3. nextFocus：一句话，下一把最应该关注什么（如"插入第 2 对前先看第 3 对位置"）。
4. bottleneck / trainingAdvice / encouragement 三个文本字段保留，作为自然语言总结。trainingAdvice 写成"问题｜优化方向｜下一把执行"三段式。
5. 若实录解法存在，可引用其中的动作片段作为复盘线索；但不得把猜测写成事实，不得声称已求得最优解，也不得编造未提供的公式或步数。
6. 不评价手速以外的个人特征；语气专业、具体、鼓励，但不空泛。
7. 所有字段使用简体中文，文本字段每个控制在 80-220 字。
8. trend：若有会话历史，用一句话判断瓶颈是持续性的还是偶发的（如「F2L 连续 3 把为瓶颈，BR 槽位持续偏慢」或「本把 Cross 首次成为瓶颈，可能是偶发」）。无会话历史时填空字符串。

只返回合法 JSON，schema 如下：
{"bottleneck":"...","trainingAdvice":"...","encouragement":"...","bottleneckStage":"Cross|F2L|OLL|PLL","nextFocus":"...","trend":"...","issues":[{"stage":"F2L","severity":"high","description":"...","evidence":"..."}],"drills":[{"title":"...","detail":"...","reps":"..."}]}
不要 Markdown、不要额外字段。`;
}

export async function analyze(input: AnalysisInput): Promise<AnalysisResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || apiKey === DEEPSEEK_PLACEHOLDER) return localAnalysisFallback(input);

  try {
    const response = await fetch(DEEPSEEK_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: "你是基于证据复盘的 CFOP 竞速魔方教练。只输出符合用户 schema 的合法 JSON；不要虚构最优解或未记录的动作。" },
          { role: "user", content: buildPrompt(input) },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`DeepSeek API error: ${response.status}`);
    const data: unknown = await response.json();
    const content = typeof data === "object" && data !== null
      ? (data as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content
      : undefined;
    if (typeof content !== "string") throw new Error("DeepSeek response content is empty");
    return parseAnalysisResult(content);
  } catch (error) {
    console.error("[backend] DeepSeek call failed; using local fallback:", error);
    return localAnalysisFallback(input);
  }
}

/** 流式分析：逐 chunk 回调文本增量，最终返回校验后的结构化结果。 */
export async function analyzeStream(
  input: AnalysisInput,
  onChunk: (delta: string, accumulated: string) => void,
): Promise<AnalysisResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || apiKey === DEEPSEEK_PLACEHOLDER) {
    const fallback = localAnalysisFallback(input);
    onChunk(JSON.stringify(fallback, null, 2), "");
    return fallback;
  }

  try {
    const response = await fetch(DEEPSEEK_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        messages: [
          { role: "system", content: "你是基于证据复盘的 CFOP 竞速魔方教练。只输出符合用户 schema 的合法 JSON；不要虚构最优解或未记录的动作。" },
          { role: "user", content: buildPrompt(input) },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`DeepSeek API error: ${response.status}`);
    if (!response.body) throw new Error("DeepSeek response body is null");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = "";
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // 最后一行可能不完整，留到下次处理
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            accumulated += delta;
            onChunk(delta, accumulated);
          }
        } catch {
          // 忽略无法解析的行（心跳等）
        }
      }
    }

    if (!accumulated.trim()) throw new Error("DeepSeek stream returned no content");
    return parseAnalysisResult(accumulated);
  } catch (error) {
    console.error("[backend] DeepSeek stream failed; using local fallback:", error);
    const fallback = localAnalysisFallback(input);
    onChunk(JSON.stringify(fallback, null, 2), "");
    return fallback;
  }
}
