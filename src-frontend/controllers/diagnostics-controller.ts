/**
 * src-frontend/controllers/diagnostics-controller.ts
 * BLE 诊断面板：录制开关、诊断包/回放夹具导出，以及本地真机采样控制台入口。
 *
 * 职责边界：
 *   - 不依赖具体连接控制器，录制/导出走 deps.ble 结构化接口
 *   - 真机采样控制台入口走 deps.debugHarness（GAN 原始协议实例），不触碰 UI 状态
 */

import type { AppState } from "../core/app-state.ts";

export interface DiagnosticsElements {
  btnToggleBleDiagnostics: HTMLButtonElement;
  btnExportBleDiagnostics: HTMLButtonElement;
  btnExportBleReplay: HTMLButtonElement;
  bleDiagnosticsStatus: HTMLElement;
}

export interface DiagnosticsBleDeps {
  startPacketRecording(): boolean;
  stopPacketRecording(): boolean;
  exportPacketRecording(): string | null;
  exportReplayFixture(): string | null;
}

export interface DiagnosticsDebugHarnessDeps {
  startPacketRecording(): void;
  stopPacketRecording(): void;
  exportPacketRecording(): string;
}

export interface DiagnosticsControllerDependencies {
  ble: DiagnosticsBleDeps;
  debugHarness: DiagnosticsDebugHarnessDeps;
}

export function createDiagnosticsController(
  els: DiagnosticsElements,
  state: AppState,
  deps: DiagnosticsControllerDependencies,
): { init(): void } {
  const { ble, debugHarness } = deps;

  function downloadJson(content: string, filename: string): void {
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function init(): void {
    els.btnToggleBleDiagnostics.addEventListener("click", () => {
      if (state.diagnostics.isBleRecording) {
        if (!ble.stopPacketRecording()) {
          els.bleDiagnosticsStatus.textContent = "当前连接设备不支持 BLE 原始包录制。";
          return;
        }
        state.diagnostics.isBleRecording = false;
        els.btnToggleBleDiagnostics.textContent = "开始诊断录制";
        els.bleDiagnosticsStatus.textContent = "录制已停止，可导出 JSON 并反馈给开发者。";
        return;
      }
      if (!ble.startPacketRecording()) {
        els.bleDiagnosticsStatus.textContent = "当前连接设备不支持 BLE 原始包录制。";
        return;
      }
      state.diagnostics.isBleRecording = true;
      els.btnToggleBleDiagnostics.textContent = "停止诊断录制";
      els.bleDiagnosticsStatus.textContent = "正在录制 BLE 原始包；请复现一次缺步后停止并导出。";
    });

    els.btnExportBleDiagnostics.addEventListener("click", () => {
      const recording = ble.exportPacketRecording();
      if (!recording) {
        els.bleDiagnosticsStatus.textContent = "暂无可导出的诊断包，请先连接 GAN 并开始录制。";
        return;
      }
      downloadJson(recording, `cubemind-ble-diagnostic-${Date.now()}.json`);
      els.bleDiagnosticsStatus.textContent = "诊断 JSON 已导出；可附在缺步反馈中。";
    });

    els.btnExportBleReplay.addEventListener("click", () => {
      const fixture = ble.exportReplayFixture();
      if (!fixture) {
        els.bleDiagnosticsStatus.textContent = "暂无可导出的回放夹具，请先连接魔方并完成诊断录制。";
        return;
      }
      downloadJson(fixture, `cubemind-ble-replay-${Date.now()}.json`);
      els.bleDiagnosticsStatus.textContent = "匿名回放夹具已导出；可直接用于 GAN/WCU 缺步回归测试。";
    });

    // 本地真机采样入口：不写入 localStorage，只把当前内存中的 BLE 通知导出为 JSON。
    const debugGlobal = globalThis as typeof globalThis & {
      __cubemindGanDiagnostics?: {
        start: () => void;
        stop: () => void;
        export: () => string;
      };
    };
    debugGlobal.__cubemindGanDiagnostics = {
      start: () => debugHarness.startPacketRecording(),
      stop: () => debugHarness.stopPacketRecording(),
      export: () => debugHarness.exportPacketRecording(),
    };
  }

  return { init };
}
