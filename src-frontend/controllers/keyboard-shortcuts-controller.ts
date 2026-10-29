/**
 * src-frontend/controllers/keyboard-shortcuts-controller.ts
 * 键盘快捷键：空格键停止当前计时、Esc 关闭结果/练习/公式库弹窗。
 *
 * 职责边界：
 *   - 只读取按钮禁用态与计时器运行态，不做任何业务决策
 *   - 弹窗关闭走注入的 closeResultModals / history.closeModal，不直接持有控制器
 */

import type { Timer } from "../core/timer.ts";

export interface KeyboardShortcutsElements {
  btnStop: HTMLButtonElement;
  btnCloseLibrary: HTMLButtonElement;
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
      if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey) {
        // 带修饰键的组合键不应触发计时器快捷操作，Alt+A 等组合键交由浏览器或系统处理。
        return;
      }
      if (e.code === "Space" && timer.getState().isRunning && !els.btnStop.disabled) {
        // 公式中的空格与控件自身的按键行为应交给当前焦点处理。
        if (e.target instanceof Element && e.target.closest('input,textarea,select,button,a,summary,[contenteditable],[role="textbox"],[role="button"]')) return;
        e.preventDefault();
        els.btnStop.click();
      }
      if (e.code === "Escape") {
        els.btnCloseLibrary.click();
        closeResultModals();
        els.practiceModeModal.classList.remove("open");
        els.practiceModal.classList.remove("open");
        history.closeModal();
      }
    });
  }

  return { init };
}
