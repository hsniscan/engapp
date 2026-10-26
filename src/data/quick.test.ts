import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../test/db';
import type { WordBankRow } from '../../supabase/functions/_shared/wordbank-contract';
import type { LexiconSense } from '../domain/types';
import { entryFromRow } from '../domain/wordBank';
import { lookupForms } from '../features/quick/route';
import { addNoteWithSenses } from './actions';
import { db } from './db';
import { markKnown } from './knownTerms';
import { addQuickCard, previewFromSenses, quickPreview } from './quick';

const T = Date.UTC(2026, 10, 1, 9);
const SID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const bankRow = (over: Partial<WordBankRow> = {}): WordBankRow => ({
  lemma_norm: 'postpone',
  pos: 'verb',
  lemma: 'postpone',
  cefr: 'B2',
  list_source: 'cefrj',
  zipf: 3.4,
  lexicon_term_id: SID(1),
  senses: [
    {
      meaning_tr: 'ertelemek',
      example_en: 'They postponed the meeting.',
      example_tr: 'Toplantıyı ertelediler.',
      sense_id: SID(11),
    },
    {
      meaning_tr: 'sonraya bırakmak',
      example_en: 'We cannot postpone it forever.',
      example_tr: 'Sonsuza dek sonraya bırakamayız.',
      sense_id: SID(12),
    },
  ],
  retired: false,
  server_seq: 1,
  ...over,
});

const lexSense = (over: Partial<LexiconSense> = {}): LexiconSense => ({
  id: SID(21),
  term_id: SID(20),
  lemma: 'serendipity',
  lemma_norm: 'serendipity',
  term_type: 'word',
  pos: 'noun',
  gloss_en: 'a happy accident',
  meaning_tr: 'mutlu tesadüf',
  ipa: 'ˌserənˈdɪpəti',
  updated_at: T,
  cefr: 'C1',
  ...over,
});

const preview = (term: string) => quickPreview(term, lookupForms(term));

beforeEach(async () => {
  await resetDb();
});

describe('quickPreview: on the device first', () => {
  it('finds an inflected word in Kelime Bankası under its base form', async () => {
    await db.word_bank.put(entryFromRow(bankRow()));
    const p = await preview('postponed');
    expect(p.origin).toBe('bank');
    expect(p.term).toBe('postpone');
    expect(p.matched).toBe('postpone');
    expect(p.cefr).toBe('B2');
    expect(p.senses.map((s) => s.meaning_tr)).toEqual(['ertelemek', 'sonraya bırakmak']);
    expect(p.senses[0]!.example_en).toBe('They postponed the meeting.');
    expect(p.owned).toBeNull();
  });

  it('falls back to the lexicon cache', async () => {
    await db.lexicon_cache.put(lexSense());
    const p = await preview('Serendipity');
    expect(p.origin).toBe('lexicon');
    expect(p.term).toBe('serendipity');
    expect(p.ipa).toBe('ˌserənˈdɪpəti');
    expect(p.lexiconTermId).toBe(SID(20));
    expect(p.senses).toEqual([
      expect.objectContaining({ meaning_tr: 'mutlu tesadüf', lexicon_sense_id: SID(21) }),
    ]);
  });

  it('nothing known: the selection itself, no senses', async () => {
    const p = await preview('flibbertigibbet');
    expect(p).toMatchObject({ origin: 'none', term: 'flibbertigibbet', senses: [], matched: null });
  });

  it('says when the word is already carded or known', async () => {
    await db.word_bank.put(entryFromRow(bankRow()));
    await markKnown('postpone', 'manual', T);
    expect((await preview('postpone')).owned).toBe('known');
    await addNoteWithSenses({ term: 'postpone', senses: [{ meaning_tr: 'ertelemek' }] }, T);
    expect((await preview('postponing')).owned).toBe('carded');
  });

  it('a carded word nobody else knows shows the meaning on the user’s card (v0.5.1)', async () => {
    await addNoteWithSenses(
      {
        term: 'flibbertigibbet',
        senses: [{ meaning_tr: 'geveze' }, { meaning_tr: 'havai kişi', pos: 'noun' }],
      },
      T,
    );
    const p = await preview('flibbertigibbet');
    expect(p.origin).toBe('none');
    expect(p.owned).toBe('carded');
    expect(p.mine).toEqual([
      { meaning_tr: 'geveze', pos: null },
      { meaning_tr: 'havai kişi', pos: 'noun' },
    ]);
    expect((await preview('serendipity')).mine).toEqual([]);
  });

  it('shows a cached picture of the sense', async () => {
    await db.word_bank.put(entryFromRow(bankRow()));
    await db.images.put({
      id: SID(31),
      sense_id: SID(12),
      variant: 0,
      svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      alt_tr: 'Takvimde ileri alınan gün',
      status: 'approved',
      created_at: '2026-10-01T00:00:00Z',
      fetched_at: T,
    });
    expect((await preview('postpone')).picture).toMatchObject({ id: SID(31), isNew: false });
  });
});

describe('addQuickCard', () => {
  it('bank word: the picked meanings through the bank add path', async () => {
    await db.word_bank.put(entryFromRow(bankRow()));
    const p = await preview('postponed');
    const res = await addQuickCard(p, [p.senses[1]!.key], T);
    expect(res).toMatchObject({ term: 'postpone', added: 1 });
    const senses = await db.senses.toArray();
    expect(senses.map((s) => s.meaning_tr)).toEqual(['sonraya bırakmak']);
    expect(senses[0]!.lexicon_sense_id).toBe(SID(12));
    expect((await db.notes.toArray())[0]!.term).toBe('postpone');
  });

  it('dictionary word: no source sentence (a selected word has none)', async () => {
    await db.lexicon_cache.put(lexSense());
    const p = await preview('serendipity');
    const res = await addQuickCard(p, [], T); // nothing picked → the first meaning
    expect(res.added).toBe(1);
    expect(res.cards).toBeGreaterThan(0);
    const [sense] = await db.senses.toArray();
    expect(sense).toMatchObject({
      meaning_tr: 'mutlu tesadüf',
      source_sentence: null,
      lexicon_sense_id: SID(21),
    });
    const [note] = await db.notes.toArray();
    expect(note).toMatchObject({
      term: 'serendipity',
      ipa: 'ˌserənˈdɪpəti',
      lexicon_term_id: SID(20),
    });
    // Twice: nothing new.
    expect((await addQuickCard(await preview('serendipity'), [], T + 1)).added).toBe(0);
  });

  it('AI senses filed under another lemma still make a card', async () => {
    const base = await preview('went');
    const p = previewFromSenses(base, [
      {
        lexicon_sense_id: SID(41),
        lexicon_term_id: SID(40),
        pos: 'verb',
        gloss_en: 'to move',
        meaning_tr: 'gitmek',
        ipa: null,
      },
    ]);
    expect(p.origin).toBe('lexicon');
    expect((await addQuickCard(p, [SID(41)], T)).added).toBe(1);
  });
});
