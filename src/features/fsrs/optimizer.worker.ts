// Runs the FSRS optimizer off the main thread (docs/decisions/0022). Loaded only when the user
// starts a run; the file is small and precached with the app, so it also works offline.
import { buildDataset, optimizeParams } from '@/domain/fsrsOptimizer';
import type { OptimizerMessage, OptimizerRequest } from './runOptimizer';

const post = (m: OptimizerMessage) => (self as unknown as Worker).postMessage(m);

self.addEventListener('message', (e: MessageEvent<OptimizerRequest>) => {
  try {
    let last = 0;
    const result = optimizeParams(buildDataset(e.data.logs), e.data.input, {
      onProgress: (done, total) => {
        const now = Date.now();
        if (now - last < 100 && done < total) return;
        last = now;
        post({ type: 'progress', done, total });
      },
    });
    post({ type: 'done', result });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
});
