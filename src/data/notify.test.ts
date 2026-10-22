import { beforeEach, describe, expect, it } from 'vitest';
import { makeLog } from '../test/factories';
import { resetDb } from '../test/db';
import { db } from './db';
import { computeAutoHour, refreshAutoHour, saveNotify } from './notify';
import { parseNotify } from '../domain/notify';
import { settingsSchema } from '../domain/schemas';
import { ensureSettings, getSettings, settingsPatchSchema, updateSettings } from './settings';

const NOW = Date.parse('2026-10-23T12:00:00+03:00');
const at = (daysAgo: number, hour: number) =>
  Date.parse(`2026-10-23T${String(hour).padStart(2, '0')}:10:00+03:00`) - daysAgo * 86_400_000;

beforeEach(async () => {
  await resetDb();
  await ensureSettings(NOW - 30 * 86_400_000);
  await updateSettings({ timezone: 'Europe/Istanbul' }, NOW - 30 * 86_400_000);
});

describe('reminder hour on the device', () => {
  it('comes from the answers that still count (undone answers are left out)', async () => {
    const evening = [1, 2, 3].map((d) => makeLog({ card_id: 'c1', reviewed_at: at(d, 20) }));
    const mornings = [4, 5, 6, 7].map((d) => makeLog({ card_id: 'c2', reviewed_at: at(d, 10) }));
    // Two of the mornings were undone: 20:00 wins 3 to 2.
    const undos = mornings
      .slice(0, 2)
      .map((l) => makeLog({ card_id: 'c2', reviewed_at: l.reviewed_at + 1000, undo_of: l.id }));
    await db.review_logs.bulkAdd([...evening, ...mornings, ...undos]);
    expect(await computeAutoHour(NOW)).toBe(20);
  });

  it('is saved with the setting and follows the history in auto mode only', async () => {
    expect(await saveNotify({ enabled: true }, NOW)).toEqual({
      enabled: true,
      mode: 'auto',
      hour: 19,
    });
    await db.review_logs.bulkAdd(
      [1, 2].map((d) => makeLog({ card_id: 'c', reviewed_at: at(d, 9) })),
    );
    expect(await refreshAutoHour(NOW)).toBe(true);
    expect((await getSettings()).notify).toEqual({ enabled: true, mode: 'auto', hour: 9 });
    expect(await refreshAutoHour(NOW)).toBe(false); // unchanged: no write

    await saveNotify({ mode: 'fixed', hour: 21 }, NOW);
    await db.review_logs.bulkAdd(
      [3, 4, 5].map((d) => makeLog({ card_id: 'c', reviewed_at: at(d, 15) })),
    );
    expect(await refreshAutoHour(NOW)).toBe(false);
    expect((await getSettings()).notify).toEqual({ enabled: true, mode: 'fixed', hour: 21 });

    await saveNotify({ enabled: false }, NOW);
    await saveNotify({ mode: 'auto' }, NOW);
    expect((await getSettings()).notify).toEqual({ enabled: false, mode: 'auto', hour: 15 });
  });

  it('queues the change for sync like any setting', async () => {
    await saveNotify({ enabled: true }, NOW);
    const queued = await db.outbox
      .where('[table+row_id]')
      .equals(['settings', 'settings'])
      .toArray();
    expect(queued.at(-1)?.payload).toMatchObject({
      notify: { enabled: true, mode: 'auto', hour: 19 },
    });
  });
});

describe('allowed reminder hours (09–21 everywhere, decision 0024)', () => {
  it('the settings patch, the row schema and the push rule agree', async () => {
    const patch = (hour: number) =>
      settingsPatchSchema.safeParse({ notify: { enabled: true, mode: 'fixed', hour } }).success;
    expect([8, 9, 21, 22].map(patch)).toEqual([false, true, true, false]);

    const row = { ...(await getSettings(NOW)) };
    const read = (hour: number) =>
      settingsSchema.parse({ ...row, notify: { enabled: true, mode: 'fixed', hour } }).notify?.hour;
    const rule = (hour: number) => parseNotify({ enabled: true, mode: 'fixed', hour })?.hour;
    for (const h of [0, 8, 9, 15, 21, 22, 23]) expect(read(h)).toBe(rule(h));
    expect([read(3), read(22)]).toEqual([9, 21]);
  });
});
