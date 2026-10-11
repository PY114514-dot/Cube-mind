/**
 * ble/gan-v4-protocol.ts
 * GAN v4 协议层：UUID 常量、包类型与纯解析函数（P1 拆分自 gan-cube-protocol.ts）。
 * 通知流与历史补偿见 gan-v4-handler.ts。
 */

import { CubieCube } from "../utils/mathlib.ts";
import { decodeSignedMagnitude, normalizeGanGyroQuaternion, type CubeQuaternion } from "./gan-gyro-common.ts";

// ============== UUID 定义（与 cstimer 一致） ==============

export const SERVICE_UUID_V4DATA = "00000010-0000-fff7-fff6-fff5fff4fff0";

export const CHRCT_UUID_V4READ = "0000fff6-0000-1000-8000-00805f9b34fb";
export const CHRCT_UUID_V4WRITE = "0000fff5-0000-1000-8000-00805f9b34fb";

// ============== 类型定义 ==============

export interface GanV4CubeStatePacket {
  moveCnt: number;
  facelets: string;
}

/** 已解码的 GAN v4 实体局面；供录包回放校验实时动作与状态快照是否一致。 */
export interface GanV4DecodedCubeStatePacket extends GanV4CubeStatePacket {
  cube: CubieCube;
}

export interface GanHistoryMove {
  move: string;
  moveCnt: number;
}

export interface GanV4MoveHistoryPacket {
  startMoveCnt: number;
  moves: GanHistoryMove[];
}

/** GAN v4 0xEC 姿态包；四元数布局与 DCTimer-BLE 的公开实现一致。 */
export interface GanV4GyroPacket {
  mode: 0xec;
  declaredLength: number;
  bytes: number[];
  payload: number[];
  quaternion: CubeQuaternion;
}

export interface GanV4GyroPacketEvent extends GanV4GyroPacket {
  rawBytes: number[];
  locTime: number;
}

export type GanV4GyroPacketCallback = (event: GanV4GyroPacketEvent) => void;

// ============== 解析函数 ==============

/**
 * GAN v4 的 0xED 会用于动作流诊断，但部分固件不能可靠代表当前实体局面。
 * 不能将其作为计分、初始基线或 3D 覆盖的真值；GAN v2 的已验证局面包不受影响。
 */
export function supportsGanFaceletVerification(protocol: "v2" | "v4"): boolean {
  return protocol === "v2";
}

/** GAN v4 0xED 局面包与 cstimer 的角棱编码一致，但字段偏移不同。 */
export function decodeGanV4CubeStatePacket(bytes: readonly number[]): GanV4DecodedCubeStatePacket | null {
  const binaryStr = bytes.map((byte) => byte.toString(2).padStart(8, "0")).join("");
  if (binaryStr.length < 124 || parseInt(binaryStr.slice(0, 8), 2) !== 0xed) return null;
  const cube = new CubieCube();
  let cornerCheck = 0xf00;
  let edgeCheck = 0;
  for (let index = 0; index < 7; index++) {
    const permutation = parseInt(binaryStr.slice(32 + index * 3, 35 + index * 3), 2);
    const orientation = parseInt(binaryStr.slice(53 + index * 2, 55 + index * 2), 2);
    cornerCheck -= orientation << 3;
    cornerCheck ^= permutation;
    cube.ca[index] = (orientation << 3) | permutation;
  }
  cube.ca[7] = ((cornerCheck & 0xff8) % 24) | (cornerCheck & 0x7);
  for (let index = 0; index < 11; index++) {
    const permutation = parseInt(binaryStr.slice(69 + index * 4, 73 + index * 4), 2);
    const orientation = parseInt(binaryStr.slice(113 + index, 114 + index), 2);
    edgeCheck ^= (permutation << 1) | orientation;
    cube.ea[index] = (permutation << 1) | orientation;
  }
  cube.ea[11] = edgeCheck;
  if (cube.verify() !== 0) return null;
  const moveCnt = parseInt(binaryStr.slice(24, 32) + binaryStr.slice(16, 24), 2);
  return { moveCnt, facelets: cube.toFaceCube(), cube };
}

/** GAN v4 0xED 局面包与 cstimer 的角棱编码一致，但字段偏移不同。 */
export function parseGanV4CubeStatePacket(bytes: number[]): GanV4CubeStatePacket | null {
  const decoded = decodeGanV4CubeStatePacket(bytes);
  if (!decoded) return null;
  return { moveCnt: decoded.moveCnt, facelets: decoded.facelets };
}

export function parseGanV4MoveHistoryPacket(bytes: number[]): GanV4MoveHistoryPacket | null {
  const binaryStr = bytes.map((b) => b.toString(2).padStart(8, "0")).join("");
  if (binaryStr.length < 24 || parseInt(binaryStr.slice(0, 8), 2) !== 0xd1) return null;
  const len = parseInt(binaryStr.slice(8, 16), 2);
  const startMoveCnt = parseInt(binaryStr.slice(16, 24), 2);
  const numberOfMoves = Math.max(0, (len - 1) * 2);
  const moves: GanHistoryMove[] = [];
  for (let i = 0; i < numberOfMoves; i++) {
    const axis = parseInt(binaryStr.slice(24 + 4 * i, 27 + 4 * i), 2);
    const pow = parseInt(binaryStr.slice(27 + 4 * i, 28 + 4 * i), 2);
    if (axis < 6) {
      moves.push({
        move: "DUBFLR".charAt(axis) + (pow === 1 ? "'" : ""),
        moveCnt: (startMoveCnt - i) & 0xff,
      });
    }
  }
  return { startMoveCnt, moves };
}

/**
 * GAN v4 0xEC 包的四元数从第 16 bit 开始，每个分量为 16 位符号-幅值数。
 * 第二字节按协议原样保留，供诊断导出和后续校验。
 */
export function parseGanV4GyroPacket(bytes: readonly number[]): GanV4GyroPacket | null {
  if (bytes.length < 10 || bytes[0] !== 0xec) return null;
  const bits = bytes.map((byte) => byte.toString(2).padStart(8, "0")).join("");
  const read = (start: number): number => parseInt(bits.slice(start, start + 16), 2);
  const quaternion = normalizeGanGyroQuaternion(
    decodeSignedMagnitude(read(16), 15) / 0x7fff,
    decodeSignedMagnitude(read(32), 15) / 0x7fff,
    decodeSignedMagnitude(read(48), 15) / 0x7fff,
    decodeSignedMagnitude(read(64), 15) / 0x7fff,
  );
  if (!quaternion) return null;
  const declaredLength = bytes[1];
  return {
    mode: 0xec,
    declaredLength,
    bytes: [...bytes],
    payload: Array.from(bytes.slice(2)),
    quaternion,
  };
}
