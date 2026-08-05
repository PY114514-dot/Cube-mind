/**
 * 设置面板控制器
 * 管理设置弹窗的打开/关闭/保存，以及 AppSettings 的读写。
 * 其他模块通过 getSettings() 获取当前生效设置。
 */

import { loadAppSettings, normalizeAppSettings, saveAppSettings, type AppSettings } from "../core/app-settings.ts";

export interface SettingsElements {
  btnOpenSettings: HTMLButtonElement;
  settingsModal: HTMLDivElement;
  btnCloseSettings: HTMLButtonElement;
  btnSaveSettings: HTMLButtonElement;
  settingCrossSteps: HTMLInputElement;
  settingInspectionEnabled: HTMLInputElement;
  settingInspectionSeconds: HTMLInputElement;
  settingTheme: HTMLSelectElement;
}

export class SettingsController {
  private els: SettingsElements;
  private settings: AppSettings;
  private logFn: (msg: string) => void;

  constructor(elements: SettingsElements, logFn: (msg: string) => void) {
    this.els = elements;
    this.logFn = logFn;
    this.settings = loadAppSettings(localStorage);
  }

  /** 绑定按钮事件并应用初始设置到 DOM */
  init(): void {
    this.els.btnOpenSettings.onclick = () => this.open();
    this.els.btnCloseSettings.onclick = () => this.els.settingsModal.classList.remove("open");
    this.els.btnSaveSettings.onclick = () => this.save();
    this.els.settingInspectionEnabled.onchange = () => {
      this.els.settingInspectionSeconds.disabled = !this.els.settingInspectionEnabled.checked;
    };
    this.applyToDom(this.settings);
  }

  /** 获取当前生效设置（其他模块只读使用） */
  getSettings(): AppSettings {
    return this.settings;
  }

  // ====== 内部 ======

  private open(): void {
    this.applyToDom(this.settings);
    this.els.settingsModal.classList.add("open");
  }

  private save(): void {
    const settings = normalizeAppSettings({
      crossMaxSteps: Number(this.els.settingCrossSteps.value),
      inspectionEnabled: this.els.settingInspectionEnabled.checked,
      inspectionSeconds: Number(this.els.settingInspectionSeconds.value),
      theme: this.els.settingTheme.value as AppSettings["theme"],
    });
    saveAppSettings(localStorage, settings);
    this.settings = settings;
    this.applyToDom(settings);
    this.els.settingsModal.classList.remove("open");
    this.logFn(`设置已保存：十字 ${settings.crossMaxSteps} 步，${settings.inspectionEnabled ? `${settings.inspectionSeconds} 秒观察` : "关闭正常观察"}`);
  }

  private applyToDom(settings: AppSettings): void {
    this.settings = normalizeAppSettings(settings);
    document.body.dataset.uiTheme = this.settings.theme;
    this.els.settingCrossSteps.value = String(this.settings.crossMaxSteps);
    this.els.settingInspectionEnabled.checked = this.settings.inspectionEnabled;
    this.els.settingInspectionSeconds.value = String(this.settings.inspectionSeconds);
    this.els.settingInspectionSeconds.disabled = !this.settings.inspectionEnabled;
    this.els.settingTheme.value = this.settings.theme;
  }
}
