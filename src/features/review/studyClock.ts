// When Bugün's numbers must be computed again although nothing was written (v0.5.2, review
// B2): a learning step falls due, the study day changes (day start, default 04:00), or the app
// comes back to the foreground. Dexie live queries only re-run on a write, and on Android and in
// an installed PWA the page is resumed, not reloaded, so without this Bugün stayed stale
// ("Bugünlük tamam" at 21:52 for cards due at 21:40; yesterday's day the next morning).
//
// One shared tick for every screen: each consumer registers the instants it wants to wake at;
// one timer fires at the earliest, and visibilitychange / focus / pageshow tick at once. A slow
// safety tick covers a timer the browser froze or delayed.
import { useEffect, useId, useSyncExternalStore } from 'react';

const SAFETY_MS = 5 * 60_000;
/** Fire a little after the instant, so `Date.now() >= at` holds when the query runs again. */
const WAKE_SLACK_MS = 500;
/** setTimeout's limit (about 24.8 days); later wake-ups are re-armed by the safety tick. */
const MAX_TIMEOUT_MS = 2_147_000_000;

let tick = 0;
const listeners = new Set<() => void>();
const wakes = new Map<string, number[]>();
let timer: ReturnType<typeof setTimeout> | null = null;
let safety: ReturnType<typeof setInterval> | null = null;

function bump(): void {
  tick++;
  for (const l of listeners) l();
  arm();
}

function arm(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  const now = Date.now();
  let next = Infinity;
  for (const list of wakes.values()) for (const at of list) if (at > now && at < next) next = at;
  if (next === Infinity) return;
  timer = setTimeout(bump, Math.min(MAX_TIMEOUT_MS, next - now + WAKE_SLACK_MS));
}

function onVisible(): void {
  if (typeof document === 'undefined' || document.visibilityState === 'visible') bump();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  if (listeners.size === 1 && typeof window !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('pageshow', onVisible);
    safety = setInterval(onVisible, SAFETY_MS);
  }
  return () => {
    listeners.delete(l);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('pageshow', onVisible);
      if (safety !== null) clearInterval(safety);
      safety = null;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    }
  };
}

const snapshot = () => tick;

/**
 * A number that changes whenever time-dependent study numbers may have changed. Pass it as a
 * dependency of the live query; `wakeAt` = instants this screen cares about (the next learning
 * step, the end of the study day).
 */
export function useStudyTick(wakeAt: readonly (number | null | undefined)[] = []): number {
  const id = useId();
  const key = wakeAt.map((x) => x ?? '').join(',');
  useEffect(() => {
    const list = key ? key.split(',').filter(Boolean).map(Number) : [];
    wakes.set(id, list);
    arm();
    return () => {
      wakes.delete(id);
      arm();
    };
  }, [id, key]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Tests: tick as if the app came back to the foreground. */
export function bumpStudyTickForTesting(): void {
  bump();
}
