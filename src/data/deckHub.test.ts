// Desteler data: the owned index, the Destelerim overview and adding a suggested deck.
import { beforeEach, describe, expect, it } from 'vitest';
import { levelRank } from '../domain/level';
import { Rating, type CefrLevel } from '../domain/types';
import { wordBankId, type WordBankEntry } from '../domain/wordBank';
import { resetDb } from '../test/db';
import { addNoteWithSenses, answerCard } from './actions';
import { db } from './db';
import { addSuggestedDeck, findTagDeck, getDeckWords, getMyDecks, getOwnedIndex } from './deckHub';
import { createDeck, listDecks } from './decks';
import { markKnown } from './knownTerms';
import { updateSettings } from './settings';

const T = Date.UTC(2026, 9, 21, 9);
const DAY = 86_400_000;

const entry = (lemma: string, cefr: CefrLevel = 'B1', pos = 'verb'): WordBankEntry => ({
  id: wordBankId(lemma, pos),
  lemma_norm: lemma,
  pos,
  lemma,
  cefr,
  list_source: levelRank(cefr) >= 4 ? 'octanove' : 'cefrj',
  zipf: 4,
  lexicon_term_id: null,
  senses: [
    {
      meaning_tr: `${lemma} anlamı`,
      example_en: `They ${lemma} it.`,
      example_tr: 'Onu yaptılar.',
      sense_id: null,
    },
  ],
});

beforeEach(async () => {
  await resetDb();
  await updateSettings({ timezone: 'Europe/Istanbul' }, T - 30 * DAY);
});

async function word(term: string, at = T - 20 * DAY) {
  return (await addNoteWithSenses({ term, senses: [{ meaning_tr: `${term} anlamı` }] }, at)).note;
}

async function recognition(noteId: string) {
  return (await db.cards.where('note_id').equals(noteId).toArray()).find(
    (c) => c.card_type === 'recognition',
  )!;
}

describe('getOwnedIndex', () => {
  it('known words and the stage of each carded word', async () => {
    const a = await word('avoid');
    await word('admit');
    await markKnown('suggest', 'manual', T - DAY);
    await answerCard({ card_id: (await recognition(a.id)).id, rating: Rating.Good, duration_ms: 1000 }, T - 10 * DAY);
    const idx = await getOwnedIndex(T);
    expect([...idx.known]).toEqual(['suggest']);
    expect(idx.stage.get('admit')).toBe('new');
    expect(idx.stage.get('avoid')).not.toBe('new');
  });
});

describe('addSuggestedDeck', () => {
  it('adds only new words, tags carded ones, never re-adds known ones, makes one deck', async () => {
    const had = await word('avoid');
    await markKnown('suggest', 'manual', T - DAY);
    const words = ['avoid', 'suggest', 'admit', 'afford'].map((l) => entry(l));
    const progress: number[] = [];
    const r = await addSuggestedDeck(words, 'B1 fiiller', {
      now: T,
      onProgress: (d) => progress.push(d),
    });
    expect(r).toMatchObject({ added: 2, alreadyCarded: 1, known: 1 });
    expect(r.cards).toBeGreaterThanOrEqual(2);
    expect(progress).toEqual([1, 2]);

    const notes = (await db.notes.toArray()).filter((n) => n.deleted_at === null);
    expect(notes.map((n) => n.term).sort()).toEqual(['admit', 'afford', 'avoid']);
    for (const n of notes) expect(n.tags).toEqual(['B1 fiiller']);
    expect((await db.notes.get(had.id))!.tags).toEqual(['B1 fiiller']);
    const added = notes.find((n) => n.term === 'admit')!;
    const senses = await db.senses.where('note_id').equals(added.id).toArray();
    expect(senses[0]).toMatchObject({ meaning_tr: 'admit anlamı', pos: 'verb' });

    const decks = await listDecks();
    expect(decks).toEqual([
      expect.objectContaining({ name: 'B1 fiiller', filter: { v: 1, tags: ['B1 fiiller'] } }),
    ]);
    expect((await findTagDeck('b1 FİİLLER'))?.id).toBe(decks[0]!.id);

    // Again: nothing new, no second deck.
    const again = await addSuggestedDeck(words, 'B1 fiiller', { now: T + 1000 });
    expect(again).toMatchObject({ added: 0, alreadyCarded: 3, known: 1 });
    expect(again.deck?.id).toBe(decks[0]!.id);
    expect(await listDecks()).toHaveLength(1);
  });

  it('a set the user fully knows creates no deck', async () => {
    await markKnown('avoid', 'manual', T - DAY);
    const r = await addSuggestedDeck([entry('avoid')], 'B1 fiiller', { now: T });
    expect(r).toMatchObject({ added: 0, known: 1, deck: null });
    expect(await listDecks()).toEqual([]);
  });
});

describe('getMyDecks and getDeckWords', () => {
  it('stage mix and due cards per deck and for all words', async () => {
    const a = await word('deadline');
    await word('colleague');
    await word('thrive');
    await db.notes.update(a.id, { tags: ['iş'] });
    await createDeck({ name: 'İş', filter: { v: 1, tags: ['iş'] } }, T - DAY);
    await answerCard(
      { card_id: (await recognition(a.id)).id, rating: Rating.Good, duration_ms: 1000 },
      T - 2 * DAY,
    );
    const view = await getMyDecks(T);
    expect(view.all).toMatchObject({ total: 3, fresh: 2 });
    expect(view.all.cards).toBeGreaterThanOrEqual(3);
    expect(view.decks).toHaveLength(1);
    expect(view.decks[0]!.mix).toMatchObject({ total: 1, fresh: 0 });
    expect(view.decks[0]!.mix!.learned + view.decks[0]!.mix!.studying).toBe(1);
    expect(view.tagCount).toBe(1);

    const detail = await getDeckWords(view.decks[0]!.deck.id, T);
    expect(detail?.words.map((w) => [w.note.term, w.meaning])).toEqual([
      ['deadline', 'deadline anlamı'],
    ]);
    expect(await getDeckWords('nope', T)).toBeNull();
  });
});
