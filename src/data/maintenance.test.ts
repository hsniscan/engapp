import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../test/db';
import { encodeHlc } from '../domain/hlc';
import { CardState, Rating, type Card, type RatingValue, type ReviewLog } from '../domain/types';
import { addNoteWithSenses, answerCard, undoAnswer } from './actions';
import { db } from './db';
import { listDailyActivity } from './dailyActivity';
import {
  adoptGuestData,
  applyRemoteRows,
  exportBackup,
  exportCsv,
  recomputeAllCards,
  repairIntegrity,
  restoreBackup,
  runIntegrityCheck,
} from './maintenance';
import { getSettings, updateSettings } from './settings';

const T = Date.UTC(2026, 9, 21, 9);
const MIN = 60_000;

beforeEach(async () => {
  await resetDb();
  await updateSettings({ timezone: 'Europe/Istanbul' }, T - 86_400_000);
});

const remoteHlc = (ms: number, node = 'remote'): string => encodeHlc({ ms, counter: 0, node });

async function recognition(noteId: string): Promise<Card> {
  return (await db.cards.where('note_id').equals(noteId).toArray()).find((c) => c.card_type === 'recognition')!;
}

describe('recomputeAllCards', () => {
  it('repairs a card whose stored state drifted from its logs', async () => {
    const a = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T);
    const rec = await recognition(a.note.id);
    const ans = await answerCard({ card_id: rec.id, rating: Rating.Good, duration_ms: 1 }, T);
    await db.cards.update(rec.id, { state: CardState.Review, stability: 99 });
    expect(await recomputeAllCards(T + 1)).toBe(1);
    expect(await db.cards.get(rec.id)).toMatchObject({ state: ans.card.state, stability: ans.card.stability, due: ans.card.due });
    expect(await recomputeAllCards(T + 2)).toBe(0);
  });
});

describe('applyRemoteRows', () => {
  it('merges answers from another device and recomputes the card', async () => {
    const a = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T);
    const rec = await recognition(a.note.id);
    const local = await answerCard({ card_id: rec.id, rating: Rating.Good, duration_ms: 1 }, T + MIN);
    const outboxBefore = await db.outbox.count();
    const remoteLog: ReviewLog = {
      id: '01999999-0000-7000-8000-000000000001',
      user_id: 'u',
      card_id: rec.id,
      rating: Rating.Good,
      reviewed_at: T + 15 * MIN,
      duration_ms: 3000,
      device_id: 'other',
      undo_of: null,
      shown_sense_id: null,
      created_at: T + 15 * MIN,
      hlc: remoteHlc(T + 15 * MIN),
    };
    const res = await applyRemoteRows({ review_logs: [remoteLog, { id: 'garbage' }] }, T + 20 * MIN);
    expect(res).toMatchObject({ applied: 1, invalid: 1 });
    const card = (await db.cards.get(rec.id))!;
    expect(card.state).toBe(CardState.Review); // Good, Good → graduated
    expect(card.reps).toBe(2);
    // Siblings unlocked as a consequence and the recomputed rows are queued, the pulled log is not.
    const prod = (await db.cards.where('note_id').equals(a.note.id).toArray()).find((c) => c.card_type === 'production')!;
    expect(prod.unlocked).toBe(true);
    const newOutbox = (await db.outbox.toArray()).slice(outboxBefore);
    expect(newOutbox.map((o) => o.table).sort()).toEqual(['cards', 'cards']);
    expect((await listDailyActivity())[0]).toMatchObject({ reviews: 2, time_ms: 1 + 3000 });
    // Applying the same page again changes nothing.
    const again = await applyRemoteRows({ review_logs: [remoteLog] }, T + 21 * MIN);
    expect(again).toMatchObject({ applied: 0, skipped: 1, recomputedCards: 0 });
    expect(local.log.id).toBeTruthy();
  });

  it('last writer wins by hlc and keeps local FSRS derived from local logs', async () => {
    const a = await addNoteWithSenses({ term: 'bank', tags: ['local'], senses: [{ meaning_tr: 'banka' }] }, T);
    const older = { ...a.note, tags: ['old'], hlc: remoteHlc(1) };
    expect(await applyRemoteRows({ notes: [older] }, T + 1)).toMatchObject({ applied: 0, skipped: 1 });
    const newer = { ...a.note, tags: ['remote'], hlc: remoteHlc(T + 10 * MIN) };
    expect(await applyRemoteRows({ notes: [newer] }, T + 1)).toMatchObject({ applied: 1 });
    expect((await db.notes.get(a.note.id))!.tags).toEqual(['remote']);
    // A later local edit orders after the remote one even with a slow local clock.
    const r = await addNoteWithSenses({ term: 'bank', tags: ['again'], senses: [] }, T + 2);
    expect(r.note.hlc > newer.hlc).toBe(true);
  });

  it('flags notes with the same term as possible duplicates', async () => {
    const a = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T);
    const remote = { ...a.note, id: '01999999-0000-7000-8000-0000000000aa', hlc: remoteHlc(T + 5) };
    await applyRemoteRows({ notes: [remote] }, T + 10);
    const notes = await db.notes.toArray();
    expect(notes).toHaveLength(2);
    expect(notes.every((n) => n.possible_duplicate)).toBe(true);
  });
});

