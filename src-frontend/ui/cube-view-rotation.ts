/**
 * ui/cube-view-rotation.ts
 * 3D 视图旋转与设备姿态的纯数学层（无 DOM 依赖，可单元测试）。
 *
 * 拆自 cube-visualizer.ts（P1 技术债）：手动拖拽视角、陀螺仪跟随的
 * 四元数插值、外层动作到 CSS 转层角度的映射全部收敛于此。
 */

import { invertQuaternion, multiplyQuaternion, normalizeQuaternion, slerpQuaternion, type Quaternion } from "../utils/quaternion.ts";

export const FACE_ORDER = ["U", "R", "F", "D", "L", "B"] as const;

// 低于一帧半的跟随时间常数：平滑低频 BLE 通知，同时不让手持转动有明显拖尾。
const ORIENTATION_SMOOTHING_MS = 28;
const SETTLED_QUATERNION_DOT = 0.999995;
const IDENTITY_QUATERNION: DeviceQuaternion = { x: 0, y: 0, z: 0, w: 1 };

export interface FaceTurnAnimation {
  face: string;
  degrees: number;
  duration: number;
}

export interface CubiePosition {
  x: number;
  y: number;
  z: number;
}

/** 与设备协议解耦的单位四元数；首个有效姿态会作为本次持握基准。 */
export interface DeviceQuaternion extends Quaternion {}

/** 将标准外层动作转换为视觉动画参数；其它动作仅同步最终状态。 */
export function getFaceTurnAnimation(move: string): FaceTurnAnimation | null {
  if (!/^[URFDLB](?:2'?|')?$/.test(move)) return null;
  const face = move.charAt(0);
  const isDouble = move.includes("2");
  return { face, degrees: isDouble ? 180 : move.includes("'") ? -90 : 90, duration: isDouble ? 220 : 160 };
}

/**
 * 设备上报的是设备相对世界的姿态，CSS 视图需要观察方向的逆变换。
 * 不做时间插值，避免快速转动时画面持续落后于实体魔方。
 */
export function getDeviceViewRotation(reference: DeviceQuaternion, current: DeviceQuaternion): DeviceQuaternion {
  const deviceRelative = multiplyQuaternion(invertQuaternion(reference), current);
  const viewRelative = invertQuaternion(deviceRelative);
  // CSS 的竖直轴与设备的 Y 轴同向；仅沿用观察逆变换会把实体 Y 映射成 Y'。
  // GAN/MoYu 的俯仰正方向与 CSS 观察俯仰相反；Y 轴已校准正确，仅翻转 X。
  return { x: -viewRelative.x, y: -viewRelative.y, z: viewRelative.z, w: viewRelative.w };
}

/** 将时间常数转换为与帧率无关的插值系数。 */
export function getOrientationSmoothingFactor(elapsedMs: number): number {
  const boundedElapsed = Math.max(0, elapsedMs);
  return 1 - Math.exp(-boundedElapsed / ORIENTATION_SMOOTHING_MS);
}

function isQuaternionSettled(current: DeviceQuaternion, target: DeviceQuaternion): boolean {
  const alignedTarget = current.x * target.x + current.y * target.y + current.z * target.z + current.w * target.w;
  return Math.abs(alignedTarget) >= SETTLED_QUATERNION_DOT;
}

/** 将视觉层的 CSS 旋转提交为新的整数网格坐标。 */
export function rotateCubiePosition(position: CubiePosition, animation: Pick<FaceTurnAnimation, "face" | "degrees">): CubiePosition {
  const face = animation.face.toUpperCase();
  const angle = face === "U" || face === "L" || face === "B" ? -animation.degrees : animation.degrees;
  const quarterTurns = Math.abs(Math.round(angle / 90));
  const positive = angle >= 0;
  let next = { ...position };
  for (let index = 0; index < quarterTurns; index++) next = rotateCssQuarter(next, face, positive);
  return next;
}

function rotateCssQuarter(position: CubiePosition, face: string, positive: boolean): CubiePosition {
  if (face === "U" || face === "D") {
    return positive
      ? { x: position.z, y: position.y, z: -position.x }
      : { x: -position.z, y: position.y, z: position.x };
  }
  if (face === "R" || face === "L") {
    return positive
      ? { x: position.x, y: -position.z, z: position.y }
      : { x: position.x, y: position.z, z: -position.y };
  }
  return positive
    ? { x: -position.y, y: position.x, z: position.z }
    : { x: position.y, y: -position.x, z: position.z };
}

/**
 * CSS 从右向左应用变换：把 rotateY 放在左侧，使其成为不随俯仰翻转的观察轴。
 */
export function getManualViewRotation(rotationX: number, rotationY: number): string {
  return `rotateY(${rotationY}deg) rotateX(${rotationX}deg)`;
}

