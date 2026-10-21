import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../test/db';
import type { Id } from '../domain/types';
import { addNoteWithSenses, answerCard, editSense, type SenseInput, undoAnswer } from './actions';
import { db } from './db';
import { repairDuplicateSenses, repairListEntrySentences } from './repairs';

const T = Date.UTC(2026, 9, 21, 9);

beforeEach(resetDb);

describe('repairListEntrySentences', () => {
  it('cuts the word-list prefix, keeps the translation and syncs the fix; runs once', async () => {
    const a = await addNoteWithSenses(
      {
        term: 'trailer',
        senses: [
          {
            meaning_tr: 'karavan',
            source_sentence: '1988 trailer I own a trailer.',
            source_sentence_tr: 'Bir karavanım var.',
            span: [21, 28],
          },
        ],
      },
      T,
    );
    await addNoteWithSenses(
      { term: 'people', senses: [{ meaning_tr: 'insanlar', source_sentence: '3 people came.', span: [2, 8] }] },
      T,
    );
    const outboxBefore = await db.outbox.count();
    expect(await repairListEntrySentences(T + 1000)).toBe(1);
    const sense = (await db.senses.where('note_id').equals(a.note.id).first())!;
    expect(sense).toMatchObject({
      source_sentence: 'I own a trailer.',
      span: [8, 15],
      source_sentence_tr: 'Bir karavanım var.',
    });
    const cloze = await db.cards.where('note_id').equals(a.note.id).filter((c) => c.card_type === 'cloze').first();
    expect(cloze?.deleted_at ?? null).toBeNull();
    expect(await db.outbox.count()).toBeGreaterThan(outboxBefore);
    expect((await db.senses.filter((s) => s.source_sentence === '3 people came.').count())).toBe(1);
    expect(await repairListEntrySentences(T + 2000)).toBe(0);
  });
});

