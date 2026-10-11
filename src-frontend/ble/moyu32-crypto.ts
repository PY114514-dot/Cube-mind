/**
 * ble/moyu32-crypto.ts
 * WCU_MY32 的 AES 编解码层：内置密钥/IV 与 MAC 混合生成 decoder。
 *
 * 拆自 moyu-cube-protocol.ts（P1 技术债）：密钥常量为 WCU 协议专用，
 * 与 MHC 明文路径无耦合，独立成文件避免解析层污染。
 */

import { Aes128 } from "./aes128.ts";
import { decodeCompressedKey } from "./gan-crypto-helpers.ts";
import { parseMac, normalizeMac, type GanDecoder } from "./gan-crypto.ts";

const MOYU32_KEY = "NoJgjANGYJwQrADgjEUAMBmKAWCP4JNIRswt81Yp5DztE1EB2AXSA";
const MOYU32_IV = "NoRg7ANAzArNAc1IigFgqgTB9MCcE8cAbBCJpKgeaSAAxTSPxgC6QA";

class Moyu32Decoder implements GanDecoder {
  private aes: Aes128;

  constructor(public key: Uint8Array, public iv: Uint8Array) {
    this.aes = new Aes128(key);
  }

  async decryptBlock(block: Uint8Array): Promise<Uint8Array> {
    return this.aes.decrypt(block);
  }

  async encryptBlock(block: Uint8Array): Promise<Uint8Array> {
    return this.aes.encrypt(block);
  }
}

/** 用魔方 MAC 地址混合内置密钥，生成 WCU_MY32 专属 decoder。 */
export function createMoyu32Decoder(mac: string): GanDecoder {
  const key = new Uint8Array(decodeCompressedKey(MOYU32_KEY));
  const iv = new Uint8Array(decodeCompressedKey(MOYU32_IV));
  const macBytes = parseMac(normalizeMac(mac));
  for (let i = 0; i < 6; i++) {
    key[i] = (key[i] + macBytes[5 - i]) % 255;
    iv[i] = (iv[i] + macBytes[5 - i]) % 255;
  }
  return new Moyu32Decoder(key, iv);
}
