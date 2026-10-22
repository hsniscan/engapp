// "A restore is running" flag (decision 0025). A restore commits a few hundred chunk
// transactions; every commit re-runs each live query that reads the touched tables. Views
// that scan all cards or logs (load forecast, FSRS helper and optimizer counts) pause while
// the flag is set (features/settings/usePausedLiveQuery.ts) and re-run once at the end.

let running = 0;
const listeners = new Set<() => void>();

const emit = () => {
  for (const l of listeners) l();
};

export function isRestoreRunning(): boolean {
  return running > 0;
}

export function subscribeRestoreRunning(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Run `fn` with the flag set (nesting-safe). */
export async function whileRestoring<T>(fn: () => Promise<T>): Promise<T> {
  running++;
  if (running === 1) emit();
  try {
    return await fn();
  } finally {
    running--;
    if (running === 0) emit();
  }
}
