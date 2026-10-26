// Accepted synonyms for typed answers (ADR 0051): looked up offline in the word list, the
// cached lexicon and the user's own words.
import { beforeEach, describe, expect, it } from 'vitest';
import { acceptedSynonyms, posCompatible } from '../domain/synonyms';
import type { LexiconSense } from '../domain/types';
import type { WordBankEntry } from '../domain/wordBank';
import { resetDb } from '../test/db';
import { addNoteWithSenses } from './actions';
import { db } from './db';
import { findSynonyms, lookupKeys } from './synonyms';

const bank = (lemma: string, pos: string, meanings: string[]): WordBankEntry => ({
  id: `${lemma}|${pos}`,
  lemma_norm: lemma,
  pos,
  lemma,
  cefr: 'A2',
  list_source: 'cefrj',
  zipf: 5,
  lexicon_term_id: null,
  senses: meanings.map((m) => ({ meaning_tr: m, example_en: 'An example.', example_tr: 'Bir örnek.', sense_id: null })),
});

beforeEach(async () => {
  await resetDb();
});

describe('lookupKeys', () => {
  it('looks up the word as typed and without to / a / the', () => {
    expect(lookupKeys('  To Begin. ')).toEqual(['to begin', 'begin']);
    expect(lookupKeys('')).toEqual([]);
  });
});

describe('acceptedSynonyms (pure)', () => {
  const target = { term: 'big', pos: 'adjective', meaning: 'büyük, iri' };
  it('takes words that share a whole Turkish alternative and a compatible part of speech', () => {
    expect(
      acceptedSynonyms(
        [
          { lemma: 'large', pos: 'adjective', meanings: ['büyük, geniş'] },
          { lemma: 'grow', pos: 'verb', meanings: ['büyümek'] },
          { lemma: 'huge', pos: 'adjective', meanings: ['devasa, kocaman'] },
          { lemma: 'great', pos: 'noun', meanings: ['büyük'] },
          { lemma: 'big', pos: 'adjective', meanings: ['büyük'] },
        ],
        target,
      ),
    ).toEqual(['large']);
  });

  it('accepts nothing without a meaning', () => {
    expect(acceptedSynonyms([{ lemma: 'large', pos: null, meanings: ['büyük'] }], { ...target, meaning: null })).toEqual([]);
  });

  it('knows which parts of speech may stand for each other', () => {
    expect(posCompatible('verb', 'phrasal verb')).toBe(true);
    expect(posCompatible(null, 'noun')).toBe(true);
    expect(posCompatible('other', 'noun')).toBe(true);
    expect(posCompatible('verb', 'noun')).toBe(false);
  });
});

describe('findSynonyms', () => {
  it('finds a word of the Kelime Bankası list with the same meaning', async () => {
    await db.word_bank.bulkPut([bank('large', 'adjective', ['büyük, geniş']), bank('small', 'adjective', ['küçük'])]);
    expect(await findSynonyms('Large', { term: 'big', pos: 'adjective', meaning: 'büyük' })).toEqual(['large']);
    expect(await findSynonyms('small', { term: 'big', pos: 'adjective', meaning: 'büyük' })).toEqual([]);
  });

  it('finds a cached lexicon sense and the user’s own word', async () => {
    await db.lexicon_cache.put({
      id: 'lx1',
      term_id: 't1',
      lemma: 'begin',
      lemma_norm: 'begin',
      term_type: 'word',
      pos: 'verb',
      gloss_en: 'to start',
      meaning_tr: 'başlamak',
      ipa: null,
      updated_at: 1,
    } satisfies LexiconSense);
    expect(await findSynonyms('to begin', { term: 'start', pos: 'verb', meaning: 'başlamak' })).toEqual(['begin']);

    await addNoteWithSenses({ term: 'commence', senses: [{ meaning_tr: 'başlamak', pos: 'verb' }] });
    expect(await findSynonyms('commence', { term: 'start', pos: 'verb', meaning: 'başlamak, çalıştırmak' })).toEqual([
      'commence',
    ]);
  });

  it('finds nothing for an empty answer or an unknown word', async () => {
    expect(await findSynonyms('', { term: 'big', pos: null, meaning: 'büyük' })).toEqual([]);
    expect(await findSynonyms('qwerty', { term: 'big', pos: null, meaning: 'büyük' })).toEqual([]);
  });
});
