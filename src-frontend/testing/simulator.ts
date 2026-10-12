import "../bootstrap.ts";
import "./simulator.css";
import { ganCube } from "./simulated-cube.ts";
import { parseMoveList } from "../core/scramble-tracker.ts";
import type { AnalysisInput } from "../../src-shared/analysis-types.ts";
import { HISTORY_STORAGE_KEY } from "../core/history-store.ts";

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`[模拟验收] 缺少页面元素 ${selector}`);
  return found;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("[模拟验收] 页面状态等待超时");
    await delay(40);
  }
}

function remainingMoves(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>("#scramble-text .scramble-move:not(.completed)"))
    .map((move) => move.textContent?.trim() ?? "").filter(Boolean);
}

async function sendMoves(moves: string[]): Promise<void> {
  for (const move of moves) {
    // 半转拆为两次通知，覆盖实体设备的打乱半转追踪。
    const turns = move.endsWith("2") ? [move[0], move[0]] : [move];
    for (const turn of turns) {
      ganCube.turn(turn);
      await delay(80);
    }
  }
}

function records(): AnalysisInput[] {
  return JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) ?? "[]") as AnalysisInput[];
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[模拟验收] ${message}`);
}

async function prepareNormalSolve(): Promise<void> {
  const group = element<HTMLSelectElement>("#history-group");
  group.value = "normal";
  group.dispatchEvent(new Event("change"));
  element<HTMLButtonElement>("#btn-close-cfop").click();
  element<HTMLButtonElement>("#btn-next-scramble").click();
  await waitFor(() => remainingMoves().length > 0);
  await sendMoves(remainingMoves());
  await waitFor(() => !element("#inspection-status").hidden);
}

async function checkCancellation(): Promise<void> {
  const before = localStorage.getItem(HISTORY_STORAGE_KEY);
  await prepareNormalSolve();
  ganCube.holdReads = true;
  await sendMoves(ganCube.getSolution());
  await waitFor(() => ganCube.pendingReadCount > 0);
  element<HTMLButtonElement>("#btn-reset").click();
  ganCube.releaseReads();
  await delay(500);
  assert(localStorage.getItem(HISTORY_STORAGE_KEY) === before, "重置后旧回读保存了成绩");
  assert(element("#timer-display").textContent === "0.00", "旧回读覆盖了重置后的计时");
}

async function checkNormalSolve(): Promise<void> {
  const before = localStorage.getItem(HISTORY_STORAGE_KEY);
  await prepareNormalSolve();
  await sendMoves(ganCube.getSolution());
  await waitFor(() => localStorage.getItem(HISTORY_STORAGE_KEY) !== before);
  const solves = records();
  const solve = solves[solves.length - 1];
  assert(solve?.trustState === "analysis-ready", "常规复原未得到可信的动作分析");
  assert(solve?.physicalState === "confirmed-solved", "常规复原未确认还原");
  assert(element("#stat-last").textContent !== "—", "首页上一把未刷新");
  assert(Number(element("#stat-count").textContent) > 0, "首页本组次数未刷新");
  assert(element("#stat-ao5").textContent === element("#history-ao5").textContent, "首页与历史 AO5 不一致");
  await sendMoves(["R", "U", "U'"]);
  await waitFor(() => remainingMoves().length > 0);
  assert(remainingMoves()[0] === "R'", "成绩结束后的动作没有带入下一轮过渡打乱");
}

async function checkPractice(): Promise<void> {
  element<HTMLButtonElement>("#btn-close-cfop").click();
  element<HTMLButtonElement>("#btn-open-library").click();
  element<HTMLButtonElement>('[data-cat="F2L"]').click();
  const start = element<HTMLButtonElement>('[data-practice-formula="F2L-01"]');
  const algorithm = start.closest(".formula-card")?.querySelector(".primary .algorithm-moves")?.textContent ?? "";
  start.click();
  element<HTMLInputElement>("#practice-count").value = "2";
  element<HTMLButtonElement>("#btn-start-practice").click();
  await sendMoves(remainingMoves());
  await waitFor(() => !element("#inspection-status").hidden);
  let before = localStorage.getItem(HISTORY_STORAGE_KEY);
  await sendMoves(["U"]);
  element<HTMLButtonElement>("#btn-stop").click();
  await waitFor(() => localStorage.getItem(HISTORY_STORAGE_KEY) !== before);
  let solves = records();
  assert(solves[solves.length - 1]?.practiceOutcome === "failed", "未还原 CASE 被误报成功");
  assert(!element("#btn-retry-practice").hidden, "失败后缺少重试入口");
  element<HTMLButtonElement>("#btn-retry-practice").click();
  for (let attempt = 1; attempt <= 2; attempt++) {
    await sendMoves(remainingMoves());
    await waitFor(() => !element("#inspection-status").hidden);
    before = localStorage.getItem(HISTORY_STORAGE_KEY);
    await sendMoves(parseMoveList(algorithm));
    await waitFor(() => localStorage.getItem(HISTORY_STORAGE_KEY) !== before);
    solves = records();
    assert(solves[solves.length - 1]?.practiceOutcome === "success", `第 ${attempt} 次专项没有成功`);
  }
  assert(element("#result-next-action").textContent?.includes("本轮训练完成") ?? false, "连续专项未结束");
  assert(element("#practice-banner").hidden, "专项完成后横幅未关闭");
}

async function selfCheck(status: HTMLElement): Promise<void> {
  assert(ganCube.connected, "请先连接模拟魔方，并确认已还原");
  assert(ganCube.getSolution().length === 0, "请先逆序还原模拟魔方再运行自检");
  assert(element("#practice-banner").hidden, "请先终止正在进行的专项练习");
  status.textContent = "自检 1/3：重置取消旧回读…";
  await checkCancellation();
  status.textContent = "自检 2/3：常规复原与可信成绩…";
  await checkNormalSolve();
  status.textContent = "自检 3/3：失败重试与连续两次 F2L 专项…";
  await checkPractice();
  status.textContent = "自检通过 · 成绩、换轮与 F2L 训练正常";
}

function init(): void {
  const status = element("#sim-status");
  const panel = element("#simulator");
  const updateConnection = (): void => {
    const connection = element("#sim-connection-state");
    connection.dataset.connected = String(ganCube.connected);
    connection.textContent = ganCube.connected ? "模拟魔方已连接" : "模拟魔方未连接";
  };
  // 连接菜单也能断开设备，状态由正式控制器的显示结果同步。
  new MutationObserver(updateConnection).observe(element("#status"), { attributes: true, attributeFilter: ["class"] });
  updateConnection();
  element<HTMLButtonElement>("#sim-toggle-tools").onclick = () => {
    const tools = element("#sim-tools");
    tools.hidden = !tools.hidden;
    element("#sim-toggle-tools").setAttribute("aria-expanded", String(!tools.hidden));
  };
  const bind = (id: string, action: () => Promise<void>): void => {
    element<HTMLButtonElement>(id).onclick = async () => {
      const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>("button:not(#sim-toggle-tools):not(#sim-hold):not(#sim-release):not(#sim-disconnect)"));
      buttons.forEach((button) => { button.disabled = true; });
      status.dataset.state = "working";
      try { await action(); status.dataset.state = "success"; }
      catch (error) {
        console.error("[模拟验收]", error);
        status.textContent = error instanceof Error ? error.message.replace(/^\[模拟验收\]\s*/, "") : String(error);
        status.dataset.state = "error";
      } finally { buttons.forEach((button) => { button.disabled = false; }); updateConnection(); }
    };
  };
  element<HTMLButtonElement>("#btn-connect-gan").textContent = "连接模拟魔方";
  element<HTMLButtonElement>("#btn-connect-moyu").disabled = true;
  document.querySelectorAll<HTMLButtonElement>('[id*="ble-diagnostics"], #btn-export-ble-replay').forEach((button) => { button.disabled = true; });
  document.querySelectorAll<HTMLElement>(".mac-row").forEach((row) => { row.style.display = "none"; });
  bind("#sim-connect", async () => {
    if (!ganCube.connected) element<HTMLButtonElement>("#btn-connect-gan").click();
    status.textContent = "模拟魔方已就绪，可开始自检或公式练习";
  });
  bind("#sim-scramble", async () => { await sendMoves(remainingMoves()); status.textContent = "打乱已发送"; });
  bind("#sim-solve", async () => { await sendMoves(ganCube.getSolution()); status.textContent = "逆序还原已发送"; });
  bind("#sim-send", async () => {
    const moves = parseMoveList(element<HTMLInputElement>("#sim-moves").value);
    await sendMoves(moves);
    status.textContent = `已发送 ${moves.length} 步动作`;
  });
  // 延迟与释放按钮在动作播放时仍可操作，方便复现取消和断连竞态。
  element<HTMLButtonElement>("#sim-hold").onclick = () => {
    ganCube.holdReads = true;
    status.dataset.state = "idle";
    status.textContent = "后续局面回读已挂起；可重置或断连，再释放旧回读";
  };
  element<HTMLButtonElement>("#sim-release").onclick = () => {
    ganCube.releaseReads();
    status.dataset.state = "idle";
    status.textContent = "旧回读已释放";
  };
  element<HTMLButtonElement>("#sim-disconnect").onclick = async () => {
    await ganCube.disconnect();
    updateConnection();
    status.dataset.state = "idle";
    status.textContent = "模拟魔方已断开，重新连接即可继续";
  };
  bind("#sim-gyro", async () => {
    ganCube.orient({ x: 0, y: Math.sin(Math.PI / 8), z: 0, w: Math.cos(Math.PI / 8) });
    status.textContent = "已发送 45° 姿态；可测试持握校准和视角复位";
  });
  bind("#sim-check", () => selfCheck(status));
}

document.addEventListener("DOMContentLoaded", init, { once: true });
