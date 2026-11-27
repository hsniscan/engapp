import { describe, expect, it } from 'vitest';
import { bankExampleFor, isFullSentence, leadingBankExample, meaningParts, ownSentenceLeads } from './bankExample';
import { rotationSentences } from './examples';

const ROOT = [
  {
    pos: 'noun',
    senses: [
      {
        meaning_tr: 'kök',
        example_en: 'The roots of the tree go deep into the ground.',
        example_tr: 'Ağacın kökleri toprağın derinlerine iner.',
        sense_id: '00000000-0000-4000-8000-000000000001',
      },
      {
        meaning_tr: 'köken, kaynak',
        example_en: 'We need to find the root of the problem.',
        example_tr: 'Sorunun kaynağını bulmamız gerekiyor.',
        sense_id: null,
      },
    ],
  },
];

const sense = (over: Partial<Parameters<typeof leadingBankExample>[1]> = {}) => ({
  lexicon_sense_id: null,
  pos: 'noun',
  meaning_tr: 'kök',
  meaning_tr_override: null,
  source_sentence: null,
  source_sentence_tr: null,
  ...over,
});

describe('isFullSentence / ownSentenceLeads', () => {
  it('fragments and lower-case snippets are not full sentences', () => {
    expect(isFullSentence('ugly face')).toBe(false);
    expect(isFullSentence('difficult problem')).toBe(false);
    expect(isFullSentence('It was a typo')).toBe(false);
    expect(isFullSentence('the dog barked at me.')).toBe(false);
    expect(isFullSentence('Root beer is my favorite kind of soda.')).toBe(true);
    expect(isFullSentence('“Are you coming with us?”')).toBe(true);
  });

  it('the user’s sentence leads only as a full sentence with a translation', () => {
    expect(ownSentenceLeads({ source_sentence: 'Root beer is my favorite kind of soda.', source_sentence_tr: null })).toBe(false);
    expect(ownSentenceLeads({ source_sentence: 'ugly face', source_sentence_tr: 'çirkin yüz' })).toBe(false);
    expect(ownSentenceLeads({ source_sentence: 'I pulled the weed out by its roots.', source_sentence_tr: 'Otu kökünden çektim.' })).toBe(true);
  });
});

describe('bankExampleFor', () => {
  it('matches the sense by a common meaning part, Turkish-case-aware, ignoring brackets', () => {
    expect(meaningParts('Kök, köken; (bitki) KÖKÜ')).toEqual(new Set(['kök', 'köken', 'kökü']));
    expect(bankExampleFor('root', sense({ meaning_tr: 'kaynak' }), 1, ROOT)?.text).toBe(
      'We need to find the root of the problem.',
    );
    const ex = bankExampleFor('root', sense(), 1, ROOT)!;
    expect(ex).toEqual({
      text: 'The roots of the tree go deep into the ground.',
      tr: 'Ağacın kökleri toprağın derinlerine iner.',
      span: [4, 9],
    });
  });

  it('matches by the shared lexicon sense first', () => {
    const s = sense({ meaning_tr: 'something else', lexicon_sense_id: '00000000-0000-4000-8000-000000000001' });
    expect(bankExampleFor('root', s, 1, ROOT)?.tr).toBe('Ağacın kökleri toprağın derinlerine iner.');
  });

  it('does not guess between several bank senses, nor across parts of speech', () => {
    expect(bankExampleFor('root', sense({ meaning_tr: 'kök salmak' }), 1, ROOT)).toBeNull();
    expect(bankExampleFor('root', sense({ pos: 'verb' }), 1, ROOT)).toBeNull();
  });

  it('a one-sense note takes the only bank sense of its part of speech', () => {
    const one = [{ pos: 'adjective', senses: [{ ...ROOT[0]!.senses[0]!, meaning_tr: 'çirkin', example_en: 'What an ugly building!', example_tr: 'Ne çirkin bir bina!' }] }];
    expect(bankExampleFor('ugly', sense({ pos: 'adjective', meaning_tr: 'biçimsiz' }), 1, one)?.text).toBe('What an ugly building!');
    expect(bankExampleFor('ugly', sense({ pos: 'adjective', meaning_tr: 'biçimsiz' }), 2, one)).toBeNull();
  });

  it('a bank sentence without the term is not used', () => {
    const odd = [{ pos: 'noun', senses: [{ ...ROOT[0]!.senses[0]!, example_en: 'Trees need water.' }] }];
    expect(bankExampleFor('root', sense(), 1, odd)).toBeNull();
  });
});

describe('leadingBankExample', () => {
  it('replaces a weak or other-sense source sentence, keeps a good translated one', () => {
    const weak = sense({ source_sentence: 'Root beer is my favorite kind of soda.' });
    expect(leadingBankExample('root', weak, 1, ROOT)?.text).toBe('The roots of the tree go deep into the ground.');
    expect(leadingBankExample('root', sense(), 1, ROOT)).not.toBeNull();
    const good = sense({ source_sentence: 'I pulled the weed out by its roots.', source_sentence_tr: 'Otu kökünden çektim.' });
    expect(leadingBankExample('root', good, 1, ROOT)).toBeNull();
  });

  it('the card rotation starts with the bank example and drops the weak source sentence', () => {
    const weak = { source_sentence: 'ugly face', source_sentence_tr: null, span: [0, 4] as [number, number] };
    const lead = { text: 'What an ugly building!', tr: 'Ne çirkin bir bina!', span: [8, 12] as [number, number] };
    const list = rotationSentences(weak, null, [], false, [], lead);
    expect(list).toEqual([{ ...lead, exampleId: null, context: null, origin: 'bank' }]);
    expect(rotationSentences(weak, null, [], false)[0]!.text).toBe('ugly face');
  });
});
