import { describe, expect, it } from 'vitest';
import { exampleSpan, wordBankRowSchema } from './wordbank-contract.ts';

const at = (s: string, lemma: string) => {
  const span = exampleSpan(s, lemma);
  return span ? s.slice(...span) : null;
};

describe('exampleSpan', () => {
  it('finds the word, its regular endings and (v0.5.3) its known irregular forms', () => {
    expect(at('I eat apples.', 'apple')).toBe('apples');
    expect(at('He ran to school.', 'run')).toBe('ran');
    expect(at('She made a quick decision.', 'make a decision')).toBe('made a quick decision');
    expect(at('Never give up.', 'give up')).toBe('give up');
    expect(at('He gave it up last year.', 'give up')).toBe('gave it up');
    expect(at('Turn the radio down, please.', 'turn down')).toBe('Turn the radio down');
  });

  it('does not take a regular-looking form of a short word for it', () => {
    expect(at('We used it.', 'us')).toBeNull();
    expect(at('He hurried home.', 'run')).toBeNull();
  });
});

describe('wordBankRowSchema', () => {
  const row = {
    lemma_norm: 'give up',
    pos: 'phrasal verb',
    lemma: 'give up',
    cefr: 'A2',
    list_source: 'wiktionary',
    zipf: 4.4,
    lexicon_term_id: null,
    senses: [{ meaning_tr: 'vazgeçmek', example_en: 'Never give up.', example_tr: 'Asla vazgeçme.', sense_id: null }],
    retired: false,
    server_seq: 7,
  };
  it('accepts phrasal verbs and collocations (decision 0074)', () => {
    expect(wordBankRowSchema.safeParse(row).success).toBe(true);
    expect(wordBankRowSchema.safeParse({ ...row, lemma_norm: 'make a decision', lemma: 'make a decision', pos: 'phrase', list_source: 'corpus' }).success).toBe(true);
    expect(wordBankRowSchema.safeParse({ ...row, pos: 'idiom' }).success).toBe(false);
    expect(wordBankRowSchema.safeParse({ ...row, list_source: 'oxford' }).success).toBe(false);
  });
});
