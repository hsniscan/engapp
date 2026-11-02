// The reader's word lookup: the user's card first, then the text's own gloss (B1, ADR 0063).
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../test/db';
import { addNoteWithSenses } from './actions';
import { glossFor, lookupReaderWord } from './readerLookup';

const T = Date.UTC(2026, 9, 21, 9);

beforeEach(async () => {
  await resetDb();
});

describe('reader lookup with text glosses', () => {
  it('matches a gloss by the lemma or the written form, case-insensitively', () => {
    const g = [{ word: 'Fishermen', tr: 'balıkçılar' }];
    expect(glossFor(g, ['fisherman', 'fishermen'])?.tr).toBe('balıkçılar');
    expect(glossFor(g, ['boat'])).toBeNull();
    expect(glossFor([{ word: 'net', tr: ' ' }], ['net'])).toBeNull();
  });

  it('shows the text gloss when the device has nothing else (offline, guests)', async () => {
    const info = await lookupReaderWord('fisherman', 'Fishermen', [{ word: 'fishermen', tr: 'balıkçılar' }]);
    expect(info.source).toBe('gloss');
    expect(info.term).toBe('fisherman');
    expect(info.meanings[0]?.meaning_tr).toBe('balıkçılar');
  });

  it("prefers the user's own card over the gloss", async () => {
    await addNoteWithSenses({ term: 'harbour', senses: [{ meaning_tr: 'liman', source_sentence: 'The harbour is small.' }] }, T);
    const info = await lookupReaderWord('harbour', 'harbour', [{ word: 'harbour', tr: 'barınak' }]);
    expect(info.source).toBe('note');
    expect(info.meanings[0]?.meaning_tr).toBe('liman');
  });

  it('without glosses an unknown word has no source', async () => {
    expect((await lookupReaderWord('zzz', 'zzz')).source).toBeNull();
  });
});
