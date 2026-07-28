import type { GanV2ReplayPacket } from "../ble/gan-v2-replay.ts";

function createGanV2MovePacket(moveCnt: number, moveCodes: number[]): number[] {
  const bits = Array.from({ length: 20 * 8 }, () => "0");
  const write = (start: number, length: number, value: number): void => {
    const encoded = value.toString(2).padStart(length, "0");
    for (let index = 0; index < length; index++) bits[start + index] = encoded[index];
  };
  write(0, 4, 2);
  write(4, 8, moveCnt);
  for (let index = 0; index < 7; index++) {
    write(12 + index * 5, 5, moveCodes[index] ?? 12);
    write(47 + index * 16, 16, index + 1);
  }
  return bits.reduce<number[]>((bytes, _bit, index) => {
    if (index % 8 === 0) bytes.push(parseInt(bits.slice(index, index + 8).join(""), 2));
    return bytes;
  }, []);
}

/** 模拟真机重复发送 moveCnt=31 的历史窗口。 */
export const GAN_V2_DUPLICATE_WINDOW_FIXTURE: GanV2ReplayPacket[] = [
  { receivedAt: 1_000, bytes: createGanV2MovePacket(30, [0]) },
  { receivedAt: 1_010, bytes: createGanV2MovePacket(31, [0]) },
  { receivedAt: 1_020, bytes: createGanV2MovePacket(31, [0]) },
  { receivedAt: 1_030, bytes: createGanV2MovePacket(32, [2]) },
];
