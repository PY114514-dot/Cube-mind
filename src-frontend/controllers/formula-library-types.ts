/**
 * 公式库控制器的共享类型：元素映射、回调签名与渲染上下文依赖的状态。
 * 独立成文件避免 controller 与 renderer 之间产生循环依赖。
 */
import type { Formula, FormulaCategory } from "../formula/types.ts";
import type { PracticeRecord } from "../core/practice-stats.ts";

export interface FormulaLibraryElements {
  libraryModal: HTMLDivElement;
  libraryContent: HTMLDivElement;
  libraryTitle: HTMLHeadingElement;
  btnCloseLibrary: HTMLButtonElement;
  btnOpenLibrary: HTMLButtonElement;
  practiceModal: HTMLDivElement;
  practiceFormulaName: HTMLElement;
  practiceCount: HTMLInputElement;
}

export interface FormulaLibraryCallbacks {
  log: (msg: string, level?: "info" | "move" | "error") => void;
  onStartPractice: (formula: Formula, target: number, candidates: Formula[], order: "random" | "sequential") => void;
  getPracticeRecords: () => PracticeRecord[];
}

export interface LibraryState {
  category: FormulaCategory;
  search: string;
  hideMastered: boolean;
}

export interface PendingPractice {
  formula: Formula;
  candidates: Formula[];
  order: "random" | "sequential";
}

export interface SpeedCubeDbAlternativesResponse {
  alternatives: Record<string, string[][]>;
  source: "SpeedCubeDB";
}
