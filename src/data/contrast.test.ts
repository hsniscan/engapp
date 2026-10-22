// Confusable pairs and contrast cards on the device: reported/hidden pairs and the user's
// difference line live in user_content; shared content is a read-only cache; the card is a
// recognition-only note that works offline once the pair was fetched.
import { beforeEach, describe, expect, it } from 'vitest';
import type { ContrastResponse } from '../../supabase/functions/_shared/contrast-contracts';
import { resetDb } from '../test/db';
import { addNoteWithSenses, editNote } from './actions';
import {
  clearConfusion,
  createContrastCard,
  getConfusables,
  getConfusionPicker,
  getContrastCard,
  getContrastDraft,
  hideConfusablePair,
  reportConfusion,
  saveContrastText,
  storeContrastNote,
} from './contrast';
import { db } from './db';
import { ActionError } from './errors';
import { recomputeAllCards, runIntegrityCheck } from './maintenance';
import { repairDuplicateSenses } from './repairs';

const T = Date.UTC(2026, 9, 23, 9);

async function words() {
  const add = async (term: string, meaning: string, lex: string | null) =>
    (await addNoteWithSenses({ term, senses: [{ meaning_tr: meaning, lexicon_sense_id: lex, pos: 'verb' }] }, T)).note;
  const affect = await add('affect', 'etkilemek', 'ls-affect');
  const effect = await add('effect', 'etki', 'ls-effect');
  const influence = await add('influence', 'etkilemek', 'ls-influence');
  const apple = await add('apple', 'elma', null);
  return { affect, effect, influence, apple };
}

const RESPONSE: ContrastResponse = {
  prompt_version: 'contrast-v1',
  ai_called: true,
  model: 'm',
  key: 'ls-affect|ls-effect',
  note: {
    id: 'pn-c1',
    key: 'ls-affect|ls-effect',
    a: { sense_id: 'ls-affect', lemma: 'affect', sentence_en: 'Lack of sleep can affect your mood.', span: [18, 24], sentence_tr: 'Uykusuzluk ruh halini etkileyebilir.' },
    b: { sense_id: 'ls-effect', lemma: 'effect', sentence_en: 'The rule had a big effect on prices.', span: [19, 25], sentence_tr: null },
    difference_tr: 'affect bir fiildir (etkilemek), effect ise bir isimdir (etki).',
    updated_at: 1,
  },
  counts: { dropped: {} },
  usage: null,
};

beforeEach(resetDb);

describe('confusable pairs', () => {
  it('the picker lists the user’s own terms, near ones first', async () => {
    const { affect } = await words();
    const list = await getConfusionPicker(affect.id, '');
    expect(list.map((e) => [e.term, e.near])).toEqual([
      ['effect', 'spelling'],
      ['influence', 'meaning'],
      ['apple', null],
    ]);
    expect((await getConfusionPicker(affect.id, 'elma')).map((e) => e.term)).toEqual(['apple']);
  });

  it('a reported pair is stored privately and offered first; hiding and undo work', async () => {
    const { affect, apple, effect: eff } = await words();
    const pair = await reportConfusion(apple.id, affect.id, {}, T);
    expect([pair.a.term, pair.b.term]).toEqual(['affect', 'apple']);
    const rows = await db.user_content.where('kind').equals('confusion').toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ context: 'reported', selected: true, text: 'affect ↔ apple' });
    expect((await db.outbox.where('table').equals('user_content').count()) > 0).toBe(true);

    // Near pairs show up only when the words are forgotten; the reported one always.
    expect((await getConfusables()).pairs.map((p) => [p.a.term, p.b.term, p.reason])).toEqual([['affect', 'apple', 'reported']]);
    const card = (await db.cards.where('note_id').equals(affect.id).toArray())[0]!;
    await db.cards.update(card.id, { lapses: 3 });
    const all = (await getConfusables()).pairs.map((p) => `${p.a.term}/${p.b.term}`);
    expect(all).toEqual(['affect/apple', 'affect/effect', 'affect/influence']);
    // The leech sheet of "effect" sees its pairs only.
    expect((await getConfusables({ noteId: eff.id })).pairs.map((p) => `${p.a.term}/${p.b.term}`)).toEqual(['affect/effect']);

    await hideConfusablePair(pair, T + 1);
    expect((await getConfusables()).pairs.map((p) => `${p.a.term}/${p.b.term}`)).toEqual(['affect/effect', 'affect/influence']);
    await clearConfusion('affect', 'apple', T + 2);
    expect((await db.user_content.where('kind').equals('confusion').first())!.deleted_at).toBe(T + 2);
  });
});

