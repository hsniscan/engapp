// Example rotation through the data layer (v0.5 İP10, docs/decisions/0052): sentences from the
// user's own texts come right after the card's own sentence, a different one on every review,
// and the user's text is never written anywhere but its own row.
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../test/db';
import { addNoteWithSenses } from './actions';
import { db } from './db';
import { storeExamples } from './examples';
import { META, setMeta } from './meta';
import { getCardView } from './queries';
import { saveText } from './texts';
import { lastShownKey, resetTextSentenceCache } from './textSentences';

const T = Date.UTC(2026, 10, 2, 9);
const OWN_TEXT = 'The harbour was full that morning. Somehow the small crew coped with the storm for hours.';

async function cope() {
  const r = await addNoteWithSenses(
    {
      term: 'cope',
      senses: [
        {
          meaning_tr: 'başa çıkmak',
          pos: 'verb',
          lexicon_sense_id: 'ls-cope',
          source_sentence: 'I can cope.',
          source_sentence_tr: 'Başa çıkabilirim.',
          span: [6, 10],
        },
      ],
    },
    T - 1000,
  );
  return r.createdCards.find((c) => c.card_type === 'recognition')!;
}

beforeEach(async () => {
  await resetDb();
  resetTextSentenceCache();
  await db.transaction('rw', db.meta, () => setMeta(META.userId, 'user-1'));
});

describe('getCardView: sentences from the user’s texts', () => {
  it('rotates source sentence → own text sentence → example sentence', async () => {
    const card = await cope();
    await saveText({ kind: 'paste', title: 'Notes', body: OWN_TEXT }, T - 500);
    await storeExamples([
      {
        id: 'e1',
        sense_id: 'ls-cope',
        context: 'daily',
        level_band: 'B1',
        text_en: 'We had to cope with the delay.',
        span: [10, 14],
        translations: { tr: 'Gecikmeyle başa çıkmak zorunda kaldık.' },
        status: 'active',
        updated_at: 1,
      },
    ]);
    const at = async (reps: number) => {
      await db.cards.update(card.id, { reps });
      return (await getCardView(card.id, T))!.sentence;
    };
    const source = await at(0);
    expect(source).toMatchObject({ text: 'I can cope.' });
    expect(source!.origin).toBeUndefined();
    const own = await at(1);
    expect(own).toMatchObject({ text: 'Somehow the small crew coped with the storm for hours.', origin: 'text', tr: null, exampleId: null });
    expect(own!.text.slice(own!.span![0], own!.span![1])).toBe('coped');
    expect(await at(2)).toMatchObject({ exampleId: 'e1' });
  });

  it('a new text in between never repeats the sentence of the previous review', async () => {
    const card = await cope();
    await saveText({ kind: 'paste', title: 'One', body: OWN_TEXT }, T - 500);
    await db.cards.update(card.id, { reps: 1 });
    const first = (await getCardView(card.id, T))!.sentence!.text;
    expect(first).toContain('coped with the storm');
    // A newer text adds a sentence in front; the next review would land on the same one.
    await saveText({ kind: 'paste', title: 'Two', body: 'Most families coped well with the new rules at school.' }, T - 100);
    await db.cards.update(card.id, { reps: 2 });
    const second = (await getCardView(card.id, T))!.sentence!.text;
    expect(second).not.toBe(first);
    // Opening the same card again shows the same sentence.
    expect((await getCardView(card.id, T))!.sentence!.text).toBe(second);
  });

  it('a word with two meanings does not use text sentences (they cannot tell the meanings apart)', async () => {
    const r = await addNoteWithSenses(
      { term: 'cope', senses: [{ meaning_tr: 'başa çıkmak', source_sentence: 'I can cope.', span: [6, 10] }, { meaning_tr: 'cüppe', source_sentence: 'A priest wore a cope.', span: [16, 20] }] },
      T - 1000,
    );
    await saveText({ kind: 'paste', title: 'Notes', body: OWN_TEXT }, T - 500);
    const card = r.createdCards.find((c) => c.card_type === 'recognition')!;
    for (const reps of [0, 1, 2, 3]) {
      await db.cards.update(card.id, { reps });
      expect((await getCardView(card.id, T))!.sentence?.origin).toBeUndefined();
    }
  });

  it('user text stays on the device: nothing is queued for sync and only a hash is remembered', async () => {
    const card = await cope();
    await saveText({ kind: 'paste', title: 'Notes', body: OWN_TEXT }, T - 500);
    const outboxBefore = await db.outbox.count();
    await db.cards.update(card.id, { reps: 1 });
    expect((await getCardView(card.id, T))!.sentence?.origin).toBe('text');
    expect(await db.outbox.count()).toBe(outboxBefore);
    const meta = await db.meta.get(lastShownKey(card.id));
    expect(meta?.value).toEqual({ reps: 1, key: expect.stringMatching(/^[0-9a-f]{8}$/) });
    for (const table of ['lexicon_cache', 'lexicon_examples', 'user_content', 'content_feedback', 'chunk_cache'] as const) {
      expect(JSON.stringify(await db.table(table).toArray())).not.toContain('crew coped');
    }
  });

  it('a graded library text brings its Turkish translation', async () => {
    const card = await cope();
    await db.graded_bodies.put({
      id: 'g1',
      title: 'Winter',
      sentences: [{ en: 'The village coped with the coldest winter in years.', tr: 'Köy yılların en soğuk kışıyla başa çıktı.', audio_key: null, p: 0 }],
      glosses: [],
      fetched_at: T - 1000,
    });
    await saveText({ kind: 'graded', title: 'Winter', body: '', graded_id: 'g1' }, T - 500);
    await db.cards.update(card.id, { reps: 1 });
    expect((await getCardView(card.id, T))!.sentence).toMatchObject({ origin: 'text', tr: 'Köy yılların en soğuk kışıyla başa çıktı.' });
  });
});
