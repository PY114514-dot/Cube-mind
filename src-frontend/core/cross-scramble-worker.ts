import { scrambleWithCrossSteps } from "./cross-scramble.ts";

interface CrossScrambleRequest {
  targetFace: string;
  targetSteps: number;
}

interface CrossScrambleResult {
  error?: string;
  scramble?: string;
}

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<CrossScrambleRequest>) => void) | null;
  postMessage: (message: CrossScrambleResult) => void;
};

// 高难度 Cross 会反复查询距离表，放到 Worker 中避免阻塞计时器和 3D 视图。
scope.onmessage = (event) => {
  try {
    const { targetFace, targetSteps } = event.data;
    scope.postMessage({
      scramble: scrambleWithCrossSteps(targetSteps, { targetFace, scrambleLength: 20 }),
    });
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
