/**
 * 训练计划引擎的共享类型定义
 * 前后端均可引用（纯类型，无运行时依赖）
 */

/** 计划中某一天的训练安排 */
export interface PlanDay {
  /** 当天聚焦的 CFOP 阶段 */
  focus: string;
  /** 具体训练动作（来自 AI drills 或规则模板） */
  drills: string[];
  /** 目标指标描述（如"F2L TPS ≥ 3.0"或"Cross < 2.5s"） */
  targetMetric: string;
}

/** 训练计划整体状态 */
export type PlanStatus = "active" | "graduated" | "expired";

/** 一次完整的训练计划 */
export interface TrainingPlan {
  /** 计划生成时间戳 */
  createdAt: number;
  /** 计划开始日期（YYYY-MM-DD） */
  startDate: string;
  /** 每天的任务（3-5 天） */
  days: PlanDay[];
  /** 当前状态 */
  status: PlanStatus;
  /** 已完成的训练天数（每次分析后若瓶颈匹配则 +1） */
  completedDays: number;
  /** 最近一次进度更新时间戳 */
  lastProgressAt: number;
  /** 生成此计划时依据的主要瓶颈阶段 */
  targetStage: string;
  /** 连续改善计数（瓶颈不再匹配时累加，达到 3 则毕业） */
  improvementStreak: number;
}

/** 用于生成计划的输入：最近 N 把的问题聚合 */
export interface IssueAggregation {
  /** 各阶段被标记为瓶颈的次数 */
  stageCounts: Record<string, number>;
  /** 各阶段的严重程度加权分（high=3, medium=2, low=1） */
  stageWeights: Record<string, number>;
  /** 出现频率最高的具体问题描述（去重后 top 5） */
  topIssues: Array<{ description: string; count: number; stage: string }>;
  /** 样本总数 */
  sampleSize: number;
}
