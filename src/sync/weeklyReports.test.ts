// weekly_reports and settings.goals through the sync engine and backups (FakeServer mirrors
// supabase/migrations/20261023000900_weekly_reports.sql: insert-only, one report per week).
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addNoteWithSenses,
  adoptGuestData,
  answerCard,
  db,
  ensureWeeklyReport,
  exportBackup,
  finalizeReportDraft,
  listWeeklyReports,
  restoreBackup,
  setGoals,
  setMeta,
  META,
  updateSettings,
} from '@/data';
import { Rating } from '@/domain/types';
import { resetDb } from '@/test/db';
import { REGISTRY_RECHECK_MS, runSync } from './engine';
import { FakeServer, onDevice, saveDevice, type DeviceImage } from './testing/fakeServer';

const DAY = 86_400_000;
const MIN = 60_000;
// Monday 19 October 2026 in Istanbul; the report is about 12–18 October.
const MON = Date.UTC(2026, 9, 19, 10);
const WEEK = '2026-10-12';
const USER = 'user-1';

let server: FakeServer;
beforeEach(async () => {
  server = new FakeServer(USER);
  await resetDb();
});

async function newDevice(deviceId: string): Promise<DeviceImage> {
  await resetDb();
  await db.transaction('rw', db.meta, async () => {
    await setMeta(META.deviceId, deviceId);
    await setMeta(META.userId, USER);
  });
  await updateSettings({ timezone: 'Europe/Istanbul' }, MON - 30 * DAY);
  return saveDevice();
}

/** Study during the reported week (each device has the account's history after a sync). */
async function study(term: string) {
  const { note } = await addNoteWithSenses({ term, senses: [{ meaning_tr: 'x' }] }, MON - 10 * DAY);
  const card = (await db.cards.where('note_id').equals(note.id).toArray())[0]!;
  await answerCard({ card_id: card.id, rating: Rating.Good, duration_ms: 5000 }, MON - 5 * DAY);
}

async function makeReport(now: number, comment: string | null) {
  const res = await ensureWeeklyReport(now);
  expect(res.status).toBe('created');
  await finalizeReportDraft(
    res.week,
    comment ? { text: comment, model: 'm', promptVersion: 'report-v1' } : null,
    now,
  );
}

const sync = (now: number) => runSync(server, { now: () => now });

