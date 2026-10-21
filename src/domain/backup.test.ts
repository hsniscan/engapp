import { describe, expect, it } from 'vitest';
import { makeCard, makeLog, makeSense } from '../test/factories';
import { buildBackup, buildNotesCsv, canonicalJson, csvCell, verifyBackup, type BackupTables } from './backup';
import type { Note, Settings } from './types';

const note = (p: Partial<Note> & { id: string; term: string }): Note => ({
  user_id: null,
  created_at: Date.UTC(2026, 9, 21, 12),
  updated_at: 0,
  deleted_at: null,
  hlc: 'h',
  term_norm: p.term.toLowerCase(),
  term_type: 'word',
  lexicon_term_id: null,
  ipa: null,
  tags: [],
  possible_duplicate: false,
  ...p,
});

const settings: Settings = {
  id: 'settings',
  user_id: null,
  created_at: 0,
  updated_at: 0,
  deleted_at: null,
  hlc: 'h',
  daily_new_limit: 10,
  request_retention: 0.9,
  timezone: 'Europe/Istanbul',
  day_start_hour: 4,
  theme: 'system',
  voice: 'en-US',
  level: 'B1',
  fsrs_params: null,
  last_backup_at: null,
};

function tables(): BackupTables {
  return {
    notes: [note({ id: 'n1', term: 'bank' })],
    senses: [makeSense({ id: 's1', note_id: 'n1' })],
    cards: [makeCard({ id: 'c1', note_id: 'n1' })],
    review_logs: [makeLog({ id: 'l1', card_id: 'c1', reviewed_at: 5 }), makeLog({ id: 'l2', card_id: 'c1', reviewed_at: 6, undo_of: 'l1' })],
    sources: [],
    settings: [settings],
  };
}

describe('backup file', () => {
  it('builds, verifies and summarizes', async () => {
    const b = await buildBackup(tables(), { exported_at: 1, device_id: 'd' });
    const r = await verifyBackup(JSON.stringify(b));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.summary).toEqual({ notes: 1, senses: 1, cards: 1, reviews: 0, sources: 0 });
  });

  it('rejects tampering, bad JSON, bad shape and newer versions', async () => {
    const b = await buildBackup(tables(), { exported_at: 1, device_id: 'd' });
    const tampered = structuredClone(b);
    tampered.tables.notes[0]!.term = 'hacked';
    expect(await verifyBackup(tampered)).toMatchObject({ ok: false, error: 'checksum_mismatch' });
    expect(await verifyBackup('{nope')).toMatchObject({ ok: false, error: 'invalid_json' });
    expect(await verifyBackup({ ...b, tables: { ...b.tables, cards: [{ id: 1 }] } })).toMatchObject({ ok: false, error: 'invalid_format' });
    expect(await verifyBackup({ ...b, schema_version: 99 })).toMatchObject({ ok: false, error: 'unsupported_version' });
  });

  it('checksum does not depend on row or key order', async () => {
    const t = tables();
    const a = await buildBackup(t, { exported_at: 1, device_id: null });
    const reversed = { ...t, review_logs: [...t.review_logs].reverse() };
    const b = await buildBackup(reversed, { exported_at: 2, device_id: null });
    expect(a.checksum).toBe(b.checksum);
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
  });
});

describe('CSV export', () => {
  it('quotes and neutralizes cells', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
  });

  it('writes BOM, header, numbered senses and local dates', () => {
    const notes = [
      note({ id: 'n1', term: 'bank', ipa: '/bæŋk/', tags: ['finance', 'geo'] }),
      note({ id: 'n2', term: 'give up', created_at: Date.UTC(2026, 9, 21, 22) }), // 01:00 next day in Istanbul
      note({ id: 'n3', term: 'gone', deleted_at: 1 }),
    ];
    const senses = [
      makeSense({ id: 'a', note_id: 'n1', sense_no: 2, meaning_tr: 'kıyı', source_sentence: 'The river bank; wide.' }),
      makeSense({ id: 'b', note_id: 'n1', sense_no: 1, meaning_tr: 'banka', meaning_tr_override: 'banka (para)' }),
      makeSense({ id: 'c', note_id: 'n2', meaning_tr: 'vazgeçmek' }),
    ];
    const csv = buildNotesCsv(notes, senses, { timezone: 'Europe/Istanbul' });
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('term;meaning;ipa;sentence;tags;created');
    expect(lines[1]).toBe('bank;1. banka (para) | 2. kıyı;/bæŋk/;"The river bank; wide.";finance, geo;2026-10-21');
    expect(lines[2]).toBe('give up;vazgeçmek;;;;2026-10-22');
    expect(lines).toHaveLength(4); // trailing CRLF
  });
});
