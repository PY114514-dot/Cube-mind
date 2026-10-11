/**
 * ble/moyu-parsers.ts
 * 魔域魔方纯解析层（MHC 明文 + WCU_MY32 加密载荷），无 BLE 副作用，可单元测试。
 *
 * 拆自 moyu-cube-protocol.ts（P1 技术债）：UUID 常量、turn/state/gyro 解析
 * 全部收敛于此，连接生命周期由 moyu-cube-protocol.ts 外观层与各 handler 负责。
 */

import type { CubeQuaternion } from "./cube-driver.ts";

const UUID_SUFFIX = "-0000-1000-8000-00805f9b34fb";
export const MOYU_SERVICE_UUID = `00001000${UUID_SUFFIX}`;
export const MOYU_CHRCT_UUID_READ = `00001002${UUID_SUFFIX}`;
export const MOYU_CHRCT_UUID_TURN = `00001003${UUID_SUFFIX}`;
export const MOYU_CHRCT_UUID_GYRO = `00001004${UUID_SUFFIX}`;

export const MOYU32_SERVICE_UUID = "0783b03e-7735-b5a0-1760-a305d2795cb0";
export const MOYU32_CHRCT_UUID_READ = "0783b03e-7735-b5a0-1760-a305d2795cb1";
export const MOYU32_CHRCT_UUID_WRITE = "0783b03e-7735-b5a0-1760-a305d2795cb2";

/** WCU 广播的 manufacturerData CIC 列表（0x0100..0xFF00，扫描 MAC 用） */
export const MOYU32_CIC_LIST = Array.from({ length: 255 }, (_, i) => (i + 1) << 8);

/** face 编号到 axis 的映射：[3,4,5,1,2,0]（cstimer moyucube.js:84） */
const FACE_TO_AXIS: readonly number[] = [3, 4, 5, 1, 2, 0];
const FACE_NAMES = "URFDLB";

/** 单个 turn 事件的结构化结果 */
export interface ParsedTurn {
  move: string;
  face: number;
  dir: number;
  timestamp: number; // 设备本地时间戳（毫秒）
}

export interface ParsedMoyu32Event {
  type: "info" | "state" | "battery" | "move" | "unknown";
  moveCnt?: number;
  facelets?: string;
  moves?: ParsedTurn[];
  batteryLevel?: number;
  deviceName?: string;
  hardwareVersion?: string;
  softwareVersion?: string;
}

/** WCU_MY32 state 的 144 位贴纸按 FBUDLR 编码，重排为统一的 URFDLB。 */
export function parseMoyu32Facelets(faceletBits: string): string | null {
  if (!/^[01]{144}$/.test(faceletBits)) return null;
  const faces = [2, 5, 0, 3, 4, 1];
  const colors = "FBUDLR";
  const state: string[] = [];
  for (const sourceFace of faces) {
    const source = faceletBits.slice(sourceFace * 24, sourceFace * 24 + 24);
    for (let sticker = 0; sticker < 8; sticker++) {
      const color = colors.charAt(parseInt(source.slice(sticker * 3, sticker * 3 + 3), 2));
      if (!color) return null;
      state.push(color);
      if (sticker === 3) state.push(colors.charAt(sourceFace));
    }
  }
  return state.join("");
}

const MOYU32_GYRO_RESPONSE = 0xab;
const MOYU32_GYRO_SCALE = 1_073_741_824;

/**
 * 解析 WCU_MY32 的姿态通知。DCTimer-BLE 已验证该包为 0xAB + 4 个
 * little-endian int32（w/x/y/z），数值缩放为 2^30。
 */
export function parseMoyu32Gyro(data: number[]): CubeQuaternion | null {
  if (data.length < 17 || data[0] !== MOYU32_GYRO_RESPONSE) return null;
  const bytes = new Uint8Array(data.slice(0, 17));
  const view = new DataView(bytes.buffer);
  const w = view.getInt32(1, true) / MOYU32_GYRO_SCALE;
  const x = view.getInt32(5, true) / MOYU32_GYRO_SCALE;
  const y = view.getInt32(9, true) / MOYU32_GYRO_SCALE;
  const z = view.getInt32(13, true) / MOYU32_GYRO_SCALE;
  const length = Math.hypot(w, x, y, z);
  if (!Number.isFinite(length) || length < 0.0001) return null;
  // WCU 传感器坐标系与页面坐标系不同；映射与 DCTimer-BLE 保持一致。
  return { x: x / length, y: z / length, z: -y / length, w: w / length };
}

/** MHC 陀螺特征值的原始通知；尚未假设未经验证的四元数编码。 */
export interface MoyuGyroRawEvent {
  bytes: number[];
  locTime: number;
}

