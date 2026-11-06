import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useSyncExternalStore } from 'react';
import { getMeta, pendingChangesCount, stuckOutboxCount } from '@/data';
import { useOnline } from '@/lib/online';
import { isBackendConfigured } from '@/lib/supabase';
import type { SyncState } from '@/ui';
import { LAST_SYNC_KEY, SYNC_HELD_KEY, type SyncErrorKind, type SyncHeld } from './engine';
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
  /**
   * Why some rows wait although sync works (decision 0075): the server is nearly full
   * ('storage') or a per-account quota ('texts', 'quota'). null: nothing is held back.
   */
  held: SyncHeld['reason'] | null;
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
  const online = useOnline();
  const active = snap.active && isBackendConfigured();
  const pending = useLiveQuery(() => pendingChangesCount(), []) ?? 0;
  // stuckOutboxCount scans the outbox; a guest's outbox only grows (nothing is pushed) and is
  // never "stuck", so the scan would cost seconds per answer on a large collection.
  const stuck = useLiveQuery(() => (active ? stuckOutboxCount() : 0), [active]) ?? 0;
  const lastSyncAt =
    useLiveQuery(async () => (await getMeta<number>(LAST_SYNC_KEY)) ?? null, []) ?? null;
  const held =
    useLiveQuery(async () => {
      const h = await getMeta<SyncHeld>(SYNC_HELD_KEY);
      return h && h.rows.length > 0 ? h.reason : null;
    }, []) ?? null;
  // Re-evaluate "linked account?" when the indicator mounts (cheap, local only).
  useEffect(() => {
    void engine.isActive();
  }, []);
  return {
    mode: active ? 'account' : 'local',
    state: deriveSyncState({
      active,
      online,
      running: snap.running,
      error: snap.error,
      pending,
      stuck,
    }),
    pending,
    stuck,
    lastSyncAt,
    error: snap.error,
    backendConfigured: isBackendConfigured(),
    held: active ? held : null,
  };
}
