import type { AnalysisInput, AnalysisResult } from "../../src-shared/analysis-types.ts";
import { localAnalysisFallback } from "../../src-shared/local-analysis-fallback.ts";

const DEEPSEEK_API = "https://api.deepseek.com/v1/chat/completions";
const MODEL = "deepseek-chat";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ANALYSIS_FIELD_LENGTH = 500;
const MAX_RAW_RESPONSE_LENGTH = 1_500;
const DEEPSEEK_PLACEHOLDER = "sk-placeholder";
const MAX_REPLAY_MOVES = 160;

function asBoundedText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length === 0) return null;
  if (text.length <= MAX_ANALYSIS_FIELD_LENGTH) return text;
  return `${text.slice(0, MAX_ANALYSIS_FIELD_LENGTH - 1)}…`;
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
  return { bottleneck, trainingAdvice, encouragement, rawResponse: content.slice(0, MAX_RAW_RESPONSE_LENGTH) };
}

export function buildPrompt(input: AnalysisInput): string {
  const stages = [
    ["Cross", input.crossDuration, input.crossMoves],
    ["F2L", input.f2lDuration, input.f2lMoves],
    ["OLL", input.ollDuration, input.ollMoves],
    ["PLL", input.pllDuration, input.pllMoves],
  ];
  const stageText = stages.map(([name, duration, moves]) =>
    `- ${name}: ${(Number(duration) / 1000).toFixed(2)}s (${moves} moves)`).join("\n");
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
  return `你是一位严谨的 CFOP 竞速魔方复盘教练。请分析一组训练数据；界面会同时展示“打乱”和“完整解法”的 3D 回放，因此你的文字必须能对应这些动作，而非只给泛泛建议。

【本次数据】
总用时：${(input.totalDuration / 1000).toFixed(2)}s
${stageText}
打乱：${scramble}
实录解法：${moves}${moveSuffix}

【近期趋势】
${historyText}

【识别停顿】
${reviewText}

【F2L 逐对数据】
${slotText}

【复盘规则】
1. 先用数据说明瓶颈：有 F2L 逐对数据时，优先指出具体槽位、完成顺序、耗时或最长停顿；否则提及阶段用时/步数或记录停顿。没有证据时明确说“当前数据不足”。
2. 把“训练建议”写成紧凑的三段：问题｜优化方向｜下一把执行。要给出可观察、可执行的动作，例如“Cross 观察结束前先定完整路线”“F2L 插入后立即追踪下一对”。
3. 若实录解法存在，可以引用其中的动作片段作为复盘线索；但不得把猜测写成事实，不得声称已求得最优解，也不得编造未提供的公式或步数。
4. 不评价手速以外的个人特征；语气专业、具体、鼓励，但不空泛。
5. 所有字段使用简体中文，每个字段控制在 80–220 字。

只返回合法 JSON：{"bottleneck":"...","trainingAdvice":"...","encouragement":"..."}。不要 Markdown、不要额外字段。`;
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
