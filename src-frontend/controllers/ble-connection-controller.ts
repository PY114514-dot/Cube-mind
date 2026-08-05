/**
 * BLE 连接控制器（CubeDriver 驱动）
 *
 * 通过 CubeDriver[] 注册表管理所有品牌魔方的连接生命周期。
 * 新增品牌只需：1) 实现 CubeDriver 2) 在 HTML 加对应按钮 3) 注册到 drivers 数组。
 * 业务逻辑（计时、move 处理、断连保护）通过回调注入。
 *
 * 附加能力：
 *   - 自动重连：非用户主动断连时，指数退避尝试 reconnect()（1s→2s→4s，最多 3 次）
 *   - MAC 缺失检测：加密固件连接后 5 秒无 move 数据 → 提示用户输入 MAC
 */

import type { CubeDriver, CubeMove, CubeQuaternion } from "../ble/cube-driver.ts";

/** 每个品牌对应的 DOM 元素槽位 */
export interface DriverSlotElements {
  btnConnect: HTMLButtonElement;
  macInput: HTMLInputElement;
  btnSetMac: HTMLButtonElement;
}

export interface BleControllerElements {
  connectionPanel: HTMLElement;
  connectionMenu: HTMLDetailsElement;
  statusBadge: HTMLElement;
  deviceName: HTMLElement;
  btnDisconnect: HTMLButtonElement;
  /** 按品牌注册的 DOM 槽位 */
  driverSlots: Map<string, DriverSlotElements>;
  /** 头部常驻胶囊圆点（可选） */
  capsuleDot?: HTMLElement;
  /** 头部常驻胶囊文字（可选） */
  capsuleLabel?: HTMLElement;
}

export interface BleControllerCallbacks {
  /** 统一 move 回调（计时、scramble 追踪等） */
  onMove: (move: CubeMove) => void;
  /** 断连时调用（用于中途计时保护） */
  onDisconnect: (brand: string) => void;
  /** 连接成功后调用（用于 confirmCubeReset） */
  onConnected: (brand: string) => void;
  /** 姿态四元数（用于 3D 跟随） */
  onGyroOrientation: (quaternion: CubeQuaternion) => void;
  /** 重置 3D 姿态基准 */
  onResetOrientation: () => void;
  /** 日志 */
  log: (message: string, level?: "info" | "move" | "error") => void;
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const RECONNECT_MAX_ATTEMPTS = 3;
const RECONNECT_BASE_DELAY_MS = 1000;
const MAC_DETECT_TIMEOUT_MS = 5000;

export class BleConnectionController {
  private els: BleControllerElements;
  private cb: BleControllerCallbacks;
  private drivers: CubeDriver[];

  // 自动重连状态
  private userInitiatedDisconnect = false;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private activeDriver: CubeDriver | null = null;

  // MAC 缺失检测
  private macDetectTimer: number | null = null;
  private hasReceivedMove = false;

  constructor(elements: BleControllerElements, callbacks: BleControllerCallbacks, drivers: CubeDriver[]) {
    this.els = elements;
    this.cb = callbacks;
    this.drivers = drivers;
  }

  /** 启动：恢复 MAC、绑定按钮 */
  init(): void {
    for (const driver of this.drivers) {
      const slot = this.els.driverSlots.get(driver.brand);
      if (!slot) continue;
      slot.macInput.value = localStorage.getItem(driver.macStorageKey) ?? "";
      slot.btnConnect.onclick = () => { void this.connectDriver(driver); };
      slot.btnSetMac.onclick = () => { void this.applyMac(driver); };
    }
    this.els.btnDisconnect.onclick = async () => {
      this.userInitiatedDisconnect = true;
      this.cancelReconnect();
      for (const driver of this.drivers) {
        await driver.disconnect();
      }
    };
  }

  /** 获取当前连接设备的 MAC（用于分析输入 deviceId） */
  getDeviceId(): string | undefined {
    for (const driver of this.drivers) {
      const mac = driver.getMacAddress();
      if (mac) return mac;
    }
    return undefined;
  }

  /** 由当前驱动读取实体局面；不支持状态回读的设备返回 null。 */
  async requestCurrentFacelets(): Promise<string | null> {
    return this.activeDriver?.requestFacelets ? this.activeDriver.requestFacelets() : null;
  }

  startPacketRecording(): boolean {
    if (!this.activeDriver?.startPacketRecording) return false;
    this.activeDriver.startPacketRecording();
    return true;
  }

  stopPacketRecording(): boolean {
    if (!this.activeDriver?.stopPacketRecording) return false;
    this.activeDriver.stopPacketRecording();
    return true;
  }

  exportPacketRecording(): string | null {
    return this.activeDriver?.exportPacketRecording?.() ?? null;
  }

  // ====== 内部方法 ======

  private setStatus(state: "disconnected" | "connecting" | "connected", name = ""): void {
    this.els.statusBadge.className = `status ${state}`;
    this.els.statusBadge.textContent =
      state === "connected" ? "已连接" :
      state === "connecting" ? "连接中..." : "未连接";
    this.els.deviceName.textContent = name;
    this.els.btnDisconnect.disabled = state !== "connected";
    if (this.els.capsuleDot) {
      this.els.capsuleDot.className = `capsule-dot ${state === "connected" ? "connected" : state === "connecting" ? "connecting" : ""}`;
    }
    if (this.els.capsuleLabel) {
      this.els.capsuleLabel.textContent =
        state === "connected" ? (name || "已连接") :
        state === "connecting" ? "连接中..." : "未连接";
    }
    if (state === "connected") {
      this.els.connectionMenu.open = false;
    }
  }

