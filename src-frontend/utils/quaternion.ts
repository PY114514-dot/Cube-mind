/** 设备姿态使用的最小四元数工具，避免在 UI 内部重复实现数学细节。 */
export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export function normalizeQuaternion(quaternion: Quaternion): Quaternion | null {
  const { x, y, z, w } = quaternion;
  if (![x, y, z, w].every(Number.isFinite)) return null;
  const length = Math.hypot(x, y, z, w);
  if (length < 0.000001) return null;
  return { x: x / length, y: y / length, z: z / length, w: w / length };
}

export function invertQuaternion(quaternion: Quaternion): Quaternion {
  return { x: -quaternion.x, y: -quaternion.y, z: -quaternion.z, w: quaternion.w };
}

export function multiplyQuaternion(left: Quaternion, right: Quaternion): Quaternion {
  return {
    x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
    w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
  };
}

/** q 和 -q 代表同一姿态；统一符号后才能避免插值跨越整圈。 */
export function alignQuaternionHemisphere(reference: Quaternion, value: Quaternion): Quaternion {
  const dot = reference.x * value.x + reference.y * value.y + reference.z * value.z + reference.w * value.w;
  return dot < 0 ? { x: -value.x, y: -value.y, z: -value.z, w: -value.w } : value;
}

export function slerpQuaternion(from: Quaternion, to: Quaternion, factor: number): Quaternion {
  const target = alignQuaternionHemisphere(from, to);
  const dot = Math.max(-1, Math.min(1, from.x * target.x + from.y * target.y + from.z * target.z + from.w * target.w));
  if (dot > 0.9995) {
    return normalizeQuaternion({
      x: from.x + (target.x - from.x) * factor,
      y: from.y + (target.y - from.y) * factor,
      z: from.z + (target.z - from.z) * factor,
      w: from.w + (target.w - from.w) * factor,
    }) ?? from;
  }
  const theta = Math.acos(dot);
  const sinTheta = Math.sin(theta);
  const fromWeight = Math.sin((1 - factor) * theta) / sinTheta;
  const toWeight = Math.sin(factor * theta) / sinTheta;
  return {
    x: from.x * fromWeight + target.x * toWeight,
    y: from.y * fromWeight + target.y * toWeight,
    z: from.z * fromWeight + target.z * toWeight,
    w: from.w * fromWeight + target.w * toWeight,
  };
}
