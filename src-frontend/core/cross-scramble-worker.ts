import { scrambleWithCrossSteps } from "./cross-scramble.ts";

interface CrossScrambleRequest {
  targetFace: string;
  targetSteps: number;
  requestId?: number;
}

interface CrossScrambleResult {
  error?: string;
  scramble?: string;
  requestId?: number;
}

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<CrossScrambleRequest>) => void) | null;
  postMessage: (message: CrossScrambleResult) => void;
};

// 高难度 Cross 会反复查询距离表，放到 Worker 中避免阻塞计时器和 3D 视图。
// Worker 常驻复用：十字距离表按目标面缓存，跨请求共享，避免每次重建。
scope.onmessage = (event) => {
  const { targetFace, targetSteps, requestId } = event.data;
  try {
    scope.postMessage({
      scramble: scrambleWithCrossSteps(targetSteps, { targetFace, scrambleLength: 20 }),
      requestId,
    });
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error), requestId });
  }
};
