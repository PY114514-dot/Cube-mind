/**
 * ble/gan-v2-protocol.ts
 * GAN v2/v3 协议层：UUID 常量、包类型与纯解析函数（P1 拆分自 gan-cube-protocol.ts）。
 * v2（GAN 356 i 系列）与 v3（GAN 13/i3）共用同一 service 枚举方式，
 * 仅 service UUID 不同；解密与通知流处理见 gan-v2-handler.ts。
 */

import { CubieCube } from "../utils/mathlib.ts";
import { decodeSignedMagnitude, normalizeGanGyroQuaternion, type GanGyroEvent } from "./gan-gyro-common.ts";

// ============== UUID 定义（与 cstimer 一致） ==============

export const SERVICE_UUID_V2DATA = "6e400001-b5a3-f393-e0a9-e50e24dc4179";
export const SERVICE_UUID_V3DATA = "8653000a-43e6-47b7-9cb0-5fc21d4ae340";

export const CHRCT_UUID_V2READ = "28be4cb6-cd67-11e9-a32f-2a2ae2dbcce4";
export const CHRCT_UUID_V2WRITE = "28be4a4a-cd67-11e9-a32f-2a2ae2dbcce4";

// ============== 类型定义 ==============

export interface GanV2MovePacket {
  moveCnt: number;
  moves: { move: string; timestamp: number; moveCnt: number }[];
}

export interface GanV2CubeStatePacket {
  moveCnt: number;
  facelets: string;
}

// ============== 解析函数 ==============

/** 按设备计数从 v2 的 7 步历史窗口中提取本次通知新增的 move。 */
export function parseGanV2MovePacket(bytes: number[], prevMoveCnt: number): GanV2MovePacket | null {
  const binaryStr = bytes.map((b) => b.toString(2).padStart(8, "0")).join("");
  if (binaryStr.length < 159 || parseInt(binaryStr.slice(0, 4), 2) !== 2) return null;

  const moveCnt = parseInt(binaryStr.slice(4, 12), 2);
  if (prevMoveCnt === -1 || moveCnt === prevMoveCnt) return { moveCnt, moves: [] };

  const moveDiff = (moveCnt - prevMoveCnt) & 0xff;
  const count = Math.min(moveDiff, 7);
  const window: { move: string; timestamp: number }[] = [];
  for (let i = 0; i < count; i++) {
    const encodedMove = parseInt(binaryStr.slice(12 + i * 5, 17 + i * 5), 2);
    if (encodedMove >= 12) return { moveCnt, moves: [] };
    const timestamp = parseInt(binaryStr.slice(47 + i * 16, 63 + i * 16), 2);
    const face = "URFDLB".charAt(encodedMove >> 1);
    window.push({ move: face + ((encodedMove & 1) === 1 ? "'" : ""), timestamp });
  }

  const moves: { move: string; timestamp: number; moveCnt: number }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    moves.push({ ...window[i], moveCnt: (moveCnt - i) & 0xff });
  }
  return { moveCnt, moves };
}

/** 解析 GAN v2 mode 4 局面包；其 moveCnt 是后续动作流的正确基线。 */
export function parseGanV2CubeStatePacket(bytes: number[]): GanV2CubeStatePacket | null {
  const binaryStr = bytes.map((byte) => byte.toString(2).padStart(8, "0")).join("");
  if (binaryStr.length < 102 || parseInt(binaryStr.slice(0, 4), 2) !== 4) return null;
  const cube = new CubieCube();
  let cornerCheck = 0xf00;
  let edgeCheck = 0;
  for (let index = 0; index < 7; index++) {
    const permutation = parseInt(binaryStr.slice(12 + index * 3, 15 + index * 3), 2);
    const orientation = parseInt(binaryStr.slice(33 + index * 2, 35 + index * 2), 2);
    cornerCheck -= orientation << 3;
    cornerCheck ^= permutation;
    cube.ca[index] = (orientation << 3) | permutation;
  }
  cube.ca[7] = ((cornerCheck & 0xff8) % 24) | (cornerCheck & 0x7);
  for (let index = 0; index < 11; index++) {
    const permutation = parseInt(binaryStr.slice(47 + index * 4, 51 + index * 4), 2);
    const orientation = parseInt(binaryStr.slice(91 + index, 92 + index), 2);
    edgeCheck ^= (permutation << 1) | orientation;
    cube.ea[index] = (permutation << 1) | orientation;
  }
  cube.ea[11] = edgeCheck;
  if (cube.verify() !== 0) return null;
  return { moveCnt: parseInt(binaryStr.slice(4, 12), 2), facelets: cube.toFaceCube() };
}

/** 解析 GAN v2 的姿态四元数与三轴角速度（协议 mode=1）。 */
export function parseGanV2GyroPacket(bytes: number[]): Omit<GanGyroEvent, "locTime"> | null {
  const bits = bytes.map((byte) => byte.toString(2).padStart(8, "0")).join("");
  if (bits.length < 80 || parseInt(bits.slice(0, 4), 2) !== 1) return null;
  const read = (start: number, length: number): number => parseInt(bits.slice(start, start + length), 2);
  const quaternion = normalizeGanGyroQuaternion(
    decodeSignedMagnitude(read(4, 16), 15) / 0x7fff,
    decodeSignedMagnitude(read(20, 16), 15) / 0x7fff,
    decodeSignedMagnitude(read(36, 16), 15) / 0x7fff,
    decodeSignedMagnitude(read(52, 16), 15) / 0x7fff,
  );
  if (!quaternion) return null;
  return {
    quaternion,
    velocity: {
      x: decodeSignedMagnitude(read(68, 4), 3),
      y: decodeSignedMagnitude(read(72, 4), 3),
      z: decodeSignedMagnitude(read(76, 4), 3),
    },
  };
}
