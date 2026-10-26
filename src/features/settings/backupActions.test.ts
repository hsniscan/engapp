import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addNoteWithSenses, ensureSettings, getSettings } from '@/data';
import type { NativeSaveResult } from '@/native/files';
import { resetDb } from '@/test/db';
import { getToasts, resetToasts } from '@/ui/toast-store';
import { saveBackup, downloadBackup } from './backupActions';
import { saveTextFile, type SaveDeps } from './download';

const T = Date.UTC(2026, 9, 26, 9);

function deps(native: boolean, nativeResult?: NativeSaveResult) {
  const saveNative = vi.fn<SaveDeps['saveNative']>(
    async () => nativeResult ?? { ok: false, cancelled: false },
  );
  const download = vi.fn<SaveDeps['download']>();
  return { isNative: () => native, saveNative, download } satisfies SaveDeps;
}

beforeEach(async () => {
  await resetDb();
  await ensureSettings(T - 1000);
  resetToasts();
});

describe('saveTextFile: platform switch', () => {
  it('web: a browser download, unchanged', async () => {
    const d = deps(false);
    const r = await saveTextFile('a.json', '{}', 'application/json', 'x', d);
    expect(d.download).toHaveBeenCalledWith('a.json', '{}', 'application/json');
    expect(d.saveNative).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, native: false, location: 'a.json' });
  });

  it('app: writes through the native file module, never <a download>', async () => {
    const d = deps(true, {
      ok: true,
      how: 'documents',
      location: 'Documents/a.json',
      uri: 'file:///a',
    });
    const r = await saveTextFile('a.json', '{}', 'application/json', 'x', d);
    expect(d.download).not.toHaveBeenCalled();
    expect(d.saveNative).toHaveBeenCalledWith('a.json', '{}', 'x');
    expect(r).toMatchObject({ ok: true, native: true, location: 'Documents/a.json' });
  });
});

describe('saveBackup: last_backup_at only after the file is written', () => {
  beforeEach(async () => {
    await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T - 500);
  });

  it('app, saved to Documents: records the backup', async () => {
    const d = deps(true, {
      ok: true,
      how: 'documents',
      location: 'Documents/x.json',
      uri: 'file:///x',
    });
    const r = await saveBackup({ save: d, now: () => T });
    expect(r.ok).toBe(true);
    const [name, text] = d.saveNative.mock.calls[0]!;
    expect(name).toBe('engapp-yedek-2026-10-26.json');
    expect(JSON.parse(text).tables.notes).toHaveLength(1);
    expect((await getSettings()).last_backup_at).toBe(T);
  });

  it('app, write failed or share cancelled: no "Son yedek: bugün"', async () => {
    for (const result of [
      { ok: false, cancelled: true },
      { ok: false, cancelled: false },
    ] as const) {
      const d = deps(true, result);
      expect((await saveBackup({ save: d, now: () => T })).ok).toBe(false);
      expect((await getSettings()).last_backup_at).toBeNull();
    }
  });

  it('app, native module throws: failure, nothing recorded', async () => {
    const d = deps(true);
    d.saveNative.mockRejectedValueOnce(new Error('disk full'));
    expect((await saveBackup({ save: d, now: () => T })).ok).toBe(false);
    expect((await getSettings()).last_backup_at).toBeNull();
  });

  it('web: records after the download', async () => {
    const d = deps(false);
    expect(await downloadBackup({ save: d, now: () => T })).toBe(true);
    expect(d.download).toHaveBeenCalledOnce();
    expect((await getSettings()).last_backup_at).toBe(T);
  });

  it('app: the confirmation names the saved file', async () => {
    const d = deps(true, {
      ok: true,
      how: 'documents',
      location: 'Documents/engapp-yedek-2026-10-26.json',
      uri: 'file:///x',
    });
    await downloadBackup({ save: d, now: () => T });
    const titles = getToasts().map((x) => x.title);
    expect(titles).toContain('Yedek kaydedildi: Documents/engapp-yedek-2026-10-26.json');
  });
});
