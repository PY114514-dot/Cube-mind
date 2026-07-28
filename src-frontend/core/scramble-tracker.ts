/**
 * core/scramble-tracker.ts
 * 智能魔方打乱进度追踪。
 */

import { moveToStr, parseMove } from "../utils/mathlib.ts";

export interface ScrambleProgress {
  completed: string[];
  remaining: string[];
  lastMoveCorrect: boolean | null;
  pendingHalfTurn?: string;
}

export function createScrambleProgress(scramble: string): ScrambleProgress {
  return {
    completed: [],
    remaining: parseMoveList(scramble),
    lastMoveCorrect: null,
  };
}

export function applyScrambleMove(progress: ScrambleProgress, move: string): ScrambleProgress {
  const normalizedMove = normalizeMove(move);
  const expectedMove = progress.remaining[0];

  if (progress.pendingHalfTurn) {
    const pending = progress.pendingHalfTurn;
    if (canCombineToHalfTurn(pending, normalizedMove, expectedMove)) {
      return {
        completed: [...progress.completed, expectedMove],
        remaining: progress.remaining.slice(1),
        lastMoveCorrect: true,
      };
    }

    return {
      completed: progress.completed,
      remaining: [invertMove(pending), invertMove(normalizedMove), ...progress.remaining],
      lastMoveCorrect: false,
    };
  }

  if (!expectedMove) {
    return {
      ...progress,
      lastMoveCorrect: null,
    };
  }

  if (normalizedMove === expectedMove) {
    return {
      completed: [...progress.completed, expectedMove],
      remaining: progress.remaining.slice(1),
      lastMoveCorrect: true,
    };
  }

  if (expectedMove.endsWith("2") && canStartHalfTurn(normalizedMove, expectedMove)) {
    return {
      completed: progress.completed,
      remaining: progress.remaining,
      pendingHalfTurn: normalizedMove,
      lastMoveCorrect: null,
    };
  }

  return {
    completed: progress.completed,
    remaining: [invertMove(normalizedMove), ...progress.remaining],
    lastMoveCorrect: false,
  };
}

export function invertMove(move: string): string {
  const normalizedMove = normalizeMove(move);
  if (normalizedMove.endsWith("2")) return normalizedMove;
  if (normalizedMove.endsWith("'")) return normalizedMove.slice(0, -1);
  return `${normalizedMove}'`;
}

export function parseMoveList(sequence: string): string[] {
  return sequence
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeMove);
}

function normalizeMove(move: string): string {
  return moveToStr(parseMove(move));
}

function canStartHalfTurn(move: string, expectedMove: string): boolean {
  return move[0] === expectedMove[0] && !move.endsWith("2");
}

function canCombineToHalfTurn(firstMove: string, secondMove: string, expectedMove: string | undefined): expectedMove is string {
  if (!expectedMove || !expectedMove.endsWith("2")) return false;
  if (!canStartHalfTurn(firstMove, expectedMove) || !canStartHalfTurn(secondMove, expectedMove)) return false;
  return firstMove === secondMove;
}
