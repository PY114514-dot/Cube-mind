import type { AnalysisInput, AnalysisResult } from "../../src-shared/analysis-types.ts";
import { localAnalysisFallback } from "../../src-shared/local-analysis-fallback.ts";
import { buildEvidence, evidenceToText } from "../../src-shared/analysis-evidence.ts";

import { parseAnalysisResult } from "./analysis-result.ts";

const DEEPSEEK_API = "https://api.deepseek.com/v1/chat/completions";
const MODEL = "deepseek-chat";
const REQUEST_TIMEOUT_MS = 18_000;
const MAX_RAW_RESPONSE_LENGTH = 1_500;
const DEEPSEEK_PLACEHOLDER = "sk-placeholder";
/** 复盘输出偏结构化 JSON，低温保证稳定复现，靠 schema 重试兜住偶发格式错误。 */
const TEMPERATURE = 0.4;
const SYSTEM_PROMPT = "你是基于证据复盘的 CFOP 竞速魔方教练。只输出符合用户 schema 的合法 JSON；不要虚构最优解或未记录的动作。";

// ====== 重试 & 熔断 ======
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 500;
const CIRCUIT_MAX_FAILURES = 5;
const CIRCUIT_COOLDOWN_MS = 60_000;

let circuitState: "closed" | "open" | "half-open" = "closed";
let circuitFailures = 0;
let circuitOpenedAt = 0;

/** 判断错误是否属于瞬时故障（可重试） */
function isTransientError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "TimeoutError") return true;
  if (error instanceof TypeError) return true; // fetch 网络错误
  const msg = error instanceof Error ? error.message : "";
  const match = msg.match(/DeepSeek API error: (\d+)/);
  if (match) {
    const status = Number(match[1]);
    return status >= 500 || status === 429;
  }
  return false;
}

function circuitAllowsRequest(): boolean {
  if (circuitState === "closed") return true;
  if (circuitState === "open" && Date.now() - circuitOpenedAt >= CIRCUIT_COOLDOWN_MS) {
    circuitState = "half-open";
    return true;
  }
  return circuitState === "half-open";
}

function circuitRecordSuccess(): void {
  circuitState = "closed";
  circuitFailures = 0;
}

