import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../test/db';
import { addNoteWithSenses } from './actions';
import { db } from './db';
import { repairListEntrySentences } from './repairs';

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
