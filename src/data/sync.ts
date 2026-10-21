// Local side of the sync engine (src/sync/engine.ts): outbox batching and acks, applying
// pulled pages together with their cursor, full-resync cleanup and the lexicon cache.
// Business rules for conflicts live in applyRemoteRows (maintenance.ts); this module only
// moves rows in and out of Dexie in the right transactions.
import type { Id, LexiconSense, Millis, OutboxRow, OutboxTable } from '../domain/types';
import { db } from './db';
import { rebuildDailyActivity } from './dailyActivity';
import { applyRemoteRows, type ApplyRemoteResult, type RemoteBatch } from './maintenance';
import { getMeta, META, setMeta } from './meta';

/** After this many failed attempts a row is reported as stuck (plan: warn after 10). */
export const STUCK_ATTEMPTS = 10;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 30 * 60_000;

/** Exponential backoff per outbox row: 5 s, 10 s, 20 s … capped at 30 min. */
export function outboxBackoffMs(attempts: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

/** One row to push: the newest outbox entry of a (table, row_id), covering all older ones. */
export interface OutboxItem {
  table: OutboxTable;
  row_id: Id;
  op: OutboxRow['op'];
  payload: unknown;
  /** Highest outbox seq this item covers; entries above it arrived during the push. */
  maxSeq: number;
  attempts: number;
}

const rowKey = (table: string, id: string) => `${table}\u0000${id}`;
/** Key of an outbox row's target (table + row id), e.g. for takeOutboxItems' `skip`. */
export const outboxKey = (item: Pick<OutboxItem, 'table' | 'row_id'>): string => rowKey(item.table, item.row_id);

/**
 * Coalesced, due outbox items in outbox order (oldest first), at most `limit`.
 * `force` ignores next_attempt_at (manual "Şimdi senkronla"). `skip` (outboxKey values)
 * leaves out rows already tried in the current run.
 */
export async function takeOutboxItems(
  limit: number,
  now: Millis,
  force = false,
  skip?: ReadonlySet<string>,
): Promise<OutboxItem[]> {
  const rows = await db.outbox.orderBy('seq').toArray();
  const groups = new Map<string, { first: number; item: OutboxItem; due: Millis }>();
  for (const r of rows) {
    const key = rowKey(r.table, r.row_id);
    const g = groups.get(key);
    if (!g) {
      groups.set(key, {
        first: r.seq!,
        due: r.next_attempt_at,
        item: { table: r.table, row_id: r.row_id, op: r.op, payload: r.payload, maxSeq: r.seq!, attempts: r.attempts },
      });
    } else {
      g.item = { ...g.item, op: r.op, payload: r.payload, maxSeq: r.seq!, attempts: Math.max(g.item.attempts, r.attempts) };
      g.due = Math.max(g.due, r.next_attempt_at);
    }
  }
  const out: OutboxItem[] = [];
  for (const g of [...groups.values()].sort((a, b) => a.first - b.first)) {
    if (!force && g.due > now) continue;
    if (skip?.has(outboxKey(g.item))) continue;
    out.push(g.item);
    if (out.length >= limit) break;
  }
  return out;
}

async function entriesOf(item: Pick<OutboxItem, 'table' | 'row_id' | 'maxSeq'>): Promise<OutboxRow[]> {
  return db.outbox
    .where('[table+row_id]')
    .equals([item.table, item.row_id])
    .filter((r) => r.seq! <= item.maxSeq)
    .toArray();
}

/** Server acknowledged these items: delete their outbox entries (never newer ones). */
export async function ackOutboxItems(items: OutboxItem[]): Promise<number> {
  if (items.length === 0) return 0;
  return db.transaction('rw', db.outbox, async () => {
    let n = 0;
    for (const item of items) {
      const seqs = (await entriesOf(item)).map((r) => r.seq!);
      await db.outbox.bulkDelete(seqs);
      n += seqs.length;
    }
    return n;
  });
}

/** Push failed for these items: attempts + 1 and exponential backoff. */
export async function failOutboxItems(items: OutboxItem[], now: Millis): Promise<void> {
  if (items.length === 0) return;
  await db.transaction('rw', db.outbox, async () => {
    for (const item of items) {
      const attempts = item.attempts + 1;
      for (const r of await entriesOf(item)) {
        await db.outbox.update(r.seq!, { attempts, next_attempt_at: now + outboxBackoffMs(attempts) });
      }
    }
  });
}

/** Distinct rows that failed STUCK_ATTEMPTS times or more ("10 başarısız deneme"). */
export async function stuckOutboxCount(): Promise<number> {
  const rows = await db.outbox.filter((r) => r.attempts >= STUCK_ATTEMPTS).toArray();
  return new Set(rows.map((r) => rowKey(r.table, r.row_id))).size;
}

/** Earliest next_attempt_at among waiting rows (to schedule the next run), or null. */
export async function nextOutboxAttemptAt(): Promise<Millis | null> {
  const first = await db.outbox.orderBy('next_attempt_at').first();
  return first ? first.next_attempt_at : null;
}

/** Ids currently waiting in the outbox, per table (full resync keeps them). */
export async function outboxRowIds(): Promise<Set<string>> {
  const rows = await db.outbox.toArray();
  return new Set(rows.map((r) => rowKey(r.table, r.row_id)));
}

// ------------------------------------------------------------------ pull

export type CursorKey = typeof META.syncCursor | typeof META.lexiconCursor;

export async function getCursor(key: CursorKey): Promise<number> {
  const v = await getMeta<number>(key);
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Apply one pulled page and store the cursor in the SAME transaction: an interrupted pull
 * repeats from the old cursor and gives the same result.
 */
export async function applyPulledPage(batch: RemoteBatch, nextSeq: number, now: Millis = Date.now()): Promise<ApplyRemoteResult> {
  return db.transaction('rw', db.tables, async () => {
    const res = await applyRemoteRows(batch, now);
    await setMeta(META.syncCursor, nextSeq);
    return res;
  });
}

/** Tables whose rows a full resync may remove locally (review logs are never removed). */
const RESYNC_TABLES = ['notes', 'senses', 'cards', 'sources', 'settings'] as const;
export type ResyncTable = (typeof RESYNC_TABLES)[number];

/**
 * After a full re-pull: hard-delete local synced rows the server no longer has (their
 * tombstones were purged) unless they are still waiting in the outbox. Rebuilds
 * daily_activity. Returns the number of rows removed.
 */
export async function removeRowsMissingOnServer(seen: Record<ResyncTable, Set<Id>>, now: Millis = Date.now()): Promise<number> {
  let removed = 0;
  await db.transaction('rw', db.tables, async () => {
    // Read the outbox inside the transaction: a row written between a read outside it and
    // this transaction would not count as pending and would be wiped.
    const pending = await outboxRowIds();
    for (const table of RESYNC_TABLES) {
      const ids = (await db.table(table).toCollection().primaryKeys()) as Id[];
      const gone = ids.filter((id) => !seen[table].has(id) && !pending.has(rowKey(table, id)));
      if (gone.length) {
        await db.table(table).bulkDelete(gone);
        removed += gone.length;
      }
    }
  });
  if (removed) await rebuildDailyActivity(now);
  return removed;
}

// ------------------------------------------------------------------ lexicon cache

/** Store a lexicon_pull page and the lexicon cursor together. */
export async function applyLexiconPage(rows: LexiconSense[], nextSeq: number): Promise<void> {
  await db.transaction('rw', db.lexicon_cache, db.meta, async () => {
    if (rows.length) await db.lexicon_cache.bulkPut(rows);
    await setMeta(META.lexiconCursor, nextSeq);
  });
}

export async function putLexiconSenses(rows: LexiconSense[]): Promise<void> {
  if (rows.length) await db.lexicon_cache.bulkPut(rows);
}

/** lexicon_sense_ids used by live senses but missing from lexicon_cache. */
export async function missingLexiconSenseIds(): Promise<Id[]> {
  const used = new Set<Id>();
  await db.senses.each((s) => {
    if (s.lexicon_sense_id && s.deleted_at === null) used.add(s.lexicon_sense_id);
  });
  if (used.size === 0) return [];
  const ids = [...used];
  const have = await db.lexicon_cache.bulkGet(ids);
  return ids.filter((_, i) => !have[i]);
}
