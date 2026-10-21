import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useSyncExternalStore } from 'react';
import { getMeta, pendingChangesCount, stuckOutboxCount } from '@/data';
import { isBackendConfigured } from '@/lib/supabase';
import type { SyncState } from '@/ui';
import { LAST_SYNC_KEY, type SyncErrorKind } from './engine';
import { engine } from './instance';

export interface SyncStatusInfo {
  /** 'local': guest or signed out; nothing is synced and that is fine. */
  mode: 'local' | 'account';
  state: SyncState;
  /** Outbox rows waiting ("12 değişiklik bekliyor"). */
  pending: number;
  /** Rows that failed 10+ times (plan: warn in the UI). */
  stuck: number;
  lastSyncAt: number | null;
  error: SyncErrorKind | null;
  backendConfigured: boolean;
}

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

/** Pure mapping used by the hook (and tests). */
export function deriveSyncState(x: {
  active: boolean;
  online: boolean;
  running: boolean;
  error: SyncErrorKind | null;
  pending: number;
  stuck: number;
}): SyncState {
  if (!x.active) return 'offline';
  if (!x.online) return 'offline';
  if (x.running) return 'syncing';
  if (x.stuck > 0 || x.error !== null) return 'error';
  if (x.pending > 0) return 'pending';
  return 'synced';
}

export function useSyncStatus(): SyncStatusInfo {
  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const pending = useLiveQuery(() => pendingChangesCount(), []) ?? 0;
  const stuck = useLiveQuery(() => stuckOutboxCount(), []) ?? 0;
  const lastSyncAt = useLiveQuery(async () => (await getMeta<number>(LAST_SYNC_KEY)) ?? null, []) ?? null;
  // Re-evaluate "linked account?" when the indicator mounts (cheap, local only).
  useEffect(() => {
    void engine.isActive();
  }, []);
  const active = snap.active && isBackendConfigured();
  return {
    mode: active ? 'account' : 'local',
    state: deriveSyncState({ active, online, running: snap.running, error: snap.error, pending, stuck }),
    pending,
    stuck,
    lastSyncAt,
    error: snap.error,
    backendConfigured: isBackendConfigured(),
  };
}
