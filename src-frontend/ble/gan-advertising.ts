/**
 * ble/gan-advertising.ts
 * GAN BLE 广播层：service UUID 枚举、CIC（Company Identifier Code）匹配与 MAC 提取
 * （P1 拆分自 gan-cube-protocol.ts）。连接流程只看 service 列表与 MAC，
 * 各版本协议解析不依赖本文件。
 */

import { SERVICE_UUID_V2DATA, SERVICE_UUID_V3DATA } from "./gan-v2-protocol.ts";
import { SERVICE_UUID_V4DATA } from "./gan-v4-protocol.ts";

const UUID_SUFFIX = "-0000-1000-8000-00805f9b34fb";

const SERVICE_UUID_META = `0000180a${UUID_SUFFIX}`;
const SERVICE_UUID_DATA = `0000fff0${UUID_SUFFIX}`;

/** 连接时请求的全部可选 service（v1 数据/元信息 + v2/v3/v4 数据） */
const ALL_GAN_SERVICES = [
  SERVICE_UUID_DATA,
  SERVICE_UUID_META,
  SERVICE_UUID_V2DATA,
  SERVICE_UUID_V3DATA,
  SERVICE_UUID_V4DATA,
];

const GAN_CIC_LOW_BYTE = 0x01;

/**
 * GAN 的已知 CIC 范围为 0x0001 到 0xFF01，而非高字节固定。
 * 广播扫描时列出全部候选 CIC，浏览器只返回厂商数据命中的设备。
 */
function createGanCicList(): number[] {
  return Array.from({ length: 256 }, (_, index) => (index << 8) | GAN_CIC_LOW_BYTE);
}

export function isGanCompanyIdentifier(companyId: number): boolean {
  return Number.isInteger(companyId)
    && companyId >= 0
    && companyId <= 0xffff
    && (companyId & 0xff) === GAN_CIC_LOW_BYTE;
}

function findGanManufacturerData(data: Map<number, DataView>): DataView | null {
  for (const [companyId, value] of data) {
    if (isGanCompanyIdentifier(companyId) && value.byteLength >= 6) return value;
  }
  return null;
}

/**
 * 从 BLE advertisement 的 manufacturerData 提取 MAC 地址。
 * GAN 魔方通过 CIC 发送 MAC，manufacturerData 前 6 字节反向即为 MAC。
 * 部分系统需 watchAdvertisements 才能拿到厂商数据，故监听广播事件并带超时。
 *
 * @returns MAC 地址（AA:BB:CC:DD:EE:FF 格式）或 null
 */
export async function extractGanMacFromAdvertisement(device: BluetoothDevice): Promise<string | null> {
  const watchAdvertisements = device.watchAdvertisements?.bind(device);
  if (!watchAdvertisements) {
    return null;
  }

  return new Promise((resolve) => {
    const abortController = new AbortController();
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const finish = (mac: string | null): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      device.removeEventListener("advertisementreceived", handler);
      abortController.abort();
      resolve(mac);
    };
    const handler = (event: Event) => {
      const adv = event as unknown as { manufacturerData?: Map<number, DataView> };
      const value = adv.manufacturerData ? findGanManufacturerData(adv.manufacturerData) : null;
      if (!value) return;
      const end = Math.min(value.byteLength, 9);
      const bytes: number[] = [];
      for (let index = 0; index < 6; index++) bytes.push(value.getUint8(end - index - 1));
      finish(bytes.map((byte) => (byte + 0x100).toString(16).slice(1)).join(":"));
    };
    device.addEventListener("advertisementreceived", handler);
    timeout = setTimeout(() => finish(null), 5000);
    watchAdvertisements({ signal: abortController.signal }).catch((error: unknown) => {
      if (!settled) console.warn("[gan-cube] 广播扫描失败:", error);
      finish(null);
    });
  });
}

export { ALL_GAN_SERVICES, SERVICE_UUID_DATA, createGanCicList };