describe('weekly reports sync', () => {
  it("two devices that both made the week's report end up with the first one stored", async () => {
    const a = await newDevice('dev-a');
    const afterA = await onDevice(a, async () => {
      await study('apple');
      await sync(MON - 4 * DAY);
    });
    const b = await newDevice('dev-b');
    const afterB = await onDevice(b, async () => {
      await sync(MON - 3 * DAY);
      // Offline on Monday: B makes its own report, still waiting for a comment.
      expect((await ensureWeeklyReport(MON + MIN)).status).toBe('created');
    });

    const a2 = await onDevice(afterA, async () => {
      await makeReport(MON, 'A cihazının yorumu burada. Kısa bir cümle daha. Bir tane daha.');
      await sync(MON + 2 * MIN);
      expect(await db.outbox.count()).toBe(0);
    });
    void a2;
    expect(server.rowsOf('weekly_reports')).toHaveLength(1);

    await onDevice(afterB, async () => {
      // B's comment comes; its push is acked but skipped (one report per week)…
      await finalizeReportDraft(
        WEEK,
        { text: 'B cihazının yorumu.', model: 'm', promptVersion: 'report-v1' },
        MON + 3 * MIN,
      );
      await sync(MON + 4 * MIN);
      expect(await db.outbox.count()).toBe(0);
      // …and the pull replaces B's report with the stored one.
      const reports = await db.weekly_reports.toArray();
      expect(reports).toHaveLength(1);
      expect(reports[0]!.comment).toMatch(/^A cihazının/);
      expect(await db.report_drafts.count()).toBe(0);
      expect((await listWeeklyReports()).map((r) => r.week)).toEqual([WEEK]);
    });
    expect(server.rowsOf('weekly_reports')).toHaveLength(1);
  });

  it("a pulled report replaces the week's waiting draft", async () => {
    const a = await newDevice('dev-a');
    await onDevice(a, async () => {
      await study('apple');
      await makeReport(MON, null);
      await sync(MON + MIN);
    });
    const b = await newDevice('dev-b');
    await onDevice(b, async () => {
      await study('pear'); // B studied too, so it can make a report before the pull
      expect((await ensureWeeklyReport(MON + MIN)).status).toBe('created');
      await sync(MON + 2 * MIN);
      expect(await db.report_drafts.count()).toBe(0);
      expect(await db.weekly_reports.count()).toBe(1);
      // The week has its report now: nothing more is made.
      expect((await ensureWeeklyReport(MON + 3 * MIN)).status).toBe('exists');
    });
  });

  it('reports are insert-only on the server', async () => {
    const a = await newDevice('dev-a');
    await onDevice(a, async () => {
      await study('apple');
      await makeReport(MON, null);
      const r = (await db.weekly_reports.toArray())[0]!;
      const del = await server.pushBatch([{ table: 'weekly_reports', op: 'delete', payload: r }]);
      expect(del.rejected).toHaveLength(1);
      await server.pushBatch([{ table: 'weekly_reports', op: 'upsert', payload: r }]);
      await server.pushBatch([
        { table: 'weekly_reports', op: 'upsert', payload: { ...r, comment: 'değişti' } },
      ]);
    });
    expect(server.rowsOf('weekly_reports').map((r) => r.comment)).toEqual([null]);
  });

  it('wait in the outbox, without failed attempts, until the server registry lists them', async () => {
    server.registry.delete('weekly_reports');
    const a = await newDevice('dev-a');
    const after = await onDevice(a, async () => {
      await study('apple');
      await makeReport(MON, null);
      await sync(MON + MIN);
      const waiting = await db.outbox.toArray();
      expect(waiting.map((o) => o.table)).toEqual(['weekly_reports']);
      expect(waiting[0]!.attempts).toBe(0);
    });
    expect(server.rowsOf('weekly_reports')).toHaveLength(0);
    server.registry.add('weekly_reports');
    await onDevice(after, async () => {
      await sync(MON + MIN + REGISTRY_RECHECK_MS);
      expect(await db.outbox.count()).toBe(0);
    });
    expect(server.rowsOf('weekly_reports')).toHaveLength(1);
  });

  it('goals reach the other device', async () => {
    const a = await newDevice('dev-a');
    await onDevice(a, async () => {
      await setGoals({ week_active_days: 5, month_new_terms: 100 }, MON);
      await sync(MON + MIN);
    });
    const b = await newDevice('dev-b');
    await onDevice(b, async () => {
      await sync(MON + 2 * MIN);
      expect((await db.settings.get('settings'))?.goals).toEqual({
        week_active_days: 5,
        month_new_terms: 100,
      });
    });
  });
});

describe('backups', () => {
  it('round-trip reports and goals; a week the device has keeps its own report', async () => {
    await newDevice('dev-a');
    await study('apple');
    await makeReport(MON, 'Yedekteki yorum. İkinci cümle. Üçüncü cümle.');
    await setGoals({ week_minutes: 90 }, MON);
    const backup = await exportBackup(MON + MIN);
    expect(backup.schema_version).toBe(9);
    expect(backup.tables.weekly_reports).toHaveLength(1);
    expect(backup.tables.settings[0]?.goals).toEqual({ week_minutes: 90 });

    await resetDb();
    await restoreBackup(JSON.stringify(backup), 'merge', MON + 2 * MIN);
    expect((await db.weekly_reports.toArray()).map((r) => r.comment)).toEqual([
      'Yedekteki yorum. İkinci cümle. Üçüncü cümle.',
    ]);
    expect((await db.settings.get('settings'))?.goals).toEqual({ week_minutes: 90 });
    // A guest queues no insert-only rows (decision 0025): the first sign-in queues them all.
    expect(await db.outbox.where('table').equals('weekly_reports').count()).toBe(0);

    // Restoring again adds nothing: one report per week.
    await restoreBackup(JSON.stringify(backup), 'overwrite', MON + 3 * MIN);
    expect(await db.weekly_reports.count()).toBe(1);

    // An older file (before schema_version 9) says nothing about reports: they stay.
    const { weekly_reports: _r, ...old } = backup.tables;
    const { backupChecksum } = await import('@/domain/backup');
    const oldFile = {
      ...backup,
      schema_version: 8,
      tables: old,
      checksum: await backupChecksum(old),
    };
    await restoreBackup(JSON.stringify(oldFile), 'overwrite', MON + 4 * MIN);
    expect(await db.weekly_reports.count()).toBe(1);

    await adoptGuestData(USER, MON + 5 * MIN);
    expect(await db.outbox.where('table').equals('weekly_reports').count()).toBe(1);
  });
});
