import type { BlePacketRecord } from "../ble/ble-packet-harness.ts";

const live = (moveCnt: number, axisMask: number, power = 0): number[] => [0x01, 0, 0, 0, 0, 0, moveCnt, 0, (power << 6) | axisMask];

export const GAN_V4_STREAM_FIXTURES: Record<"normal" | "combined" | "recovered-gap" | "final-gap", { baseline: number; packets: BlePacketRecord[] }> = {
  normal: { baseline: 9, packets: [{ protocol: "gan-v4", receivedAt: 100, bytes: live(10, 32) }] },
  combined: { baseline: 9, packets: [{ protocol: "gan-v4", receivedAt: 100, bytes: [...live(10, 32), ...live(11, 2, 1)] }] },
  "recovered-gap": {
    baseline: 10,
    packets: [
      { protocol: "gan-v4", receivedAt: 100, bytes: live(13, 32) },
      { protocol: "gan-v4", receivedAt: 120, bytes: [0xd1, 0x02, 0x0c, 0xa8] },
    ],
  },
  "final-gap": {
    baseline: 10,
    packets: [
      { protocol: "gan-v4", receivedAt: 100, bytes: live(13, 32) },
      { protocol: "gan-v4", receivedAt: 120, bytes: [0xd1, 0x01, 0x0d] },
    ],
  },
};
