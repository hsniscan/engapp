// Linking this device's local data to a signed-in account (plan, "Hesap"):
//   - first sign-in: stamp user_id on local rows and queue them (adoptGuestData)
//   - the account already has data (second device): merge (default), discard local data,
//     or discard the account's data.
import type { Millis, Note } from '../domain/types';
import { db } from './db';
import { adoptGuestData } from './maintenance';
import { getMeta, META, setMeta } from './meta';
import { SETTINGS_ID } from './settings';
import { type MutableRows, type MutableTable, writeTx } from './writer';

const MUTABLE: MutableTable[] = ['notes', 'senses', 'cards', 'sources', 'settings'];

/** Data the user created on this device (settings alone do not count). */
export async function hasLocalUserData(): Promise<boolean> {
  const [notes, logs, sources] = await Promise.all([db.notes.count(), db.review_logs.count(), db.sources.count()]);
  return notes + logs + sources > 0;
}

/** user_id the local rows belong to (null: guest data). */
export async function getLinkedUserId(): Promise<string | null> {
  return (await getMeta<string | null>(META.userId)) ?? null;
}

/**
 * Give every local row to `userId` and queue it for push. Guest rows go through
 * adoptGuestData; rows of another account that signed in on this device earlier are
 * re-stamped the same way. Cursors restart at 0 so the account's rows are pulled.
 */
export async function claimLocalData(userId: string, now: Millis = Date.now()): Promise<number> {
  const previous = await getLinkedUserId();
  if (previous === userId) return 0;
  await db.transaction('rw', db.meta, async () => {
    await setMeta(META.syncCursor, 0);
    await setMeta(META.lexiconCursor, 0);
  });
  if (previous === null) return adoptGuestData(userId, now);
  await db.transaction('rw', db.meta, () => setMeta(META.userId, userId));
  return writeTx([db.notes, db.senses, db.cards, db.review_logs, db.sources, db.settings], now, async (w) => {
    let n = 0;
    for (const table of MUTABLE) {
      const rows = (await db.table(table).toArray()) as MutableRows[MutableTable][];
      for (const row of rows) {
        if (row.user_id !== userId) {
          await w.put(table, { ...row, user_id: userId });
          n++;
        }
      }
    }
    for (const log of await db.review_logs.toArray()) {
      w.enqueue('review_logs', log.id, 'upsert', log);
      n++;
    }
    return n;
  });
}

/**
 * Merge keeps the account's settings: the local settings row and its queued changes are
 * dropped so the account's row arrives with the pull (ensureSettings recreates defaults if
 * the account has none).
 */
export async function dropLocalSettings(): Promise<void> {
  await db.transaction('rw', db.settings, db.outbox, async () => {
    await db.settings.delete(SETTINGS_ID);
    const queued = await db.outbox.where('[table+row_id]').equals(['settings', SETTINGS_ID]).primaryKeys();
    await db.outbox.bulkDelete(queued);
  });
}

/** "Yerel veriyi at": forget everything on this device and link it to `userId`. */
export async function discardLocalData(userId: string): Promise<void> {
  const keep = new Set(['meta']);
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) if (!keep.has(t.name)) await t.clear();
    await setMeta(META.userId, userId);
    await setMeta(META.syncCursor, 0);
    await setMeta(META.lexiconCursor, 0);
  });
}

export interface RemoteSnapshot {
  rows: { table: string; row: unknown }[];
  /** Cursor after the last page of the snapshot. */
  nextSeq: number;
}

/**
 * "Hesaptakini at": every live row the account has but this device does not gets a
 * tombstone that orders after it (queued for push). Rows on both sides keep the local
 * version, re-stamped so it wins. Review logs cannot be deleted on the server; they stay
 * there without a card. Then local data is claimed for the account; the sync cursor is set
 * past the snapshot so the deleted rows are not pulled back as live rows.
 */
export async function discardAccountData(userId: string, snapshot: RemoteSnapshot, now: Millis = Date.now()): Promise<number> {
  await claimLocalData(userId, now);
  const n = await writeTx([db.notes, db.senses, db.cards, db.sources, db.settings], now, async (w) => {
    let count = 0;
    for (const { table, row } of snapshot.rows) {
      if (!(MUTABLE as string[]).includes(table)) continue;
      const remote = row as MutableRows[MutableTable];
      w.observe(remote.hlc);
      const local = (await db.table(table).get(remote.id)) as MutableRows[MutableTable] | undefined;
      if (local) {
        await w.put(table as MutableTable, { ...local, user_id: userId });
      } else if (remote.deleted_at === null) {
        await w.put(table as MutableTable, { ...remote, user_id: userId, deleted_at: now });
      }
      count++;
    }
    return count;
  });
  await db.transaction('rw', db.meta, () => setMeta(META.syncCursor, snapshot.nextSeq));
  return n;
}

/** Notes flagged possible_duplicate (shown in the library after a merge). */
export async function countPossibleDuplicates(): Promise<number> {
  return db.notes.filter((n: Note) => n.possible_duplicate && n.deleted_at === null).count();
}
