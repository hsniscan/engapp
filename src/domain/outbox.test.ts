import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compactOutboxEntries, GUEST_REQUEUED_TABLES, type OutboxEntry } from './outbox';
import type { OutboxTable } from './types';

const entriesArb = fc
  .array(
    fc.record({
      table: fc.constantFrom<OutboxTable>('notes', 'cards', 'review_logs', 'settings'),
      row_id: fc.constantFrom('a', 'b', 'c', 'd'),
      attempts: fc.nat(12),
      next_attempt_at: fc.nat(1_000_000),
    }),
    { maxLength: 60 },
  )
  .map((rows): OutboxEntry[] => rows.map((r, i) => ({ ...r, seq: i + 1 })));

const key = (e: Pick<OutboxEntry, 'table' | 'row_id'>) => `${e.table}:${e.row_id}`;

/** What takeOutboxItems sees per row: the newest entry, the group's max backoff fields. */
function view(entries: readonly OutboxEntry[]) {
  const out = new Map<string, { seq: number; attempts: number; next: number }>();
  for (const e of entries) {
    const cur = out.get(key(e));
    out.set(key(e), {
      seq: Math.max(cur?.seq ?? 0, e.seq),
      attempts: Math.max(cur?.attempts ?? 0, e.attempts),
      next: Math.max(cur?.next ?? -Infinity, e.next_attempt_at),
    });
  }
  return out;
}

function apply(entries: readonly OutboxEntry[], drop?: ReadonlySet<OutboxTable>): OutboxEntry[] {
  const plan = compactOutboxEntries(entries, drop);
  const removed = new Set(plan.remove);
  const updates = new Map(plan.update.map((u) => [u.seq, u]));
  return entries
    .filter((e) => !removed.has(e.seq))
    .map((e) => {
      const u = updates.get(e.seq);
      return u ? { ...e, attempts: u.attempts, next_attempt_at: u.next_attempt_at } : e;
    });
}

describe('compactOutboxEntries', () => {
  it('property: one entry per row, the newest, and push sees exactly the same items', () => {
    fc.assert(
      fc.property(entriesArb, (entries) => {
        const after = apply(entries);
        expect(new Set(after.map(key)).size).toBe(after.length);
        expect(view(after)).toEqual(view(entries));
      }),
    );
  });

  it('property: idempotent', () => {
    fc.assert(
      fc.property(entriesArb, (entries) => {
        const once = apply(entries);
        expect(compactOutboxEntries(once)).toEqual({ remove: [], update: [] });
      }),
    );
  });

  it('property: dropped tables lose every entry, the others are compacted as usual', () => {
    const drop = new Set(GUEST_REQUEUED_TABLES);
    fc.assert(
      fc.property(entriesArb, (entries) => {
        const after = apply(entries, drop);
        expect(after.some((e) => drop.has(e.table))).toBe(false);
        expect(view(after)).toEqual(view(entries.filter((e) => !drop.has(e.table))));
      }),
    );
  });

  it('keeps the newest entry and lets it take over the backoff of older failed entries', () => {
    const plan = compactOutboxEntries([
      { seq: 1, table: 'notes', row_id: 'a', attempts: 3, next_attempt_at: 900 },
      { seq: 2, table: 'notes', row_id: 'b', attempts: 0, next_attempt_at: 100 },
      { seq: 5, table: 'notes', row_id: 'a', attempts: 0, next_attempt_at: 200 },
    ]);
    expect(plan).toEqual({ remove: [1], update: [{ seq: 5, attempts: 3, next_attempt_at: 900 }] });
  });

  it('guests: review, practice and level-test logs are re-queued at sign-in', () => {
    expect([...GUEST_REQUEUED_TABLES].sort()).toEqual(['level_tests', 'practice_logs', 'review_logs']);
  });
});