  private async connectDriver(driver: CubeDriver): Promise<void> {
    const slot = this.els.driverSlots.get(driver.brand);
    this.userInitiatedDisconnect = false;
    this.cancelReconnect();
    this.setStatus("connecting");
    try {
      this.bindDriverCallbacks(driver);
      const preferredMac = slot?.macInput.value.trim() || undefined;
      await driver.connect(preferredMac);
      this.activeDriver = driver;
      this.reconnectAttempts = 0;
    } catch (err: unknown) {
      this.setStatus("disconnected");
      this.cb.log(`${driver.brand} 连接失败: ${formatError(err)}`, "error");
    }
  }

  /** 绑定驱动回调（connect 和 reconnect 共用） */
  private bindDriverCallbacks(driver: CubeDriver): void {
    const slot = this.els.driverSlots.get(driver.brand);
    let hasReceivedGyro = false;
    this.hasReceivedMove = false;

    driver.onMove((move: CubeMove) => {
      this.hasReceivedMove = true;
      this.cancelMacDetect();
      this.cb.onMove(move);
    });

    driver.onGyro((quaternion: CubeQuaternion) => {
      this.cb.onGyroOrientation(quaternion);
      if (!hasReceivedGyro) {
        hasReceivedGyro = true;
        this.cb.log(`${driver.brand} 姿态跟随已启用`);
      }
    });

    driver.onConnect(() => {
      this.setStatus("connected", driver.getName() || driver.brand);
      this.cb.onResetOrientation();
      this.cb.log(`${driver.brand} 已连接: ${driver.getName()}`);
      const normalizedMac = driver.getMacAddress();
      if (normalizedMac && slot) {
        slot.macInput.value = normalizedMac;
        localStorage.setItem(driver.macStorageKey, normalizedMac);
      }
      this.startMacDetect(driver);
      window.setTimeout(() => this.cb.onConnected(driver.brand), 0);
    });

    driver.onDisconnect(() => {
      this.cancelMacDetect();
      this.cb.onDisconnect(driver.brand);
      this.cb.onResetOrientation();
      this.setStatus("disconnected");
      this.cb.log(`${driver.brand} 已断开`, "error");
      this.scheduleReconnect(driver);
    });

    driver.onBattery((level) => {
      if (Number.isFinite(level)) {
        this.cb.log(`🔋 ${driver.brand} 电量: ${level}%`);
      } else {
        this.cb.log(`${driver.brand} 电量解析失败，请检查 MAC 地址是否正确`, "error");
      }
    });
  }

  // ====== 自动重连 ======

  private scheduleReconnect(driver: CubeDriver): void {
    // 用户主动断开、不支持 reconnect、或已达上限 → 不重连
    if (this.userInitiatedDisconnect) return;
    if (!driver.reconnect) return;
    if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      this.cb.log(`${driver.brand} 自动重连 ${RECONNECT_MAX_ATTEMPTS} 次均失败，请手动连接`, "error");
      return;
    }

    const delay = RECONNECT_BASE_DELAY_MS * (2 ** this.reconnectAttempts);
    this.reconnectAttempts++;
    this.cb.log(`${driver.brand} 将在 ${delay / 1000}s 后尝试重连（第 ${this.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS} 次）...`);
    this.setStatus("connecting");

    this.reconnectTimer = window.setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        this.bindDriverCallbacks(driver);
        await driver.reconnect!();
        this.activeDriver = driver;
        this.reconnectAttempts = 0;
        this.cb.log(`${driver.brand} 重连成功`);
      } catch (err: unknown) {
        this.cb.log(`${driver.brand} 重连失败: ${formatError(err)}`, "error");
        this.setStatus("disconnected");
        this.scheduleReconnect(driver);
      }
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
  }

  // ====== MAC 缺失检测 ======

  /** 加密固件连接后若 5 秒无 move 数据，大概率是 MAC 缺失导致解密失败 */
  private startMacDetect(driver: CubeDriver): void {
    this.cancelMacDetect();
    if (!driver.needsMac) return;
    // 已有 MAC 则无需检测
    if (driver.getMacAddress()) return;

    this.macDetectTimer = window.setTimeout(() => {
      this.macDetectTimer = null;
      if (this.hasReceivedMove) return;
      const slot = this.els.driverSlots.get(driver.brand);
      this.cb.log(
        `⚠ ${driver.brand} 已连接但未收到转动数据。` +
        `该魔方使用加密通信，请输入 MAC 地址（见魔方底部贴纸或官方 App）。`,
        "error",
      );
      // 展开连接面板并聚焦 MAC 输入框，引导用户操作
      if (slot) {
        this.els.connectionMenu.open = true;
        slot.macInput.focus();
        slot.macInput.placeholder = "请输入 MAC，如 AA:BB:CC:DD:EE:FF";
      }
    }, MAC_DETECT_TIMEOUT_MS);
  }

  private cancelMacDetect(): void {
    if (this.macDetectTimer !== null) {
      clearTimeout(this.macDetectTimer);
      this.macDetectTimer = null;
    }
  }

  // ====== MAC 设置 ======

  private async applyMac(driver: CubeDriver): Promise<void> {
    const slot = this.els.driverSlots.get(driver.brand);
    const mac = slot?.macInput.value.trim() ?? "";
    if (!mac) {
      this.cb.log(`请输入 ${driver.brand} MAC 地址，例如 AA:BB:CC:DD:EE:FF`, "error");
      return;
    }
    try {
      await driver.setMacAddress(mac);
      const normalized = driver.getMacAddress() ?? mac;
      if (slot) slot.macInput.value = normalized;
      localStorage.setItem(driver.macStorageKey, normalized);
      this.cb.log(`${driver.brand} MAC 已设置：${normalized}`);
      this.cancelMacDetect();
    } catch (err) {
      this.cb.log(`${driver.brand} MAC 无效：${formatError(err)}`, "error");
    }
  }
}