export type MoyuGyroRawCallback = (event: MoyuGyroRawEvent) => void;

/**
 * 纯函数：解析魔域魔方的 turn 事件 DataView
 * 复刻 cstimer moyucube.js parseTurn()
 *
 * @param data BLE characteristic value DataView
 * @param locTime 浏览器接收时间（Date.now()）
 * @param faceStatus 累计的面状态数组（length=6，跨多次调用保持）
 * @returns 解析出的 move 列表
 */
export function parseTurn(
  data: DataView,
  _locTime: number,
  faceStatus: number[]
): ParsedTurn[] {
  if (data.byteLength < 1) return [];

  const nMoves = data.getUint8(0);
  if (data.byteLength < 1 + nMoves * 6) return [];

  const results: ParsedTurn[] = [];
  for (let i = 0; i < nMoves; i++) {
    const offset = 1 + i * 6;
    // 时间戳：4 字节组合 / 65536 * 1000（>>> 0 强制无符号，避免高位 ≥128 时溢出为负）
    const ts = (
      (data.getUint8(offset + 1) << 24) |
      (data.getUint8(offset + 0) << 16) |
      (data.getUint8(offset + 3) << 8) |
      data.getUint8(offset + 2)
    ) >>> 0;
    const tsMs = Math.round((ts / 65536) * 1000);

    const face = data.getUint8(offset + 4);
    const dir = Math.round(data.getUint8(offset + 5) / 36);

    // 畸形包可能产生 face >= 6，跳过以避免 NaN 污染 faceStatus
    if (face >= 6) continue;

    const prevRot = faceStatus[face];
    const curRot = faceStatus[face] + dir;
    faceStatus[face] = (curRot + 9) % 9;

    // 只有 4→5（顺时针）或 5→4（逆时针）跨越中线时才算有效转动
    let power = 0;
    if (prevRot >= 5 && curRot <= 4) {
      power = 2; // 逆时针 90°
    } else if (prevRot <= 4 && curRot >= 5) {
      power = 0; // 顺时针 90°
    } else {
      continue; // 跨越中线失败，可能是噪声
    }

    const axis = FACE_TO_AXIS[face];
    const suffix = power === 1 ? "2" : power === 2 ? "'" : "";
    const moveStr = FACE_NAMES.charAt(axis) + suffix;

    results.push({
      move: moveStr,
      face,
      dir,
      timestamp: tsMs,
    });
  }

  return results;
}

export function parseMoyu32Data(data: number[], prevMoveCnt: number): ParsedMoyu32Event {
  const binaryStr = data.map((b) => b.toString(2).padStart(8, "0")).join("");
  const msgType = parseInt(binaryStr.slice(0, 8), 2);

  if (msgType === 161) {
    let deviceName = "";
    for (let i = 0; i < 8; i++) {
      deviceName += String.fromCharCode(parseInt(binaryStr.slice(8 + i * 8, 16 + i * 8), 2));
    }
    return {
      type: "info",
      deviceName,
      hardwareVersion: `${parseInt(binaryStr.slice(72, 80), 2)}.${parseInt(binaryStr.slice(80, 88), 2)}`,
      softwareVersion: `${parseInt(binaryStr.slice(88, 96), 2)}.${parseInt(binaryStr.slice(96, 104), 2)}`,
    };
  }

  if (msgType === 163) {
    const facelets = parseMoyu32Facelets(binaryStr.slice(8, 152));
    return {
      type: "state",
      moveCnt: parseInt(binaryStr.slice(152, 160), 2),
      ...(facelets ? { facelets } : {}),
    };
  }

  if (msgType === 164) {
    return {
      type: "battery",
      batteryLevel: parseInt(binaryStr.slice(8, 16), 2),
    };
  }

  if (msgType === 165) {
    const moveCnt = parseInt(binaryStr.slice(88, 96), 2);
    if (moveCnt === prevMoveCnt || prevMoveCnt === -1) {
      return { type: "move", moveCnt, moves: [] };
    }

    const moves: ParsedTurn[] = [];
    let invalidMove = false;
    for (let i = 0; i < 5; i++) {
      const m = parseInt(binaryStr.slice(96 + i * 5, 101 + i * 5), 2);
      const timestamp = parseInt(binaryStr.slice(8 + i * 16, 24 + i * 16), 2);
      if (m >= 12) {
        invalidMove = true;
        continue;
      }
      moves.push({
        move: "FBUDLR".charAt(m >> 1) + ((m & 1) === 1 ? "'" : ""),
        face: m >> 1,
        dir: (m & 1) === 1 ? -1 : 1,
        timestamp,
      });
    }
    return { type: "move", moveCnt, moves: invalidMove ? [] : moves };
  }

  return { type: "unknown" };
}
