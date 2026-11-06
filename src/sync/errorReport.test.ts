import { beforeEach, describe, expect, it } from 'vitest';
import { db, getMeta, logError } from '@/data';
import type { ClientErrorRow } from '@/domain/errorReport';
import { resetDb } from '@/test/db';
import { BATCH, REPORT_AT, REPORT_CURSOR, REPORT_EVERY_MS, reportErrors, type ReportSink } from './errorReport';

const T = Date.UTC(2026, 10, 6, 9);

function sink(fail = false): ReportSink & { sent: ClientErrorRow[][] } {
  const sent: ClientErrorRow[][] = [];
  return {
    sent,
    insert: async (rows) => {
      sent.push(rows);
      return { error: fail ? { message: 'relation "client_errors" does not exist' } : null };
    },
  };
}

beforeEach(async () => {
  await resetDb();
});

describe('reportErrors (decision 0076)', () => {
  it('sends new entries once, scrubbed, and moves its cursor', async () => {
    await logError(new Error('Sync failed for "a private word"'), 'sync.run', T - 1000);
    await logError(new Error('Other'), 'window.onerror x.js:1', T - 500);
    const s = sink();
    expect(await reportErrors(T, s)).toBe(2);
    expect(s.sent[0]!.map((r) => r.message)).toEqual(['Sync failed for "…"', 'Other']);
    expect(await getMeta(REPORT_CURSOR)).toBe(2);
    // Nothing new: nothing sent, also after the hour.
    expect(await reportErrors(T + REPORT_EVERY_MS, s)).toBe(0);
    expect(s.sent).toHaveLength(1);
  });

  it('waits an hour between reports', async () => {
    await logError(new Error('one'), 'a', T);
    const s = sink();
    await reportErrors(T, s);
    await logError(new Error('two'), 'b', T + 1);
    expect(await reportErrors(T + 60_000, s)).toBe(0);
    expect(await reportErrors(T + REPORT_EVERY_MS, s)).toBe(1);
  });

  it('keeps the entries for the next try when the server refuses', async () => {
    await logError(new Error('one'), 'a', T);
    expect(await reportErrors(T, sink(true))).toBe(0);
    expect(await getMeta(REPORT_CURSOR)).toBeUndefined();
    expect(await getMeta(REPORT_AT)).toBe(T);
    const s = sink();
    expect(await reportErrors(T + REPORT_EVERY_MS, s)).toBe(1);
  });

  it('starts with the newest entries on a device with an old backlog', async () => {
    for (let i = 0; i < 30; i++) await logError(new Error(`kind ${'x'.repeat(i)}`), `ctx${i}`, T - 1000 + i);
    const s = sink();
    expect(await reportErrors(T, s)).toBe(BATCH);
    const newest = (await db.error_log.orderBy('id').last())!.id!;
    expect(await getMeta(REPORT_CURSOR)).toBe(newest);
  });

  it('does nothing without a backend (guest build)', async () => {
    await logError(new Error('one'), 'a', T);
    expect(await reportErrors(T, null)).toBe(0);
  });
});
