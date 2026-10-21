import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../test/db';
import { compareHlc, decodeHlc } from '../domain/hlc';
import { addNoteWithSenses, editNote } from './actions';
import { db } from './db';
import { ActionError } from './errors';
import { clearErrors, ERROR_LOG_LIMIT, listErrors, logError } from './errorLog';
import { getDeviceId } from './meta';
import { defaultSettings, ensureSettings, getSettings, updateSettings } from './settings';

const T = Date.UTC(2026, 9, 21, 9);

beforeEach(resetDb);

describe('sync write path', () => {
  it('device id is created once', async () => {
    const a = await getDeviceId();
    expect(await getDeviceId()).toBe(a);
  });

  it('every synced change writes its outbox row with the full payload, and HLCs increase', async () => {
    const r = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T);
    const outbox = await db.outbox.toArray();
    // note + recognition card + sense + production card
    expect(outbox.map((o) => o.table).sort()).toEqual(['cards', 'cards', 'notes', 'senses']);
    const noteRow = outbox.find((o) => o.table === 'notes')!;
    expect(noteRow).toMatchObject({ op: 'upsert', row_id: r.note.id, attempts: 0 });
    expect(noteRow.payload).toEqual(await db.notes.get(r.note.id));
    const hlcs = outbox.map((o) => (o.payload as { hlc: string }).hlc);
    for (let i = 1; i < hlcs.length; i++) expect(compareHlc(hlcs[i]!, hlcs[i - 1]!)).toBe(1);
    expect(decodeHlc(hlcs[0]!).node).toBe(await getDeviceId());
    expect(r.note.updated_at).toBe(T);
  });

  it('a failing action writes nothing (same transaction)', async () => {
    await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T);
    const other = await addNoteWithSenses({ term: 'shore', senses: [{ meaning_tr: 'kıyı' }] }, T);
    const before = await db.outbox.count();
    await expect(editNote(other.note.id, { term: 'Bank' }, T + 1)).rejects.toBeInstanceOf(ActionError);
    expect(await db.outbox.count()).toBe(before);
    expect((await db.notes.get(other.note.id))!.term).toBe('shore');
  });

  it('HLC stays monotonic when the device clock goes backwards', async () => {
    const a = await addNoteWithSenses({ term: 'one', senses: [{ meaning_tr: 'bir' }] }, T);
    const b = await addNoteWithSenses({ term: 'two', senses: [{ meaning_tr: 'iki' }] }, T - 86_400_000);
    expect(compareHlc(b.note.hlc, a.note.hlc)).toBe(1);
  });
});

describe('settings', () => {
  it('defaults', async () => {
    const s = await getSettings(T);
    expect(s).toMatchObject({ daily_new_limit: 10, request_retention: 0.9, day_start_hour: 4, theme: 'system', voice: 'en-US', level: 'B1' });
    expect(s.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(await db.settings.count()).toBe(0);
    await ensureSettings(T);
    await ensureSettings(T + 5);
    expect((await db.settings.toArray()).map((x) => x.created_at)).toEqual([T]);
    expect(defaultSettings(T).id).toBe('settings');
  });

  it('updates with validation and outbox', async () => {
    const s = await updateSettings({ daily_new_limit: 20, timezone: 'Europe/Istanbul' }, T);
    expect(s.daily_new_limit).toBe(20);
    expect((await db.outbox.toArray()).filter((o) => o.table === 'settings')).toHaveLength(1);
    await expect(updateSettings({ request_retention: 0.5 }, T)).rejects.toThrow();
    await expect(updateSettings({ timezone: 'Mars/Base' }, T)).rejects.toThrow();
    await expect(updateSettings({ fsrs_params: [1, 2] }, T)).rejects.toThrow();
  });
});

describe('error log', () => {
  it('keeps only the last 200 rows', async () => {
    for (let i = 0; i < ERROR_LOG_LIMIT + 5; i++) await logError(new Error(`e${i}`), null, i);
    const rows = await listErrors();
    expect(rows).toHaveLength(ERROR_LOG_LIMIT);
    expect(rows[0]!.message).toBe(`e${ERROR_LOG_LIMIT + 4}`);
    expect(rows.at(-1)!.message).toBe('e5');
    await clearErrors();
    expect(await listErrors()).toHaveLength(0);
  });
});
