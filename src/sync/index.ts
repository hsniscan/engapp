// App-wide sync engine instance and its triggers. Other features call:
//   requestSync()  after something worth syncing soon (e.g. the end of a review session)
//   syncNow()      the "Şimdi senkronla" button (ignores per-row backoff)
//   useSyncStatus() for the indicator / settings
import { liveQuery } from 'dexie';
import { db } from '@/data';
import { isBackendConfigured } from '@/lib/supabase';
import { CHANGE_DEBOUNCE_MS, isIdleOutcome, nextPollDelayMs, type SyncOutcome } from './engine';
import { engine } from './instance';

export { SyncEngine, runSync, type SyncOutcome, type SyncReport, type SyncTransport } from './engine';
export { useSyncStatus, type SyncStatusInfo } from './status';

export { engine };

let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Ask for a sync soon (debounced a little so bursts of writes become one push). Safe to call
 * from anywhere, any number of times, in guest mode too (it does nothing then).
 */
export function requestSync(delayMs = 300): void {
  if (!isBackendConfigured()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void engine.sync();
  }, delayMs);
}

/** "Şimdi senkronla": run immediately, retrying rows that are waiting for their backoff. */
export function syncNow(): Promise<SyncOutcome> {
  return engine.sync({ force: true });
}

let stop: (() => void) | null = null;

/** Starts the triggers once (idempotent). Returns a stop function (tests). */
export function startSyncEngine(): () => void {
  if (stop) return stop;
  if (!isBackendConfigured() || typeof window === 'undefined') return () => {};
  const visible = () => document.visibilityState === 'visible';
  // Background polls back off while nothing changes (decision 0060); any other trigger
  // (visible again, online, a local write) starts over at the short interval.
  let idleRuns = 0;
  let stopped = false;
  let poll: ReturnType<typeof setTimeout> | null = null;
  const onOnline = () => {
    engine.setState({ online: true });
    idleRuns = 0;
    requestSync(0);
  };
  const onOffline = () => engine.setState({ online: false });
  const schedule = () => {
    if (poll) clearTimeout(poll);
    if (stopped) return;
    poll = setTimeout(() => {
      poll = null;
      if (!visible()) return schedule();
      void engine.sync().then((o) => {
        idleRuns = isIdleOutcome(o) ? idleRuns + 1 : 0;
        schedule();
      });
    }, nextPollDelayMs(idleRuns));
  };
  const wake = () => {
    idleRuns = 0;
    schedule();
  };
  const onVisible = () => {
    if (visible()) {
      wake();
      requestSync(0);
    }
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVisible);
  schedule();

  // Local writes: push a few seconds after the outbox grows.
  let lastCount = -1;
  const sub = liveQuery(() => db.outbox.count()).subscribe({
    next: (n) => {
      if (lastCount >= 0 && n > lastCount) {
        requestSync(CHANGE_DEBOUNCE_MS);
        wake();
      }
      lastCount = n;
    },
    error: () => {},
  });

  requestSync(0); // app open
  stop = () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    document.removeEventListener('visibilitychange', onVisible);
    stopped = true;
    if (poll) clearTimeout(poll);
    sub.unsubscribe();
    stop = null;
  };
  return stop;
}