function circuitRecordFailure(): void {
  circuitFailures++;
  if (circuitFailures >= CIRCUIT_MAX_FAILURES) {
    circuitState = "open";
    circuitOpenedAt = Date.now();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildPrompt(input: AnalysisInput): string {
  const evidence = buildEvidence(input);
  return `你是一位严谨的 CFOP 竞速魔方复盘教练。请分析一组训练数据；界面可以按证据定位问题动作，也能展示最近一把的完整解法，因此你的文字必须对应实录数据。

${evidenceToText(evidence)}

【复盘规则】
1. issues 数组：列出 0-4 个有证据的具体问题，按严重程度排序。每条必须有 evidenceId，严格引用【可引用诊断证据】里的 ID，stage 与证据一致。severity 和 evidence 会由程序按引用回填，禁止编造 ID 或回放步数。正常时间分布不必列为问题。
2. drills 数组：给出 1-3 个针对性训练动作。title 是动作名（如"F2L 第 3 对慢拧"），detail 是具体做法（含观察要点），reps 是建议量（如"10 次 × 2 组"）。
3. nextFocus：一句话，下一把最应该关注什么（如"插入第 2 对前先看第 3 对位置"）。
4. bottleneck / trainingAdvice / encouragement 三个文本字段保留，作为自然语言总结。trainingAdvice 写成"问题｜优化方向｜下一把执行"三段式。
5. 若实录解法存在，可引用其中的动作片段作为复盘线索；但不得把猜测写成事实，不得声称已求得最优解，也不得编造未提供的公式或步数。
6. 语气专业、具体、鼓励，不空泛；不评价手速以外的个人特征。
7. 所有字段使用简体中文，文本字段每个控制在 80-220 字。
8. trend：若有会话历史，用一句话判断瓶颈是持续性的还是偶发的（如「F2L 连续 3 把为瓶颈，BR 槽位持续偏慢」或「本把 Cross 首次成为瓶颈，可能是偶发」）。无会话历史时填空字符串。
9. focusFormulas 数组：把复盘结论变成可执行的练习指派，1-3 个具体公式。formulaId 只能引用【公式库练习数据】或【逐 case 证据】里出现过的 id，stage 必须与该公式所属阶段一致（F2L/OLL/PLL）；无法对应具体公式时省略 formulaId，只给 stage 表示阶段级建议。reason 写清指派理由（引用练习成功率或本把 case 证据）。
10. bottleneck 与 issues 必须优先引用【逐 case 证据】里的 case 偏差；case 证据为空时只给阶段级建议，禁止编造 caseId。
11. 若【指派效果】显示某公式上次指派后成功率 ≥80%，或练习 10 次以上且成功率 ≥70%，focusFormulas 应优先指派其他薄弱公式或给阶段级建议，避免重复指派已提升的公式；已提升但未稳定的公式可在 reason 里写进展评价（如「上次指派后成功率 40%→70%」）。
12. 多把分析必须引用本窗的 CASE 命中数、偏差次数和样本边界，不把最近一把的动作写成所有成绩共同的解法。阶段占比不代表异常，优先使用同 CASE 或同阶段的个人基准；没有基准明确说明，不编造目标秒数。
13. 起手前动作间隔只证明存在停顿，不能证明是在识别、找块、想公式或调整握法。所选解法步数是参照，不是最优解；「我的解法」是保存成绩时的本机手法快照，不代表实录一定采用该手法。多出的步数可能包含 AUF 或衔接，不能直接称为浪费。
14. 结合【专项后的实战观察】调整训练：专项熟练但实战仍停顿，优先练混合局面识别与动作衔接；同 CASE 样本不足则继续观察。训练前后变化不证明因果关系。
15. 首末动作间隔不含起手前等待，但含片段内停顿；不能仅凭步数或该间隔断言手速慢。前后参照不同或记录不足时不比较步数差，同 CASE 个人步数基准也可能混合不同手法。

只返回合法 JSON，schema 如下：
{"bottleneck":"...","trainingAdvice":"...","encouragement":"...","bottleneckStage":"Cross|F2L|OLL|PLL","nextFocus":"...","trend":"...","issues":[{"stage":"F2L","evidenceId":"从证据目录选择","description":"..."}],"drills":[{"title":"...","detail":"...","reps":"..."}],"focusFormulas":[{"stage":"F2L","formulaId":"从提供的公式证据选择","reason":"..."}]}
不要 Markdown、不要额外字段。`;
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** 单次非流式补全：POST chat/completions，返回模型原始 content 文本（不校验 schema）。 */
async function fetchCompletion(apiKey: string, messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  const response = await fetch(DEEPSEEK_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      messages,
      response_format: { type: "json_object" },
      temperature: TEMPERATURE,
    }),
    signal,
  });
  if (!response.ok) throw new Error(`DeepSeek API error: ${response.status}`);
  const data: unknown = await response.json();
  const content = typeof data === "object" && data !== null
    ? (data as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content
    : undefined;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("DeepSeek response content is empty");
  }
  return content;
}

/** schema 校验失败后的修复提示：把具体失败原因回灌给模型，而不是笼统地要求重试。 */
function buildSchemaFeedback(error: unknown): string {
  const reason = error instanceof Error ? error.message : "JSON 解析失败";
  return `你刚才的输出未通过 schema 校验：${reason}。请重新输出，只返回合法 JSON，不要 Markdown、不要额外字段、不要解释。`;
}

