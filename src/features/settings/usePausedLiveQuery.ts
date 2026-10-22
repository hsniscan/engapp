import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useSyncExternalStore } from 'react';
import { isRestoreRunning, subscribeRestoreRunning } from '@/data';

const PAUSED = Symbol('paused');

/** True while a backup restore runs (data/restoreState.ts). */
export function useRestoreRunning(): boolean {
  return useSyncExternalStore(subscribeRestoreRunning, isRestoreRunning, isRestoreRunning);
}

/**
 * useLiveQuery for views that scan whole tables: while a restore runs it reads nothing (so the
 * restore's chunk commits do not re-run it) and keeps showing the last result; it runs again
 * once the restore ends.
 */
export function usePausedLiveQuery<T>(querier: () => Promise<T> | T, deps: unknown[]): T | undefined {
  const restoring = useRestoreRunning();
  const last = useRef<T | undefined>(undefined);
  const value = useLiveQuery<T | typeof PAUSED>(
    () => (restoring ? PAUSED : querier()),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the caller's deps plus the flag
    [restoring, ...deps],
  );
  if (value !== undefined && value !== PAUSED) last.current = value;
  return value === PAUSED || value === undefined ? last.current : value;
}
