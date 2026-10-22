import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../test/db';
import type { WordBankRow } from '../../supabase/functions/_shared/wordbank-contract';
import { entryFromRow } from '../domain/wordBank';
import { addNoteWithSenses } from './actions';
import { discardLocalData } from './account';
import { db } from './db';
import { markKnown } from './knownTerms';
import { adoptGuestData } from './maintenance';
import {
  addFromWordBank,
  applyWordBankPage,
  bankNoteInput,
  getOwnedTerms,
  getWordBankCursor,
  listWordBank,
  WORD_BANK_META,
} from './wordBank';

const T = Date.UTC(2026, 9, 22, 9);
const SID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const row = (over: Partial<WordBankRow> = {}): WordBankRow => ({
  lemma_norm: 'invitation',
  pos: 'noun',
  lemma: 'invitation',
  cefr: 'A2',
  zipf: 4.2,
  lexicon_term_id: SID(1),
  senses: [
    {
      meaning_tr: 'davet, davetiye',
      example_en: 'Thanks for the invitation!',
      example_tr: 'Davet için teşekkürler!',
      sense_id: SID(11),
    },
    {
      meaning_tr: 'teşvik',
      example_en: 'The open door was an invitation to thieves.',
      example_tr: 'Açık kapı hırsızlara davetti.',
      sense_id: SID(12),
    },
  ],
  retired: false,
  server_seq: 5,
  ...over,
});

beforeEach(async () => {
  await resetDb();
});

describe('word bank copy', () => {
  it('stores pulled pages, removes retired rows and moves the cursor', async () => {
    const r = await applyWordBankPage([
      row(),
      row({ lemma_norm: 'monday', lemma: 'Monday', pos: 'noun', cefr: 'A1', server_seq: 7 }),
      { lemma_norm: 'broken', server_seq: 9 }, // invalid: skipped, but the cursor passes it
    ]);
    expect(r).toEqual({ stored: 2, removed: 0, cursor: 9 });
    expect((await listWordBank()).map((e) => e.id).sort()).toEqual([
      'invitation|noun',
      'monday|noun',
    ]);
    expect(await db.word_bank.get('monday|noun')).toMatchObject({ lemma: 'Monday', cefr: 'A1' });

    const r2 = await applyWordBankPage([row({ retired: true, server_seq: 12 })]);
    expect(r2).toEqual({ stored: 0, removed: 1, cursor: 12 });
    expect(await getWordBankCursor()).toBe(12);
    // An older page never moves the cursor back.
    await applyWordBankPage([row({ server_seq: 3 })]);
    expect(await getWordBankCursor()).toBe(12);
  });

  it('starts over when the copy is empty but a cursor is left', async () => {
    await db.meta.put({ key: WORD_BANK_META.cursor, value: 40 });
    expect(await getWordBankCursor()).toBe(0);
  });

  it('is device content: kept when local data is discarded at sign-in', async () => {
    await applyWordBankPage([row()]);
    await discardLocalData('user-1');
    expect(await db.word_bank.count()).toBe(1);
    expect(await getWordBankCursor()).toBe(5);
  });
});

describe('adding from the bank', () => {
  it('builds the same input as the other add paths: lexicon link, pos, sentence and span', () => {
    const input = bankNoteInput(entryFromRow(row()), [1]);
    expect(input).toEqual({
      term: 'invitation',
      term_type: 'word',
      lexicon_term_id: SID(1),
      senses: [
        {
          meaning_tr: 'teşvik',
          pos: 'noun',
          lexicon_sense_id: SID(12),
          source_sentence: 'The open door was an invitation to thieves.',
          source_sentence_tr: 'Açık kapı hırsızlara davetti.',
          span: [21, 31],
        },
      ],
    });
    // Default: the first (most common) meaning only.
    expect(bankNoteInput(entryFromRow(row())).senses.map((s) => s.meaning_tr)).toEqual([
      'davet, davetiye',
    ]);
  });

  it('creates a guest note with its cards like the manual form; the first sign-in adopts it', async () => {
    const res = await addFromWordBank([{ entry: entryFromRow(row()) }], T);
    expect(res).toEqual({ added: ['invitation'], unchanged: [], cards: 3 });
    const note = (await db.notes.toArray())[0]!;
    expect(note).toMatchObject({
      term: 'invitation',
      term_norm: 'invitation',
      user_id: null,
      lexicon_term_id: SID(1),
    });
    const senses = await db.senses.where('note_id').equals(note.id).toArray();
    expect(senses).toHaveLength(1);
    expect(senses[0]).toMatchObject({
      lexicon_sense_id: SID(11),
      meaning_tr: 'davet, davetiye',
      pos: 'noun',
      span: [15, 25],
    });
    const types = (await db.cards.where('note_id').equals(note.id).toArray())
      .map((c) => c.card_type)
      .sort();
    expect(types).toEqual(['cloze', 'production', 'recognition']);
    expect(await db.outbox.count()).toBeGreaterThan(0);

    await adoptGuestData('user-9', T + 1000);
    expect((await db.notes.get(note.id))!.user_id).toBe('user-9');
  });

  it('adds nothing twice; owned words are marked from notes and known words', async () => {
    const entry = entryFromRow(row());
    await addFromWordBank([{ entry }], T);
    const again = await addFromWordBank([{ entry }], T + 1);
    expect(again).toEqual({ added: [], unchanged: ['invitation'], cards: 0 });
    // A second meaning of the same word joins the existing note.
    const more = await addFromWordBank([{ entry, senses: [1] }], T + 2);
    expect(more.added).toEqual(['invitation']);
    expect(await db.notes.count()).toBe(1);

    await markKnown('Monday', 'manual', T);
    await addNoteWithSenses({ term: 'Apple', senses: [{ meaning_tr: 'elma' }] }, T);
    const owned = await getOwnedTerms();
    expect([...owned.carded].sort()).toEqual(['apple', 'invitation']);
    expect([...owned.known]).toEqual(['monday']);
  });
});
