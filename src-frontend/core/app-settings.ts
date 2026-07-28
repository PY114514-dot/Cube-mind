/** 本地界面与计时偏好设置。 */

export const APP_SETTINGS_KEY = "cubemind:app-settings";

export interface AppSettings {
  crossMaxSteps: number;
  inspectionEnabled: boolean;
  inspectionSeconds: number;
  theme: "paper" | "ocean" | "forest" | "violet";
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  crossMaxSteps: 8,
  inspectionEnabled: true,
  inspectionSeconds: 15,
  theme: "paper",
};

export function normalizeAppSettings(value: Partial<AppSettings>): AppSettings {
  const theme = value.theme === "ocean" || value.theme === "forest" || value.theme === "violet" || value.theme === "paper"
    ? value.theme
    : DEFAULT_APP_SETTINGS.theme;
  return {
    crossMaxSteps: clampInteger(value.crossMaxSteps, 1, 12, DEFAULT_APP_SETTINGS.crossMaxSteps),
    inspectionEnabled: value.inspectionEnabled ?? DEFAULT_APP_SETTINGS.inspectionEnabled,
    inspectionSeconds: clampInteger(value.inspectionSeconds, 0, 30, DEFAULT_APP_SETTINGS.inspectionSeconds),
    theme,
  };
}

export function loadAppSettings(storage: Storage): AppSettings {
  const raw = storage.getItem(APP_SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_APP_SETTINGS };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { ...DEFAULT_APP_SETTINGS };
    return normalizeAppSettings(parsed);
  } catch (error) {
    console.error("[设置] 读取失败:", error);
    return { ...DEFAULT_APP_SETTINGS };
  }
}

export function saveAppSettings(storage: Storage, settings: AppSettings): void {
  storage.setItem(APP_SETTINGS_KEY, JSON.stringify(normalizeAppSettings(settings)));
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function isRecord(value: unknown): value is Partial<AppSettings> {
  return typeof value === "object" && value !== null;
}