describe('backup and restore', () => {
  it('property: backup → restore into an empty database → backup is identical', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            term: fc.constantFrom('bank', 'shore', 'give up', 'take off', 'run'),
            meaning: fc.constantFrom('a', 'b', 'c'),
            answers: fc.array(fc.constantFrom<RatingValue>(1, 2, 3, 4), { maxLength: 4 }),
            undo: fc.boolean(),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        async (ops) => {
          await resetDb();
          await updateSettings({ timezone: 'Europe/Istanbul', last_backup_at: 5 }, T - 1);
          let t = T;
          for (const op of ops) {
            const r = await addNoteWithSenses({ term: op.term, senses: [{ meaning_tr: op.meaning, source_sentence: `I ${op.term} now.`, span: [2, 2 + op.term.length] }] }, (t += MIN));
            const rec = await recognition(r.note.id);
            let lastId: string | null = null;
            for (const rating of op.answers) lastId = (await answerCard({ card_id: rec.id, rating, duration_ms: 1234 }, (t += 11 * MIN))).log.id;
            if (op.undo && lastId) await undoAnswer(lastId, (t += MIN));
          }
          const first = await exportBackup(t + MIN);
          const activity = await listDailyActivity();
          await resetDb();
          await restoreBackup(JSON.stringify(first), 'merge', t + 2 * MIN);
          const second = await exportBackup(t + 3 * MIN);
          expect(second.tables).toEqual(first.tables);
          expect(second.checksum).toBe(first.checksum);
          expect(await listDailyActivity()).toEqual(activity);
        },
      ),
      { numRuns: 12 },
    );
  });

  it('rejects a corrupted file', async () => {
    await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T);
    const b = await exportBackup(T + 1);
    b.tables.notes[0]!.term = 'changed';
    await expect(restoreBackup(b, 'merge', T + 2)).rejects.toMatchObject({ code: 'invalid_backup', message: 'checksum_mismatch' });
  });

  it('overwrite soft-deletes local rows that are not in the backup; merge keeps both', async () => {
    const a = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T);
    const backup = await exportBackup(T + 1);
    const b = await addNoteWithSenses({ term: 'shore', senses: [{ meaning_tr: 'kıyı' }] }, T + 2);

    await restoreBackup(backup, 'merge', T + 3);
    expect((await db.notes.get(b.note.id))!.deleted_at).toBeNull();

    const res = await restoreBackup(backup, 'overwrite', T + 4);
    expect(res.deleted).toBe(1 + 1 + 2); // note, sense, recognition + production
    expect((await db.notes.get(b.note.id))!.deleted_at).toBe(T + 4);
    expect((await db.notes.get(a.note.id))!.deleted_at).toBeNull();
    expect((await getSettings()).last_backup_at).toBeNull(); // the file holds the settings as they were before export
  });

  it('merge keeps the newer side by hlc and adds missing logs', async () => {
    const a = await addNoteWithSenses({ term: 'bank', tags: ['v1'], senses: [{ meaning_tr: 'banka' }] }, T);
    const rec = await recognition(a.note.id);
    await answerCard({ card_id: rec.id, rating: Rating.Good, duration_ms: 1 }, T + MIN);
    const backup = await exportBackup(T + 2 * MIN);
    await resetDb();
    await updateSettings({ timezone: 'Europe/Istanbul' }, T);
    await restoreBackup(backup, 'merge', T + 3 * MIN);
    expect(await db.review_logs.count()).toBe(1);
    expect((await db.cards.get(rec.id))!.reps).toBe(1);
    expect((await listDailyActivity())[0]).toMatchObject({ reviews: 1 });
  });

  it('exports CSV', async () => {
    await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T);
    const csv = await exportCsv({ term: 'terim', meaning: 'anlam', ipa: 'IPA', sentence: 'cümle', tags: 'etiketler', created: 'eklenme tarihi' }, T);
    expect(csv).toBe('﻿terim;anlam;IPA;cümle;etiketler;eklenme tarihi\r\nbank;banka;;;;2026-10-21\r\n');
  });
});

describe('integrity', () => {
  it('finds and repairs problems', async () => {
    const a = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T);
    expect((await runIntegrityCheck()).ok).toBe(true);
    const rec = await recognition(a.note.id);
    await db.cards.delete(rec.id); // simulate a lost recognition card
    await db.cards.add({ ...rec, id: 'orphan', note_id: 'missing' });
    await db.outbox.add({ table: 'notes', row_id: 'x', op: 'upsert', payload: {}, attempts: 12, next_attempt_at: 0 });
    const report = await runIntegrityCheck();
    expect(report).toMatchObject({ ok: false, orphanCards: ['orphan'], notesWithoutRecognition: [a.note.id] });
    expect(report.stuckOutbox).toHaveLength(1);
    const fixed = await repairIntegrity(T + 1);
    expect(fixed.after.ok).toBe(true);
    expect((await db.cards.get('orphan'))!.deleted_at).toBe(T + 1);
    expect((await db.cards.where('note_id').equals(a.note.id).toArray()).filter((c) => c.card_type === 'recognition')).toHaveLength(1);
  });
});

describe('adoptGuestData', () => {
  it('stamps user_id on guest rows and queues everything', async () => {
    const a = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T);
    await answerCard({ card_id: (await recognition(a.note.id)).id, rating: Rating.Good, duration_ms: 1 }, T);
    await db.outbox.clear();
    const n = await adoptGuestData('user-1', T + 1);
    expect(n).toBe(1 + 1 + 2 + 1 + 1); // note, sense, 2 cards, settings, 1 log
    expect((await db.notes.get(a.note.id))!.user_id).toBe('user-1');
    expect(await db.outbox.count()).toBe(n);
    const b = await addNoteWithSenses({ term: 'shore', senses: [{ meaning_tr: 'kıyı' }] }, T + 2);
    expect(b.note.user_id).toBe('user-1');
  });
});
