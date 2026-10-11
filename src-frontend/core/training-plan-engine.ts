/**
 * 训练计划规则引擎
 * 纯函数：从历史分析结果聚合问题 → 生成 3-5 天周期计划 → 追踪进度
 */

import type { TrainingPlan, PlanDay, IssueAggregation } from "../../src-shared/training-plan-types.ts";
import type { AnalysisResult } from "../../src-shared/analysis-types.ts";

const SEVERITY_WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1 };

/** 各阶段的默认训练模板（当 AI drills 不足时补充） */
const STAGE_DRILL_TEMPLATES: Record<string, { drills: string[]; target: string }> = {
  Cross: {
    drills: ["盲拧 Cross（只看打乱，不看魔方）", "单手 Cross 练习强化指法记忆", "从 4 步 Cross 开始逐步增加到 6 步"],
    target: "Cross 用时 < 2.5s，步数 ≤ 8",
  },
  F2L: {
    drills: ["慢拧 F2L 专注观察下一对位置", "单槽位重复插入（FR/FL/BR/BL 各 10 次）", "F2L 配对后停顿 1s 再插入，训练 lookahead"],
    target: "F2L TPS ≥ 3.0，单槽最长停顿 < 1.5s",
  },
  OLL: {
    drills: ["每天复习 5 个 OLL 公式（计时）", "慢拧确认手法无误后再加速", "重点练习出现频率最高的 3 个 case"],
    target: "OLL 识别 < 1s，执行 < 2.5s",
  },
  PLL: {
    drills: ["21 个 PLL 公式轮换计时", "A-perm / U-perm 专项（最常用）", "练习从 OLL 完成到 PLL 识别的衔接"],
    target: "PLL 识别 < 0.8s，执行 < 2.0s",
  },
};

/** 只有有标准公式库的阶段才显示一键专项入口。 */
export function isFormulaTrainingStage(stage: string | undefined): stage is "F2L" | "OLL" | "PLL" {
  return stage === "F2L" || stage === "OLL" || stage === "PLL";
}

/** 从最近 N 次分析结果中聚合问题 */
export function aggregateIssues(results: AnalysisResult[]): IssueAggregation {
  const stageCounts: Record<string, number> = {};
  const stageWeights: Record<string, number> = {};
  const issueMap = new Map<string, { description: string; count: number; stage: string }>();

  for (const result of results) {
    // 瓶颈阶段计数
    const stage = result.bottleneckStage || "General";
    stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;

    // issues 加权
    for (const issue of result.issues ?? []) {
      const weight = SEVERITY_WEIGHT[issue.severity] ?? 1;
      stageWeights[issue.stage] = (stageWeights[issue.stage] ?? 0) + weight;
      const key = issue.description.slice(0, 60);
      const existing = issueMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        issueMap.set(key, { description: issue.description, count: 1, stage: issue.stage });
      }
    }
  }

  const topIssues = [...issueMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { stageCounts, stageWeights, topIssues, sampleSize: results.length };
}

/** 确定主要训练目标阶段（加权分最高的阶段） */
export function pickTargetStage(agg: IssueAggregation): string {
  let best = "F2L";
  let bestScore = 0;
  for (const [stage, weight] of Object.entries(agg.stageWeights)) {
    const count = agg.stageCounts[stage] ?? 0;
    const score = weight + count;
    if (score > bestScore) {
      bestScore = score;
      best = stage;
    }
  }
  return best;
}

/** 生成训练计划（3-5 天） */
export function generatePlan(agg: IssueAggregation, latestDrills?: AnalysisResult["drills"]): TrainingPlan {
  const targetStage = pickTargetStage(agg);
  const template = STAGE_DRILL_TEMPLATES[targetStage] ?? STAGE_DRILL_TEMPLATES["F2L"];

  // 天数：样本越多计划越长（3-5 天）
  const dayCount = Math.min(5, Math.max(3, Math.ceil(agg.sampleSize / 2)));

  const days: PlanDay[] = [];
  for (let i = 0; i < dayCount; i++) {
    // 第一天用 AI 给出的 drills（如果有），后续天用模板轮换
    let drills: string[];
    if (i === 0 && latestDrills && latestDrills.length > 0) {
      drills = latestDrills.map((d) => `${d.title}：${d.detail}${d.reps ? `（${d.reps}）` : ""}`);
    } else {
      // 从模板中轮换，每天侧重不同动作
      const offset = i % template.drills.length;
      drills = [
        template.drills[offset],
        template.drills[(offset + 1) % template.drills.length],
      ];
    }
    days.push({
      focus: targetStage,
      drills,
      targetMetric: template.target,
    });
  }

  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);

  return {
    createdAt: now,
    startDate: today,
    days,
    status: "active",
    completedDays: 0,
    lastProgressAt: now,
    targetStage,
    improvementStreak: 0,
  };
}

/**
 * 分析完成后更新计划进度
 * 返回更新后的计划（不可变：返回新对象）
 */
export function updatePlanProgress(plan: TrainingPlan, result: AnalysisResult): TrainingPlan {
  if (plan.status !== "active") return plan;

  const now = Date.now();
  const currentStage = result.bottleneckStage || "General";

  // 瓶颈仍然匹配计划目标 → 训练有效，推进一天
  if (currentStage === plan.targetStage) {
    const completedDays = Math.min(plan.completedDays + 1, plan.days.length);
    const status = completedDays >= plan.days.length ? "graduated" as const : "active" as const;
    return { ...plan, completedDays, lastProgressAt: now, status, improvementStreak: 0 };
  }

  // 瓶颈不再是目标阶段 → 说明有改善
  const improvementStreak = plan.improvementStreak + 1;
  if (improvementStreak >= 3) {
    // 连续 3 次改善 → 毕业
    return { ...plan, improvementStreak, lastProgressAt: now, status: "graduated" };
  }
  return { ...plan, improvementStreak, lastProgressAt: now };
}

/** 计划是否过期（超过 7 天未完成） */
export function isPlanExpired(plan: TrainingPlan): boolean {
  if (plan.status !== "active") return false;
  const elapsed = Date.now() - plan.createdAt;
  return elapsed > 7 * 24 * 60 * 60 * 1000;
}

/** 获取今天应该做的训练（基于 completedDays 索引） */
export function getTodayTask(plan: TrainingPlan): PlanDay | null {
  if (plan.status !== "active") return null;
  const index = Math.min(plan.completedDays, plan.days.length - 1);
  return plan.days[index] ?? null;
}
