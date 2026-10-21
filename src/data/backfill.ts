// One-time re-pull of tables a device learned about late. A device running an older app
// version pulls rows of tables it does not know yet (sync_pull_v3 returns every registered
// table), drops them as invalid and moves its cursor past them. When the app update adds the
// table, the Dexie upgrade records it here and the sync engine pulls the table's rows again
// from the start (src/sync/engine.ts, pullBackfill). Kept apart from meta.ts so db.ts can
// use it inside an upgrade transaction.
import type { Table } from 'dexie';
import type { MetaRow } from '../domain/types';

export const PULL_BACKFILL_KEY = 'pull_backfill';
const SYNC_CURSOR_KEY = 'sync_cursor';

/**
 * Inside a Dexie upgrade: remember `tables` for a one-time re-pull, but only when this device
 * has pulled before (cursor > 0); a fresh pull from 0 brings every row anyway.
 */
export async function addPullBackfill(meta: Table<MetaRow, string>, tables: string[]): Promise<void> {
  const cursor = (await meta.get(SYNC_CURSOR_KEY))?.value;
  if (typeof cursor !== 'number' || cursor <= 0) return;
  const cur = (await meta.get(PULL_BACKFILL_KEY))?.value;
  const list = Array.isArray(cur) ? cur.filter((x): x is string => typeof x === 'string') : [];
  await meta.put({ key: PULL_BACKFILL_KEY, value: [...new Set([...list, ...tables])] });
}
