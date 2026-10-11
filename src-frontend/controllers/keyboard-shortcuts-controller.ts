/**
 * src-frontend/controllers/keyboard-shortcuts-controller.ts
 * 键盘快捷键：空格键启停计时、Esc 关闭结果/练习/公式库弹窗。
 *
 * 职责边界：
 *   - 只读取按钮禁用态与计时器运行态，不做任何业务决策
 *   - 弹窗关闭走注入的 closeResultModals / history.closeModal，不直接持有控制器
 */

import type { Timer } from "../core/timer.ts";

export interface KeyboardShortcutsElements {
  btnStart: HTMLButtonElement;
  btnStop: HTMLButtonElement;
  libraryModal: HTMLDivElement;
  practiceModeModal: HTMLDivElement;
  practiceModal: HTMLDivElement;
}

export interface KeyboardShortcutsDependencies {
  timer: Timer;
  closeResultModals: () => void;
  history: {
    closeModal(): void;
  };
}

export function createKeyboardShortcutsController(
  els: KeyboardShortcutsElements,
  deps: KeyboardShortcutsDependencies,
): { init(): void } {
  const { timer, closeResultModals, history } = deps;

  function init(): void {
    document.addEventListener("keydown", (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) {
        // 带修饰键的组合键不应触发计时器快捷操作，Alt+A 等组合键交由浏览器或系统处理。
        return;
      }
      if (e.code === "Space" && (!els.btnStart.disabled || !els.btnStop.disabled)) {
        e.preventDefault();
        if (timer.getState().isRunning) els.btnStop.click();
        else if (!els.btnStart.disabled) els.btnStart.click();
      }
      if (e.code === "Escape") {
        els.libraryModal.classList.remove("open");
        closeResultModals();
        els.practiceModeModal.classList.remove("open");
        els.practiceModal.classList.remove("open");
        history.closeModal();
      }
    });
  }

  return { init };
}
