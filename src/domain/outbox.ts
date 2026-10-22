// Outbox compaction (decision 0025). Push already sends only the newest entry of each
// (table, row_id) and an ack deletes every entry up to it (data/sync.ts takeOutboxItems,
// ackOutboxItems), so older entries of the same row are dead weight. A guest queues every
// write until the first sign-in (before compaction, a 10,000-card restore alone queued
// ~65,000 entries); compaction keeps one entry per row.
import type { Millis, OutboxRow, OutboxTable } from './types';

export type OutboxEntry = Pick<OutboxRow, 'table' | 'row_id' | 'attempts' | 'next_attempt_at'> & { seq: number };

/**
 * Insert-only tables. On a device that was never linked to an account (a guest), their
 * outbox entries are redundant: the first sign-in (adoptGuestData) queues every row of
 * these tables again, and nothing is pushed before it.
 */
export const GUEST_REQUEUED_TABLES: readonly OutboxTable[] = [
  'review_logs',
  'practice_logs',
  'level_tests',
  'weekly_reports',
];

export interface OutboxCompaction {
  /** Entries to delete: covered by a newer entry of the same row, or in a dropped table. */
  remove: number[];
  /** Kept entries that take over their group's backoff (highest attempts / next attempt). */
  update: { seq: number; attempts: number; next_attempt_at: Millis }[];
}

/**
 * Keep the newest entry (highest seq: the one push would send) of each (table, row_id) and
 * remove the rest. The kept entry inherits the group's highest `attempts` and
 * `next_attempt_at`, which is what takeOutboxItems reports for the group, so push behaves
 * exactly as before. Within a row the newest entry also carries the highest HLC: every
 * local write stamps a fresh, increasing HLC, and a restore writes a row as-is only when
 * the row is missing locally or newer than the local one.
 *
 * `dropTables`: remove every entry of these tables (GUEST_REQUEUED_TABLES, guests only).
 */
export function compactOutboxEntries(
  entries: readonly OutboxEntry[],
  dropTables: ReadonlySet<OutboxTable> = new Set(),
): OutboxCompaction {
  const out: OutboxCompaction = { remove: [], update: [] };
  const groups = new Map<string, OutboxEntry[]>();
  for (const e of entries) {
    if (dropTables.has(e.table)) {
      out.remove.push(e.seq);
      continue;
    }
    const key = `${e.table}\u0000${e.row_id}`;
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    let newest = list[0]!;
    let attempts = 0;
    let next = -Infinity;
    for (const e of list) {
      if (e.seq > newest.seq) newest = e;
      attempts = Math.max(attempts, e.attempts);
      next = Math.max(next, e.next_attempt_at);
    }
    for (const e of list) if (e !== newest) out.remove.push(e.seq);
    if (newest.attempts !== attempts || newest.next_attempt_at !== next) {
      out.update.push({ seq: newest.seq, attempts, next_attempt_at: next });
    }
  }
  out.remove.sort((a, b) => a - b);
  return out;
}
