/**
 * src-frontend/ble/gan-crypto-helpers.ts
 * GAN 加密纯函数（可单元测试，不依赖 Web Crypto API）
 */

import { decompressFromEncodedURIComponent } from "../utils/lzstring.ts";

/** cstimer gancube.js:49-56 的 6 个压缩密钥 */
export const GAN_KEYS: string[] = [
  "NoRgnAHANATADDWJYwMxQOxiiEcfYgSK6Hpr4TYCs0IG1OEAbDszALpA",
  "NoNg7ANATFIQnARmogLBRUCs0oAYN8U5J45EQBmFADg0oJAOSlUQF0g",
  "NoRgNATGBs1gLABgQTjCeBWSUDsYBmKbCeMADjNnXxHIoIF0g",
  "NoRg7ANAzBCsAMEAsioxBEIAc0Cc0ATJkgSIYhXIjhMQGxgC6QA",
  "NoVgNAjAHGBMYDYCcdJgCwTFBkYVgAY9JpJYUsYBmAXSA",
  "NoRgNAbAHGAsAMkwgMyzClH0LFcArHnAJzIqIBMGWEAukA",
];

/** 把 MAC 地址字符串转 6 字节数组 */
export function parseMac(mac: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < 6; i++) {
    const hex = mac.slice(i * 3, i * 3 + 2);
    bytes.push(parseInt(hex, 16));
  }
  return bytes;
}

/** 解析 MAC 地址（"AA:BB:CC:DD:EE:FF" → "AA:BB:CC:DD:EE:FF"） */
export function normalizeMac(rawMac: string): string {
  return rawMac.replace(/-/g, ":").toUpperCase();
}

/**
 * 解压 LZString 压缩的 6 字节数组
 */
export function decodeCompressedKey(compressed: string): number[] {
  const str = decompressFromEncodedURIComponent(compressed);
  return JSON.parse(str);
}

/**
 * cstimer getKeyV2 的派生算法（用于测试）
 * 复刻自 cstimer gancube.js:70-79
 *
 * 注意：cstimer KEYS 解压后是 16 字节，但只用了前 6 字节派生
 */
export function deriveV2Key(baseKey: number[], macBytes: number[]): number[] {
  const result: number[] = [];
  for (let i = 0; i < 6; i++) {
    result.push((baseKey[i] + macBytes[5 - i]) % 255);
  }
  return result;
}

/** 获取 v2 协议的基础密钥和 IV（解压后是 16 字节数组） */
export function getV2BaseKeys(ver: number = 0): { key: number[]; iv: number[] } {
  const compressedKey = GAN_KEYS[2 + ver * 2];
  const compressedIv = GAN_KEYS[3 + ver * 2];
  if (!compressedKey || !compressedIv) {
    throw new Error(`GAN 协议变体 ${ver} 不支持`);
  }
  return {
    key: decodeCompressedKey(compressedKey),
    iv: decodeCompressedKey(compressedIv),
  };
}