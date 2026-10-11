/**
 * ble/gan-gyro-common.ts
 * GAN v2/v4 共用的姿态解析层：四元数类型、符号-幅值解码与轴映射归一化。
 * v2（mode=1）与 v4（0xEC）姿态包的字段布局不同，但分量编码与坐标系约定一致，
 * 拆出共享逻辑避免两处重复实现（P1 拆分自 gan-cube-protocol.ts）。
 */

/** 姿态四元数（与 cube-driver 的 CubeQuaternion 结构一致） */
export interface CubeQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface GanGyroEvent {
  quaternion: CubeQuaternion;
  velocity: { x: number; y: number; z: number };
  locTime: number;
}

export type GyroCallback = (event: GanGyroEvent) => void;

/** 解析 16 位符号-幅值数；最高位是符号，其余位是幅值（GAN 陀螺仪分量编码）。 */
function decodeSignedMagnitude(value: number, magnitudeBits: number): number {
  const sign = value >> magnitudeBits;
  const magnitude = value & ((1 << magnitudeBits) - 1);
  return sign === 0 ? magnitude : -magnitude;
}

/**
 * GAN 传感器轴映射到页面坐标系（x→x、y→z、z→−y），与 DCTimer-BLE 的 v2/v4 实现保持一致；
 * 归一化后拒绝零向量（传感器未就绪时会发全零包）。
 */
function normalizeGanGyroQuaternion(w: number, x: number, y: number, z: number): CubeQuaternion | null {
  const length = Math.hypot(w, x, y, z);
  if (!Number.isFinite(length) || length < 0.000001) return null;
  const normalizeZero = (value: number): number => value === 0 ? 0 : value;
  return {
    x: normalizeZero(x / length),
    y: normalizeZero(z / length),
    z: normalizeZero(-y / length),
    w: normalizeZero(w / length),
  };
}

export { decodeSignedMagnitude, normalizeGanGyroQuaternion };
