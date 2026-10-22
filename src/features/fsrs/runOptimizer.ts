// Main-thread side of the optimizer worker. Without Worker support (tests, very old browsers)
// the same pure code runs inline.
import {
  buildDataset,
  type DatasetLog,
  optimizeParams,
  type OptimizeInput,
  type OptimizeResult,
} from '@/domain/fsrsOptimizer';

export interface OptimizerRequest {
  logs: DatasetLog[];
  input: OptimizeInput;
}

export type OptimizerMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; result: OptimizeResult }
  | { type: 'error'; message: string };

/** The worker file could not be loaded (e.g. offline before the app finished caching). */
export class OptimizerUnavailableError extends Error {
  constructor() {
    super('optimizer_unavailable');
  }
}

export function runOptimizer(
  req: OptimizerRequest,
  onProgress: (fraction: number) => void,
): Promise<OptimizeResult> {
  if (typeof Worker === 'undefined') {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          resolve(
            optimizeParams(buildDataset(req.logs), req.input, {
              onProgress: (d, t) => onProgress(d / t),
            }),
          );
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      }, 0);
    });
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./optimizer.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.addEventListener('message', (e: MessageEvent<OptimizerMessage>) => {
      const m = e.data;
      if (m.type === 'progress') {
        onProgress(m.total > 0 ? m.done / m.total : 0);
        return;
      }
      worker.terminate();
      if (m.type === 'done') resolve(m.result);
      else reject(new Error(m.message));
    });
    worker.addEventListener('error', () => {
      worker.terminate();
      reject(new OptimizerUnavailableError());
    });
    worker.postMessage(req);
  });
}
