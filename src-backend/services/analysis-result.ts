import type { AnalysisInput, AnalysisResult, AnalysisIssue, AnalysisDrill } from "../../src-shared/analysis-types.ts";
import { buildCoachingEvidence } from "../../src-shared/analysis-coaching.ts";

const MAX_ANALYSIS_FIELD_LENGTH = 500;
const MAX_RAW_RESPONSE_LENGTH = 1500;
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

function parseIssues(raw: unknown, input: AnalysisInput): AnalysisIssue[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const issues: AnalysisIssue[] = [];
  const evidence = buildCoachingEvidence(input);
  for (const item of raw.slice(0, MAX_ISSUES)) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    const stage = typeof obj.stage === "string" && VALID_STAGES.has(obj.stage) ? obj.stage as AnalysisIssue["stage"] : "General";
    const reference = evidence.find((entry) => entry.id === obj.evidenceId && entry.stage === stage);
    if (!reference) throw new Error("issues.evidenceId must reference supplied evidence for the same stage");
    const description = asBoundedText(obj.description);
    if (description) issues.push({ stage, severity: reference.severity, description,
      evidence: reference.evidence, evidenceId: reference.id });
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

const VALID_FOCUS_STAGES = new Set(["F2L", "OLL", "PLL"]);
const MAX_FOCUS_FORMULAS = 3;
const MAX_FORMULA_ID_LENGTH = 40;

/** 解析公式指派：stage 必填且白名单校验；formulaId 可选（缺失表示阶段级指派）。 */
function parseFocusFormulas(raw: unknown, input: AnalysisInput): AnalysisResult["focusFormulas"] {
  if (!Array.isArray(raw)) return undefined;
  const items: NonNullable<AnalysisResult["focusFormulas"]> = [];
  const candidates = [
    ...(input.practiceSummary ?? []).map((entry) => ({ id: entry.formulaId, stage: entry.category })),
    ...buildCoachingEvidence(input).filter((entry) => entry.caseId).map((entry) => ({ id: entry.caseId, stage: entry.stage })),
  ];
  for (const item of raw.slice(0, MAX_FOCUS_FORMULAS)) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    const stage = typeof obj.stage === "string" && VALID_FOCUS_STAGES.has(obj.stage)
      ? obj.stage as "F2L" | "OLL" | "PLL"
      : null;
    if (!stage) continue;
    const formulaId = typeof obj.formulaId === "string" && obj.formulaId.trim().length > 0 && obj.formulaId.length <= MAX_FORMULA_ID_LENGTH
      ? obj.formulaId.trim()
      : undefined;
    const reason = asBoundedText(obj.reason);
    if (!reason) continue;
    if (formulaId && !candidates.some((entry) => entry.id === formulaId && entry.stage === stage)) {
      throw new Error("focusFormulas.formulaId must reference supplied evidence for the same stage");
    }
    items.push({ stage, formulaId, reason });
  }
  return items.length > 0 ? items : undefined;
}

/** 校验模型返回内容，避免把不可信 JSON 直接带回浏览器。 */
export function parseAnalysisResult(content: string, input: AnalysisInput): AnalysisResult {
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
    issues: parseIssues(result.issues, input),
    drills: parseDrills(result.drills),
    nextFocus: asBoundedText(result.nextFocus) ?? undefined,
    trend: asBoundedText(result.trend) ?? undefined,
    focusFormulas: parseFocusFormulas(result.focusFormulas, input),
  };
}
