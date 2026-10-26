// A word list becomes the user's own notes through the normal add path (decision 0056).
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../test/db';
import { addNoteWithSenses } from './actions';
import { findNoteByTerm } from './queries';
import { importWordList } from './wordList';

const T = Date.UTC(2026, 10, 2, 9);

beforeEach(resetDb);

describe('importWordList', () => {
  it('new words, a new meaning for an old word, and an unchanged row', async () => {
    await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T);
    const res = await importWordList(
      [
        { term: 'recipe', meaning: 'tarif', sentence: 'A recipe for cake.', span: [2, 8] },
        { term: 'bank', meaning: 'kıyı', sentence: null },
        { term: 'bank', meaning: 'banka', sentence: null },
      ],
      undefined,
      T + 1,
    );
    expect(res).toEqual({ created: 1, addedSenses: 1, unchanged: 1, failed: 0 });
    const recipe = (await findNoteByTerm('recipe'))!;
    expect(recipe.senses[0]).toMatchObject({
      meaning_tr: 'tarif',
      source_sentence: 'A recipe for cake.',
      span: [2, 8],
    });
    expect((await findNoteByTerm('bank'))!.senses.map((s) => s.meaning_tr).sort()).toEqual([
      'banka',
      'kıyı',
    ]);
  });
});
