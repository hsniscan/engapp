// "Bu cihazdaki verileri sil" and the device half of account deletion (ADR 0035): every
// local table is emptied in one transaction — cards, history, settings, the outbox, caches
// and `meta` (so the device is no longer linked to any account). The app recreates default
// settings on the next start (ensureSettings).
import { db } from './db';

/** Empties every Dexie table. Returns the number of rows removed. */
export async function wipeLocalDatabase(): Promise<number> {
  return db.transaction('rw', db.tables, async () => {
    let removed = 0;
    for (const t of db.tables) {
      removed += await t.count();
      await t.clear();
    }
    return removed;
  });
}
