import type { Formula } from "./types.ts";
import { F2L_FORMULAS } from "./f2l-formulas.ts";
import { getFormulaSetupMoves, isFormulaDevicePracticeSafe } from "./setup-validation.ts";

const STORAGE_KEY = "cubemind:custom-f2l";

/** 自定义解法必须解出原 case，而不是通过反转自己的公式生成一个新 case。 */
export function validateCustomF2lAlgorithm(formula: Formula, text: string): string[] {
  if (formula.category !== "F2L") throw new Error("只能为 F2L case 保存自定义解法。");
  const moves = text.trim().replace(/[’′]/g, "'").split(/\s+/).filter(Boolean);
  if (moves.length === 0) throw new Error("请先输入公式。");
  if (text.length > 1000 || moves.length > 80) throw new Error("公式最多 80 步、1000 个字符。");
  const invalid = moves.find((move) => !/^[URFDLB][2']?$/.test(move));
  if (invalid) throw new Error(`无法识别 ${invalid}。请用空格分隔 U R F D L B，支持 2 和 '，暂不支持宽转、切片或转体。`);
  if (!isFormulaDevicePracticeSafe({ ...formula, moves, setupMoves: getFormulaSetupMoves(formula) })) {
    throw new Error(`这条公式未能解出 ${formula.id}，或破坏了其他 F2L 槽位。请按卡片的打乱和视角检查公式。`);
  }
  return moves;
}

/** 本机存储同样要检查局面，避免损坏的数据进入专项练习。 */
export function loadCustomF2lAlgorithms(storage: Pick<Storage, "getItem">): Map<string, string[]> {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return new Map();
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("自定义 F2L 数据格式无效。");
  const algorithms = new Map<string, string[]>();
  for (const [id, moves] of Object.entries(value)) {
    const formula = F2L_FORMULAS.find((entry) => entry.id === id);
    if (!formula || !Array.isArray(moves) || !moves.every((move) => typeof move === "string")) {
      throw new Error(`自定义 F2L 数据无效：${id}。`);
    }
    algorithms.set(id, validateCustomF2lAlgorithm(formula, moves.join(" ")));
  }
  return algorithms;
}

/** 写入成功后调用方再替换内存；失败不会丢失此前的解法。 */
export function saveCustomF2lAlgorithms(storage: Pick<Storage, "setItem">, algorithms: Map<string, string[]>): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(algorithms)));
}