export async function analyze(input: AnalysisInput): Promise<AnalysisResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || apiKey === DEEPSEEK_PLACEHOLDER) return localAnalysisFallback(input);

  if (!circuitAllowsRequest()) {
    console.warn("[backend] Circuit breaker open, skipping DeepSeek call");
    return localAnalysisFallback(input);
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildPrompt(input) },
  ];
  let lastError: unknown;
  let repairAttempted = false;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.warn(`[backend] DeepSeek retry/repair ${attempt}/${MAX_RETRIES}`);
      await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
    }
    try {
      const content = await fetchCompletion(apiKey, messages, AbortSignal.timeout(REQUEST_TIMEOUT_MS));
      try {
        const result = parseAnalysisResult(content, input);
        circuitRecordSuccess();
        return result;
      } catch (schemaError) {
        // 输出没过 schema 校验：把失败输出与错误原因追加进对话，让模型自行修复一次。
        if (repairAttempted) throw schemaError;
        repairAttempted = true;
        messages.push({ role: "assistant", content: content.slice(0, MAX_RAW_RESPONSE_LENGTH) });
        messages.push({ role: "user", content: buildSchemaFeedback(schemaError) });
        continue;
      }
    } catch (error) {
      lastError = error;
      if (!isTransientError(error)) break; // 永久错误不重试
    }
  }

  circuitRecordFailure();
  console.error("[backend] DeepSeek call failed; using local fallback:", lastError);
  return localAnalysisFallback(input);
}

/** 流式分析：逐 chunk 回调文本增量，最终返回校验后的结构化结果。 */
export async function analyzeStream(
  input: AnalysisInput,
  onChunk: (delta: string, accumulated: string) => void,
  signal?: AbortSignal,
): Promise<AnalysisResult> {
  signal?.throwIfAborted();
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || apiKey === DEEPSEEK_PLACEHOLDER) {
    const fallback = localAnalysisFallback(input);
    onChunk(JSON.stringify(fallback, null, 2), "");
    return fallback;
  }

  if (!circuitAllowsRequest()) {
    console.warn("[backend] Circuit breaker open, skipping DeepSeek stream call");
    const fallback = localAnalysisFallback(input);
    onChunk(JSON.stringify(fallback, null, 2), "");
    return fallback;
  }

  try {
    // 响应体读取和格式修复也必须受同一请求期限约束。
    const combinedSignal = AbortSignal.any([
      AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(signal ? [signal] : []),
    ]);

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildPrompt(input) },
    ];
    const response = await fetch(DEEPSEEK_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        messages,
        response_format: { type: "json_object" },
        temperature: TEMPERATURE,
      }),
      signal: combinedSignal,
    });
    if (!response.ok) throw new Error(`DeepSeek API error: ${response.status}`);
    const accumulated = await readCompletionStream(response, onChunk);
    combinedSignal.throwIfAborted();
    let result: AnalysisResult;
    try {
      result = parseAnalysisResult(accumulated, input);
    } catch (schemaError) {
      // 流式输出没过 schema 校验：改用非流式补全，把失败输出回灌给模型修复一次。
      console.warn("[backend] DeepSeek stream output failed schema validation, repairing once:", schemaError);
      const repaired = await fetchCompletion(apiKey, [
        ...messages,
        { role: "assistant", content: accumulated.slice(0, MAX_RAW_RESPONSE_LENGTH) },
        { role: "user", content: buildSchemaFeedback(schemaError) },
      ], combinedSignal);
      result = parseAnalysisResult(repaired, input);
    }
    circuitRecordSuccess();
    return result;
  } catch (error) {
    if (signal?.aborted) throw error;
    circuitRecordFailure();
    console.error("[backend] DeepSeek stream failed; using local fallback:", error);
    const fallback = localAnalysisFallback(input);
    onChunk(JSON.stringify(fallback, null, 2), "");
    return fallback;
  }
}

async function readCompletionStream(
  response: Response,
  onChunk: (delta: string, accumulated: string) => void,
): Promise<string> {
  if (!response.body) throw new Error("DeepSeek response body is null");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  let buffer = "";
  function consumeLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let parsed: { choices?: { delta?: { content?: unknown } }[] };
    try {
      parsed = JSON.parse(payload);
    } catch (error) {
      console.error("[deepseek] SSE 行解析失败，已跳过:", error);
      return;
    }
    const delta = parsed?.choices?.[0]?.delta?.content;
    if (typeof delta !== "string" || !delta) return;
    accumulated += delta;
    onChunk(delta, accumulated);
  }
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(consumeLine);
    }
    consumeLine(buffer + decoder.decode());
  } finally {
    reader.releaseLock();
  }
  if (!accumulated.trim()) throw new Error("DeepSeek stream returned no content");
  return accumulated;
}