describe('repairDuplicateSenses', () => {
  const S = 'Thank you very much for the invitation.';

  /**
   * A note with the given senses in order, written the way old imports did (the add guard
   * now refuses duplicates, so each later sense is added with a placeholder and edited).
   */
  async function noteWith(term: string, senses: SenseInput[]): Promise<Id[]> {
    const ids: Id[] = [];
    for (const [i, s] of senses.entries()) {
      const res = await addNoteWithSenses({ term, senses: [{ ...s, meaning_tr: `yer tutucu ${term} ${i}`, source_sentence: null }] }, T);
      const sense = res.addedSenses[0]!;
      await editSense(
        sense.id,
        { meaning_tr: s.meaning_tr, source_sentence: s.source_sentence ?? null, span: s.span ?? null, source_sentence_tr: s.source_sentence_tr ?? null },
        T,
      );
      ids.push(sense.id);
    }
    return ids;
  }
  const span: [number, number] = [28, 38];
  const study = async (senseId: Id, at: number) => {
    const card = (await db.cards.where('sense_id').equals(senseId).first())!;
    return answerCard({ card_id: card.id, rating: 3, duration_ms: 1000 }, at);
  };
  const live = async (id: Id) => (await db.senses.get(id))!.deleted_at === null;

  it('removes an unstudied duplicate sense with its cards and keeps the richer meaning; runs once', async () => {
    const [attend, go] = await noteWith('invitation', [
      { meaning_tr: 'davetiye, davet', pos: 'noun', lexicon_sense_id: 'L-attend', source_sentence: S, span },
      { meaning_tr: 'davet', pos: 'noun', lexicon_sense_id: 'L-go', source_sentence: S, span, source_sentence_tr: 'Davetiniz için çok teşekkürler.' },
    ]);
    const [bankRiver, bankMoney] = await noteWith('bank', [
      { meaning_tr: 'kıyı', pos: 'noun', lexicon_sense_id: 'L-river' },
      { meaning_tr: 'banka', pos: 'noun', lexicon_sense_id: 'L-money' },
    ]);
    const outboxBefore = await db.outbox.count();

    expect(await repairDuplicateSenses(T + 1000)).toBe(1);
    expect(await live(attend!)).toBe(true);
    expect(await live(go!)).toBe(false);
    expect((await db.cards.where('sense_id').equals(go!).toArray()).every((c) => c.deleted_at !== null)).toBe(true);
    expect((await db.cards.where('sense_id').equals(attend!).toArray()).every((c) => c.deleted_at === null)).toBe(true);
    expect(await db.senses.get(attend!)).toMatchObject({
      meaning_tr: 'davetiye, davet',
      meaning_tr_override: null,
      source_sentence_tr: 'Davetiniz için çok teşekkürler.', // taken from the duplicate
    });
    expect(await live(bankRiver!)).toBe(true);
    expect(await live(bankMoney!)).toBe(true);
    expect(await db.outbox.count()).toBeGreaterThan(outboxBefore); // syncs
    expect(await repairDuplicateSenses(T + 2000)).toBe(0);
  });

  it('merges the meaning only when it says more ("davetiye, davet" over "davet")', async () => {
    const [first, second] = await noteWith('invitation', [
      { meaning_tr: 'davet', pos: 'noun', lexicon_sense_id: 'L-go', source_sentence: S, span },
      { meaning_tr: 'davetiye, davet', pos: 'noun', lexicon_sense_id: 'L-attend', source_sentence: S, span },
    ]);
    expect(await repairDuplicateSenses(T + 1000)).toBe(1);
    expect(await live(first!)).toBe(true);
    expect(await live(second!)).toBe(false);
    expect(await db.senses.get(first!)).toMatchObject({ meaning_tr: 'davet', meaning_tr_override: 'davetiye, davet' });
  });

  it('never deletes a studied sense: the unstudied twin goes, two studied twins stay', async () => {
    const [plain, studied] = await noteWith('invitation', [
      { meaning_tr: 'davet', pos: 'noun', lexicon_sense_id: 'L-go', source_sentence: S, span },
      { meaning_tr: 'davetiye, davet', pos: 'noun', lexicon_sense_id: 'L-attend', source_sentence: S, span },
    ]);
    await study(studied!, T + 500);
    const [a, b] = await noteWith('offer', [
      { meaning_tr: 'teklif', pos: 'noun', lexicon_sense_id: 'L-o1' },
      { meaning_tr: 'teklif, öneri', pos: 'noun', lexicon_sense_id: 'L-o2' },
    ]);
    await study(a!, T + 600);
    await study(b!, T + 700);

    expect(await repairDuplicateSenses(T + 1000)).toBe(1);
    expect(await live(plain!)).toBe(false);
    expect(await live(studied!)).toBe(true);
    expect(await live(a!)).toBe(true);
    expect(await live(b!)).toBe(true);
  });

  it('an undone answer is no history', async () => {
    const [first, second] = await noteWith('invitation', [
      { meaning_tr: 'davetiye, davet', pos: 'noun', lexicon_sense_id: 'L-attend', source_sentence: S, span },
      { meaning_tr: 'davet', pos: 'noun', lexicon_sense_id: 'L-go', source_sentence: S, span },
    ]);
    const answer = await study(second!, T + 500);
    await undoAnswer(answer.log.id, T + 600);
    expect(await repairDuplicateSenses(T + 1000)).toBe(1);
    expect(await live(first!)).toBe(true);
    expect(await live(second!)).toBe(false);
  });

  it('leaves senses typed by hand without a part of speech alone', async () => {
    const [a, b] = await noteWith('invitation', [{ meaning_tr: 'davet' }, { meaning_tr: 'davetiye, davet' }]);
    expect(await repairDuplicateSenses(T + 1000)).toBe(0);
    expect(await live(a!)).toBe(true);
    expect(await live(b!)).toBe(true);
  });
});
