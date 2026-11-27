// Getting a web user onto the newest version (review 2026-11-26, #13): "Yenile" activates the
// waiting service worker itself and reloads once it controls the page, and the app looks for a
// new version on startup and whenever it comes back to the foreground, not only hourly.
// No React, router or i18n here, so the steps are unit-tested with fake registrations.

/** Reload anyway when the new worker has not taken over by then (it may be stuck or gone). */
export const RELOAD_FALLBACK_MS = 4000;
/** Hourly check while the app stays open. */
export const UPDATE_INTERVAL_MS = 60 * 60 * 1000;
/** Coming back to the app checks again only after this long since the last check. */
export const UPDATE_MIN_GAP_MS = 60 * 1000;

type Registration = Pick<ServiceWorkerRegistration, 'waiting' | 'update'>;
type Container = Pick<ServiceWorkerContainer, 'addEventListener' | 'removeEventListener'>;

export interface ActivateDeps {
  container: Container;
  reload: () => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
}

const browserDeps = (): ActivateDeps => ({
  container: navigator.serviceWorker,
  reload: () => window.location.reload(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
});

/**
 * Activates the waiting service worker (SKIP_WAITING, which the Workbox worker handles) and
 * reloads when it takes control (controllerchange); reloads after RELOAD_FALLBACK_MS if that
 * never comes, and at once when nothing is waiting. Reloads at most once.
 */
export function activateWaitingAndReload(
  registration: Pick<ServiceWorkerRegistration, 'waiting'> | null | undefined,
  deps: ActivateDeps = browserDeps(),
): void {
  const waiting = registration?.waiting ?? null;
  if (!waiting) {
    deps.reload();
    return;
  }
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    deps.container.removeEventListener('controllerchange', go);
    deps.reload();
  };
  deps.container.addEventListener('controllerchange', go);
  deps.setTimeout(go, RELOAD_FALLBACK_MS);
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

export interface WatchDeps {
  doc: Pick<Document, 'addEventListener' | 'visibilityState'>;
  setInterval: (fn: () => void, ms: number) => unknown;
  now: () => number;
}

const browserWatchDeps = (): WatchDeps => ({
  doc: document,
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  now: () => Date.now(),
});

/**
 * Looks for a new version now (startup), every hour, and when the app becomes visible again
 * (a PWA left in the background for days resumes without a page load), at most once a minute.
 * A failed check (offline) is ignored; the next one tries again.
 */
export function watchForUpdates(
  registration: Registration,
  deps: WatchDeps = browserWatchDeps(),
): void {
  let last = -Infinity;
  const check = () => {
    last = deps.now();
    void registration.update().catch(() => {});
  };
  check();
  deps.setInterval(check, UPDATE_INTERVAL_MS);
  deps.doc.addEventListener('visibilitychange', () => {
    if (deps.doc.visibilityState === 'visible' && deps.now() - last >= UPDATE_MIN_GAP_MS) check();
  });
}
