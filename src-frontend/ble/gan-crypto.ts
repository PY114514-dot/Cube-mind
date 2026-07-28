/**
 * src-frontend/ble/gan-crypto.ts
 * GAN v2 BLE 协议 AES-128 解密
 *
 * 浏览器实现：使用 cstimer 同源 JS AES-128 单块实现
 * 真实 GAN 魔方需要此模块才能解密 BLE 数据
 *
 * Chrome Web Crypto 不支持 AES-ECB，因此不能用 crypto.subtle。
 */

import {
  parseMac,
  normalizeMac,
  deriveV2Key,
  getV2BaseKeys,
} from "./gan-crypto-helpers.ts";
import { Aes128 } from "./aes128.ts";

export { parseMac, normalizeMac, deriveV2Key, getV2BaseKeys };
export { GAN_KEYS } from "./gan-crypto-helpers.ts";

/** 解码器 */
export interface GanDecoder {
  key: Uint8Array; // 16 字节原始密钥
  iv: Uint8Array;  // 16 字节初始向量
  decryptBlock(block: Uint8Array): Promise<Uint8Array>;
  encryptBlock(block: Uint8Array): Promise<Uint8Array>;
}

/** cstimer 同源 AES-128 实现 */
class LocalAesDecoder implements GanDecoder {
  private aes: Aes128;

  constructor(
    public key: Uint8Array,
    public iv: Uint8Array,
  ) {
    this.aes = new Aes128(key);
  }

  async decryptBlock(block: Uint8Array): Promise<Uint8Array> {
    return this.aes.decrypt(block);
  }

  async encryptBlock(block: Uint8Array): Promise<Uint8Array> {
    return this.aes.encrypt(block);
  }
}

/**
 * 基于 MAC 地址创建 v2 协议解码器
 *
 * ⚠️ 必须 await createDecoder(mac) 后才能用 decryptBlock/encryptBlock
 *
 * @param mac BLE MAC 地址字符串（"AA:BB:CC:DD:EE:FF"）
 * @param ver 协议变体（0=标准 v2，1=AiCube）
 */
export async function createDecoder(mac: string, ver: number = 0): Promise<GanDecoder> {
  const { key: baseKey, iv: baseIv } = getV2BaseKeys(ver);
  const macBytes = parseMac(mac);

  // cstimer 使用完整 16 字节 key/iv，只根据 MAC 修正前 6 字节。
  const key16 = new Uint8Array(baseKey);
  const iv16 = new Uint8Array(baseIv);
  for (let i = 0; i < 6; i++) {
    key16[i] = (key16[i] + macBytes[5 - i]) % 255;
    iv16[i] = (iv16[i] + macBytes[5 - i]) % 255;
  }

  return new LocalAesDecoder(key16, iv16);
}

/**
 * 解密 BLE characteristic value（复刻 cstimer decode()）
 */
export async function decodeGanValue(
  decoder: GanDecoder,
  value: Uint8Array
): Promise<Uint8Array> {
  const ret = new Uint8Array(value);
  const iv = decoder.iv;

  if (ret.length > 16) {
    const offset = ret.length - 16;
    const tail = await decoder.decryptBlock(ret.slice(offset));
    for (let i = 0; i < 16; i++) {
      ret[offset + i] = (tail[i] ^ iv[i]) & 0xff;
    }
  }

  const head = await decoder.decryptBlock(ret.slice(0, 16));
  for (let i = 0; i < 16; i++) ret[i] = (head[i] ^ iv[i]) & 0xff;
  return ret;
}

/**
 * 加密请求数据（复刻 cstimer encode()）
 */
export async function encodeGanValue(
  decoder: GanDecoder,
  data: number[]
): Promise<number[]> {
  const ret = [...data];
  const iv = decoder.iv;

  for (let i = 0; i < 16; i++) ret[i] = (ret[i] ^ iv[i]) & 0xff;
  const head = await decoder.encryptBlock(new Uint8Array(ret.slice(0, 16)));
  for (let i = 0; i < 16; i++) ret[i] = head[i];

  if (ret.length > 16) {
    const offset = ret.length - 16;
    const block = ret.slice(offset);
    for (let i = 0; i < 16; i++) block[i] = (block[i] ^ iv[i]) & 0xff;
    const tail = await decoder.encryptBlock(new Uint8Array(block));
    for (let i = 0; i < 16; i++) ret[offset + i] = tail[i];
  }

  return ret;
}
