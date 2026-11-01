import { useSyncExternalStore } from 'react';

const MINUTE = 60_000;

// One shared minute timer for every subscriber (v0.5.2: a long list used to start one
// interval per row).
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  timer ??= setInterval(() => {
    for (const l of [...listeners]) l();
  }, MINUTE);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const snapshot = () => Math.floor(Date.now() / MINUTE) * MINUTE;

/** The current time, rounded to the minute and refreshed every minute (for "9 gün önce" labels). */
export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Test hook: how many components listen to the shared timer. */
export function nowListenerCount(): number {
  return listeners.size;
}
