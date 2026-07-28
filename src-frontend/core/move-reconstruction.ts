import type { CubeMove } from "../ble/gan-cube-protocol.ts";

export interface MoveLossWarning {
  previousMoveCnt: number;
  currentMoveCnt: number;
  missing: number;
}

export interface PrettyMoveEvent {
  raw: string[];
  pretty: string;
  startIndex: number;
  endIndex: number;
}

const OPPOSITE_FACE: Record<string, string> = {
  U: "D",
  D: "U",
  R: "L",
  L: "R",
  F: "B",
  B: "F",
};

const SLICE_BY_PAIR: Record<string, string> = {
  RL: "M",
  LR: "M",
  UD: "E",
  DU: "E",
  FB: "S",
  BF: "S",
};

const PRETTY_WINDOW_MS = 120;

function suffix(move: string): "" | "2" | "'" {
  return move.endsWith("2") ? "2" : move.endsWith("'") ? "'" : "";
}

function face(move: string): string {
  return move[0]?.toUpperCase() ?? "";
}

function isOuterMove(move: string): boolean {
  return /^[URFDLB][2']?$/.test(move);
}

function inverseSuffix(value: "" | "2" | "'"): "" | "2" | "'" {
  if (value === "'") return "";
  if (value === "") return "'";
  return "2";
}

function maybeSliceMove(first: string, second: string): string | null {
  if (!isOuterMove(first) || !isOuterMove(second)) return null;
  const firstFace = face(first);
  const secondFace = face(second);
  if (OPPOSITE_FACE[firstFace] !== secondFace) return null;
  const firstSuffix = suffix(first);
  const secondSuffix = suffix(second);
  if (firstSuffix === "2" || secondSuffix === "2") return null;
  if (secondSuffix !== inverseSuffix(firstSuffix)) return null;
  const slice = SLICE_BY_PAIR[`${firstFace}${secondFace}`];
  if (!slice) return null;
  return firstSuffix === "'" ? `${slice}'` : slice;
}

export function findMoveLossWarning(previousMoveCnt: number | undefined, currentMoveCnt: number | undefined): MoveLossWarning | null {
  if (previousMoveCnt === undefined || currentMoveCnt === undefined) return null;
  const diff = (currentMoveCnt - previousMoveCnt + 256) & 0xff;
  if (diff <= 1) return null;
  return {
    previousMoveCnt,
    currentMoveCnt,
    missing: diff - 1,
  };
}

export function reconstructPrettyMoves(events: Pick<CubeMove, "move" | "locTime" | "timestamp">[]): PrettyMoveEvent[] {
  const result: PrettyMoveEvent[] = [];
  let index = 0;
  while (index < events.length) {
    const current = events[index];
    const next = events[index + 1];
    if (next) {
      const currentTime = current.locTime ?? current.timestamp;
      const nextTime = next.locTime ?? next.timestamp;
      const gap = Math.abs(nextTime - currentTime);
      const pretty = gap <= PRETTY_WINDOW_MS ? maybeSliceMove(current.move, next.move) : null;
      if (pretty) {
        result.push({ raw: [current.move, next.move], pretty, startIndex: index, endIndex: index + 1 });
        index += 2;
        continue;
      }
    }
    result.push({ raw: [current.move], pretty: current.move, startIndex: index, endIndex: index });
    index += 1;
  }
  return result;
}

export function summarizePrettyReconstruction(events: Pick<CubeMove, "move" | "locTime" | "timestamp">[]): string | null {
  const pretty = reconstructPrettyMoves(events);
  const slices = pretty.filter((event) => event.raw.length > 1);
  if (slices.length === 0) return null;
  const sample = slices.slice(0, 4).map((event) => `${event.raw.join("+")}≈${event.pretty}`).join("，");
  return `检测到 ${slices.length} 处疑似切片/双层手法：${sample}`;
}