describe('contrast cards', () => {
  it('a draft uses the cached shared content; the card is recognition-only and private', async () => {
    const { affect, effect: eff } = await words();
    const pair = { a: { note_id: affect.id, term: 'affect', term_norm: 'affect', sense_id: null }, b: { note_id: eff.id, term: 'effect', term_norm: 'effect', sense_id: null } };
    const sA = (await db.senses.where('note_id').equals(affect.id).first())!;
    const sE = (await db.senses.where('note_id').equals(eff.id).first())!;
    const sides = { a: { ...pair.a, sense_id: sA.id }, b: { ...pair.b, sense_id: sE.id } };

    const empty = await getContrastDraft(sides);
    expect(empty).toMatchObject({ difference: null, shared_id: null, can_ask: true, existing_note_id: null });

    await storeContrastNote(RESPONSE); // as after ai-contrast; later drafts work offline
    const draft = await getContrastDraft(sides);
    expect(draft.a).toMatchObject({ term: 'affect', sentence: 'Lack of sleep can affect your mood.', meaning: 'etkilemek' });
    expect(draft.b).toMatchObject({ term: 'effect', sentence: 'The rule had a big effect on prices.' });
    expect(draft.shared_id).toBe('pn-c1');

    const note = await createContrastCard(
      {
        a: { note_id: affect.id, sense_id: sA.id, sentence: draft.a.sentence, sentence_tr: draft.a.sentence_tr },
        b: { note_id: eff.id, sense_id: sE.id, sentence: 'MY OWN effect sentence.', sentence_tr: null },
        difference: '  affect fiil,\n effect isim. ',
        shared_id: draft.shared_id,
      },
      T + 10,
    );
    expect(note).toMatchObject({ term: 'affect ↔ effect', term_type: 'contrast' });
    const cards = await db.cards.where('note_id').equals(note.id).toArray();
    expect(cards.map((c) => [c.card_type, c.sense_id, c.unlocked])).toEqual([['recognition', null, true]]);
    const view = await getContrastCard(note.id);
    expect(view.sides!.map((s) => [s.term, s.sense.meaning_tr, s.sense.source_sentence])).toEqual([
      ['affect', 'etkilemek', 'Lack of sleep can affect your mood.'],
      ['effect', 'etki', 'MY OWN effect sentence.'],
    ]);
    expect(view.sides![0]!.sense.span).toEqual([18, 24]);
    expect(view.difference).toBe('affect fiil, effect isim.');

    await saveContrastText(note.id, 'affect: etkilemek; effect: etki', T + 20);
    expect((await getContrastCard(note.id)).difference).toBe('affect: etkilemek; effect: etki');
    // The shared cache is untouched by the user's text.
    expect(JSON.stringify(await db.lexicon_pair_notes.toArray())).not.toContain('MY OWN');
    expect(JSON.stringify(await db.lexicon_pair_notes.toArray())).not.toContain('affect: etkilemek;');

    // A second card for the pair is refused; the pair is no longer suggested.
    await expect(
      createContrastCard({ a: { note_id: eff.id, sense_id: sE.id, sentence: null, sentence_tr: null }, b: { note_id: affect.id, sense_id: sA.id, sentence: null, sentence_tr: null }, difference: 'x y z', shared_id: null }, T + 30),
    ).rejects.toMatchObject({ code: 'duplicate_term' });
    expect((await getContrastDraft(sides)).existing_note_id).toBe(note.id);
    await reportConfusion(affect.id, eff.id, {}, T + 40);
    expect((await getConfusables()).pairs.some((p) => p.key.includes('effect') && p.key.includes('affect'))).toBe(false);

    // Repairs, recompute and the integrity check leave it alone; it stays recognition-only.
    expect(await repairDuplicateSenses(T + 50)).toBe(0);
    await recomputeAllCards();
    await editNote(note.id, { tags: ['fark'] }, T + 60);
    expect(await db.cards.where('note_id').equals(note.id).count()).toBe(1);
    expect((await runIntegrityCheck()).ok).toBe(true);
  });

  it('refuses a pair whose "a ↔ b" term is over the server limit, and writes nothing', async () => {
    // Each term fits (200 code points); together with " ↔ " they do not.
    const add = async (term: string) => (await addNoteWithSenses({ term, senses: [{ meaning_tr: 'x' }] }, T)).note;
    const a = await add('a'.repeat(100));
    const b = await add('b'.repeat(100));
    const [sA, sB] = await Promise.all([a, b].map(async (n) => (await db.senses.where('note_id').equals(n.id).first())!));
    const before = await db.notes.count();
    const input = (x: typeof a, y: typeof b, sx: typeof sA, sy: typeof sB) => ({
      a: { note_id: x.id, sense_id: sx!.id, sentence: null, sentence_tr: null },
      b: { note_id: y.id, sense_id: sy!.id, sentence: null, sentence_tr: null },
      difference: 'a ve b farklı',
      shared_id: null,
    });
    // 100 + 3 + 100 = 203 code points.
    await expect(createContrastCard(input(a, b, sA, sB), T + 10)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await db.notes.count()).toBe(before);
    // Exactly at the limit is fine: 98 + 3 + 99 = 200.
    const c = await add('c'.repeat(98));
    const d = await add('d'.repeat(99));
    const [sC, sD] = await Promise.all([c, d].map(async (n) => (await db.senses.where('note_id').equals(n.id).first())!));
    expect((await createContrastCard(input(c, d, sC, sD), T + 20)).term).toHaveLength(200);
  });

  it('two words with the same Turkish meaning keep both senses; an empty difference is refused', async () => {
    const { affect, influence } = await words();
    const sA = (await db.senses.where('note_id').equals(affect.id).first())!;
    const sI = (await db.senses.where('note_id').equals(influence.id).first())!;
    await expect(
      createContrastCard({ a: { note_id: affect.id, sense_id: sA.id, sentence: null, sentence_tr: null }, b: { note_id: influence.id, sense_id: sI.id, sentence: null, sentence_tr: null }, difference: '  ', shared_id: null }, T),
    ).rejects.toBeInstanceOf(ActionError);
    const note = await createContrastCard(
      { a: { note_id: affect.id, sense_id: sA.id, sentence: null, sentence_tr: null }, b: { note_id: influence.id, sense_id: sI.id, sentence: null, sentence_tr: null }, difference: 'affect daha doğrudan, influence daha dolaylı.', shared_id: null },
      T,
    );
    expect(await db.senses.where('note_id').equals(note.id).count()).toBe(2);
    expect(await repairDuplicateSenses(T + 1)).toBe(0);
    expect(await db.senses.where('note_id').equals(note.id).filter((s) => s.deleted_at === null).count()).toBe(2);
  });
});