/** 手动纵向拖拽采用抓握惯例：向下拖动时前面随光标下移，看到更靠上的面。 */
export function getManualPitchAfterDrag(initialRotationX: number, verticalDelta: number, sensitivity = 0.45): number {
  return initialRotationX - verticalDelta * sensitivity;
}

/** 手动水平拖拽：向右拖动时前面随光标右移，看到更靠左的面（与纵向一致的翻转手感）。 */
export function getManualYawAfterDrag(initialRotationY: number, horizontalDelta: number, sensitivity = 0.45): number {
  return initialRotationY + horizontalDelta * sensitivity;
}

function quaternionToCssRotation(quaternion: DeviceQuaternion): string | null {
  const normalized = normalizeQuaternion(quaternion);
  if (!normalized) return null;
  const w = Math.max(-1, Math.min(1, normalized.w));
  const angle = 2 * Math.acos(w);
  const sinHalfAngle = Math.sqrt(Math.max(0, 1 - w * w));
  if (sinHalfAngle < 0.0001 || angle < 0.0001) return "";
  const degrees = (angle * 180) / Math.PI;
  return `rotate3d(${normalized.x / sinHalfAngle}, ${normalized.y / sinHalfAngle}, ${normalized.z / sinHalfAngle}, ${degrees}deg)`;
}

export interface DeviceOrientationFollowerCallbacks {
  onTransformChange: (cssTransform: string) => void;
  onFollowingChange: (following: boolean) => void;
}

/**
 * 陀螺仪跟随状态机：首帧只建立基准；此后每帧向最新目标四元数插值，
 * 平滑 20–30Hz 的 BLE 上报，并在收敛后停止 rAF 循环。
 */
export class DeviceOrientationFollower {
  private reference: DeviceQuaternion | null = null;
  private latest: DeviceQuaternion | null = null;
  private target: DeviceQuaternion | null = null;
  private displayed: DeviceQuaternion | null = null;
  private frame: number | null = null;
  private lastFrameAt: number | null = null;

  constructor(private readonly callbacks: DeviceOrientationFollowerCallbacks) {}

  accept(quaternion: DeviceQuaternion): void {
    const current = normalizeQuaternion(quaternion);
    if (!current) return;
    this.latest = current;
    if (!this.reference) {
      // 刚连接时只建立基准，避免视图突然跳到设备的绝对坐标。
      this.reference = current;
      this.target = IDENTITY_QUATERNION;
      this.displayed = IDENTITY_QUATERNION;
      return;
    }
    this.target = getDeviceViewRotation(this.reference, current);
    this.callbacks.onFollowingChange(true);
    this.scheduleFrame();
  }

  reset(): void {
    if (this.frame !== null) window.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.reference = null;
    this.latest = null;
    this.target = null;
    this.displayed = null;
    this.lastFrameAt = null;
    this.callbacks.onFollowingChange(false);
    this.callbacks.onTransformChange("");
  }

  /** 将当前实体持握定义为零点；用于白上、黄下的用户校准。 */
  calibrate(): boolean {
    if (!this.latest) return false;
    if (this.frame !== null) window.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.lastFrameAt = null;
    this.reference = this.latest;
    this.target = IDENTITY_QUATERNION;
    this.displayed = IDENTITY_QUATERNION;
    this.callbacks.onFollowingChange(false);
    this.callbacks.onTransformChange("");
    return true;
  }

  private scheduleFrame(): void {
    if (this.frame !== null) return;
    this.frame = window.requestAnimationFrame((timestamp) => this.flush(timestamp));
  }

  private flush(timestamp: number): void {
    this.frame = null;
    const target = this.target;
    const displayed = this.displayed;
    if (!target || !displayed) return;
    const elapsed = this.lastFrameAt === null ? 16.67 : Math.min(50, Math.max(1, timestamp - this.lastFrameAt));
    this.lastFrameAt = timestamp;
    // 蓝牙通知通常低于屏幕刷新率；显示姿态每帧向最新目标靠近，消除阶梯感。
    const interpolated = slerpQuaternion(displayed, target, getOrientationSmoothingFactor(elapsed));
    // 插值足够接近目标后直接贴合，避免在停止 rAF 时留下约 0.3° 的长期残余偏转。
    const settled = isQuaternionSettled(interpolated, target);
    const next = settled ? target : interpolated;
    this.displayed = next;
    const rotation = quaternionToCssRotation(next);
    if (rotation === null) return;
    // 零旋转是有效结果：必须清空上一次 CSS 变换，否则实体回正后 3D 仍停在旧姿态。
    this.callbacks.onTransformChange(rotation);
    if (!settled) this.scheduleFrame();
  }
}
