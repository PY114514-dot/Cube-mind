import type {
  CubeDriver, CubeMoveCallback, CubeConnectCallback, CubeDisconnectCallback,
  CubeBatteryCallback, CubeGyroCallback, CubeQuaternion,
} from "../ble/cube-driver.ts";
import { CubieCube, SOLVED_FACELET, parseMove } from "../utils/mathlib.ts";
import { invertMove } from "../core/scramble-tracker.ts";

/** 仅供独立验收构建使用；动作仍经过正式连接控制器与计时流水线。 */
export class SimulatedCube implements CubeDriver {
  readonly brand = "GAN";
  readonly needsMac = false;
  readonly supportsGyro = true;
  readonly macStorageKey = "cubemind:simulator-mac";
  connected = false;
  holdReads = false;
  private cube = new CubieCube();
  private moves: string[] = [];
  private moveCount = 0;
  private moveCallback?: CubeMoveCallback;
  private connectCallback?: CubeConnectCallback;
  private disconnectCallback?: CubeDisconnectCallback;
  private batteryCallback?: CubeBatteryCallback;
  private gyroCallback?: CubeGyroCallback;
  private pendingReads: { facelets: string; resolve: (value: string | null) => void }[] = [];

  async connect(): Promise<void> {
    this.connected = true;
    this.connectCallback?.();
    this.batteryCallback?.(100);
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    this.disconnectCallback?.();
    this.releaseReads();
  }

  onMove(callback: CubeMoveCallback): void { this.moveCallback = callback; }
  onConnect(callback: CubeConnectCallback): void { this.connectCallback = callback; }
  onDisconnect(callback: CubeDisconnectCallback): void { this.disconnectCallback = callback; }
  onBattery(callback: CubeBatteryCallback): void { this.batteryCallback = callback; }
  onGyro(callback: CubeGyroCallback): void { this.gyroCallback = callback; }
  getName(): string { return "模拟魔方"; }
  getMacAddress(): null { return null; }
  setMacAddress(): void { throw new Error("[模拟魔方] 无需 MAC 地址"); }
  get pendingReadCount(): number { return this.pendingReads.length; }

  async requestFacelets(): Promise<string | null> {
    if (!this.connected) return null;
    const facelets = this.cube.toFaceCube();
    if (!this.holdReads) return facelets;
    return new Promise((resolve) => this.pendingReads.push({ facelets, resolve }));
  }

  releaseReads(): void {
    this.holdReads = false;
    const reads = this.pendingReads.splice(0);
    for (const read of reads) read.resolve(this.connected ? read.facelets : null);
  }

  turn(move: string): void {
    if (!this.connected) throw new Error("[模拟魔方] 请先连接模拟魔方");
    this.cube = this.cube.applyMove(parseMove(move));
    this.moves.push(move);
    if (this.cube.toFaceCube() === SOLVED_FACELET) this.moves = [];
    const now = Date.now();
    this.moveCallback?.({ move, moveCnt: ++this.moveCount, timestamp: now, locTime: now });
  }

  getSolution(): string[] { return this.moves.slice().reverse().map(invertMove); }

  orient(quaternion: CubeQuaternion): void {
    if (!this.connected) throw new Error("[模拟魔方] 请先连接模拟魔方");
    this.gyroCallback?.(quaternion);
  }
}

// 构建别名替换正式 GAN 驱动，主页面装配与回调保持原样。
export const ganCube = new SimulatedCube();
