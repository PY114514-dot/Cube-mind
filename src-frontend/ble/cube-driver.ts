/**
 * CubeDriver —— 智能魔方统一驱动接口
 *
 * 所有品牌协议（GAN / 魔域 / 奇艺 / Tornado）实现此接口后，
 * BleConnectionController 只需遍历已注册的 driver 即可完成连接管理，
 * 新增品牌无需修改 controller 主逻辑。
 */

/** 姿态四元数（与 GanGyroEvent.quaternion 结构一致） */
export interface CubeQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export type CubePacketProtocol = "gan-v2" | "gan-v4" | "moyu-turn" | "moyu32";

/** BLE 通知诊断快照；解密失败时仍会保留 rawBytes。 */
export interface CubePacketEvent {
  protocol: CubePacketProtocol;
  receivedAt: number;
  mode: number | null;
  rawBytes: number[];
  decodedBytes?: number[];
}

/** 品牌无关的单次转动事件。 */
export interface CubeMove {
  move: string;
  timestamp: number;
  locTime: number;
  moveCnt: number;
}

/** 协议明确知道无法恢复的动作缺口；用于隔离 CFOP/AI，但不否定实体成绩。 */
export interface CubeMoveStreamGap {
  missing: number;
  previousMoveCnt: number;
  nextMoveCnt: number;
}

export type CubeMoveCallback = (move: CubeMove) => void;
export type CubeMoveStreamGapCallback = (gap: CubeMoveStreamGap) => void;
export type CubeErrorCallback = (message: string) => void;
export type CubeGyroCallback = (quaternion: CubeQuaternion) => void;
export type CubePacketCallback = (event: CubePacketEvent) => void;
export type CubeConnectCallback = () => void;
export type CubeDisconnectCallback = () => void;
export type CubeBatteryCallback = (level: number) => void;

/**
 * 统一驱动接口。
 * 每个品牌实现一个 class 并导出单例（如 ganCube、moyuCube）。
 */
export interface CubeDriver {
  /** 品牌标识，用于日志和 UI 显示（如 "GAN"、"魔域"） */
  readonly brand: string;

  /** 是否需要 MAC 地址才能解密（MHC 明文 = false，GAN/MoYu32 = true） */
  readonly needsMac: boolean;

  /** 是否支持陀螺仪姿态跟随 */
  readonly supportsGyro: boolean;

  /** 发起 BLE 连接（弹出设备选择器） */
  connect(preferredMac?: string): Promise<void>;

  /** 断开连接并清理资源 */
  disconnect(): Promise<void>;

  /** 注册 move 回调（统一 CubeMove 格式） */
  onMove(cb: CubeMoveCallback): void;

  /** 注册动作流最终缺口回调；未能确认时品牌驱动可不触发。 */
  onMoveStreamGap?(cb: CubeMoveStreamGapCallback): void;

  /** 可恢复或需要断开的设备错误，供连接控制器显示给用户。 */
  onError?(cb: CubeErrorCallback): void;

  /** 注册姿态回调（不支持陀螺仪的品牌可留空实现） */
  onGyro(cb: CubeGyroCallback): void;

  /** 注册 BLE 包回调，仅用于诊断。 */
  onPacket?(cb: CubePacketCallback): void;

  /** 注册连接成功回调 */
  onConnect(cb: CubeConnectCallback): void;

  /** 注册断连回调 */
  onDisconnect(cb: CubeDisconnectCallback): void;

  /** 注册电量回调（不支持的品牌可留空实现） */
  onBattery(cb: CubeBatteryCallback): void;

  /** 主动读取设备当前 54 位 facelet；协议不支持时返回 null。 */
  requestFacelets?(): Promise<string | null>;

  /** 无可验证实体局面时，连续动作流可否作为计时成绩的保守兜底（不授予 CFOP/AI）。 */
  allowsUnverifiedMoveScore?(): boolean;

  /** 开始仅存于内存的 BLE 通知录制，供缺步问题复盘。 */
  startPacketRecording?(): void;
  stopPacketRecording?(): void;
  exportPacketRecording?(): string | null;
  /** 导出可固化为回放测试的匿名已解密 fixture。 */
  exportReplayFixture?(): string | null;

  /** 获取设备广播名 */
  getName(): string | null;

  /** 获取当前已设置的 MAC（未设置返回 null） */
  getMacAddress(): string | null;

  /**
   * 设置/更新 MAC 地址。
   * 对已连接设备，实现方应重新初始化解密器并刷新状态。
   */
  setMacAddress(mac: string): void | Promise<void>;

  /**
   * 尝试重连到之前已授权的设备（不弹选择器）。
   * 若设备对象已丢失或不支持，返回 rejected Promise。
   * 可选——不支持时 controller 不会尝试自动重连。
   */
  reconnect?(): Promise<void>;

  /** localStorage 持久化 key（如 "cubemind:gan-mac"） */
  readonly macStorageKey: string;
}
