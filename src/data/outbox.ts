// Outbox compaction (decision 0025, rules in domain/outbox.ts).
import { compactOutboxEntries, GUEST_REQUEUED_TABLES, type OutboxEntry } from '../domain/outbox';
import type { Id, OutboxRow, OutboxTable } from '../domain/types';
import { db } from './db';
import { getMeta, META } from './meta';

/**
 * One entry per row: drop outbox entries covered by a newer entry of the same row. Safe at
 * any time: push sends only a row's newest entry, and an ack never deletes entries above
 * the one it sent. With `guest`, also drop every entry of GUEST_REQUEUED_TABLES (checked
 * inside the transaction: only while the device was never linked to an account).
 * Reads keys through the [table+row_id] index and loads only the rows it may change.
 * Returns the number of entries removed.
 */
export async function compactOutbox(opts: { guest?: boolean } = {}): Promise<number> {
  return db.transaction('rw', db.outbox, db.meta, async () => {
    const guest = !!opts.guest && !((await getMeta<string | null>(META.userId)) ?? null);
    const drop = new Set<OutboxTable>(guest ? GUEST_REQUEUED_TABLES : []);
    const byRow = db.outbox.orderBy('[table+row_id]');
    const keys = (await byRow.keys()) as unknown as [OutboxTable, Id][];
    const seqs = (await byRow.primaryKeys()) as number[];
    const same = (i: number, j: number) =>
      j >= 0 && j < keys.length && keys[i]![0] === keys[j]![0] && keys[i]![1] === keys[j]![1];
    // Dropped tables need no row data; duplicates are loaded for their backoff fields.
    const dropped: OutboxEntry[] = [];
    const dupSeqs: number[] = [];
    for (const [i, seq] of seqs.entries()) {
      const [table, row_id] = keys[i]!;
      if (drop.has(table)) dropped.push({ seq, table, row_id, attempts: 0, next_attempt_at: 0 });
      else if (same(i, i - 1) || same(i, i + 1)) dupSeqs.push(seq);
    }
    if (dropped.length === 0 && dupSeqs.length === 0) return 0;
    const rows = (await db.outbox.bulkGet(dupSeqs)).filter((r): r is OutboxRow => !!r);
    const plan = compactOutboxEntries(
      [
        ...dropped,
        ...rows.map((r) => ({ seq: r.seq!, table: r.table, row_id: r.row_id, attempts: r.attempts, next_attempt_at: r.next_attempt_at })),
      ],
      drop,
    );
    await db.outbox.bulkDelete(plan.remove);
    for (const u of plan.update) await db.outbox.update(u.seq, { attempts: u.attempts, next_attempt_at: u.next_attempt_at });
    return plan.remove.length;
  });
}

/**
 * Guest compaction (never linked, nothing pushed yet): one entry per mutable row and none
 * for logs, which the first sign-in queues again. Once an account is linked it only removes
 * covered entries (like compactOutbox()).
 */
export function compactGuestOutbox(): Promise<number> {
  return compactOutbox({ guest: true });
}
