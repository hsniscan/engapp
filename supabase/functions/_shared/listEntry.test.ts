import { describe, expect, it } from 'vitest';
import { stripListEntry, stripListEntryPrefix } from './listEntry.ts';

describe('stripListEntryPrefix', () => {
  it.each([
    ['1988 trailer I own a trailer.', 'trailer', 'I own a trailer.'],
    ['12 bad Be careful of bad people.', 'bad', 'Be careful of bad people.'],
    ['15 ugly ugly face', 'ugly', 'ugly face'],
    ['21 today today’s homework', 'today', 'today’s homework'],
    ['1 Hello. Hello. How have you been?', 'hello', 'Hello. How have you been?'],
    ['2 Excuse me. Excuse me. How much is this?', 'excuse me', 'Excuse me. How much is this?'],
    ['10 I’m... I’m Jon.', 'I’m', 'I’m Jon.'],
    ['7 Yes. Yes, this one please.', 'yes', 'Yes, this one please.'],
    ['40 decide We decided to stay.', 'decide', 'We decided to stay.'],
  ])('%s → %s', (sentence, term, expected) => {
    expect(stripListEntryPrefix(sentence, term)).toBe(expected);
  });

  it.each([
    ['3 people came to the party.', 'people'], // prose starting with a number
    ['The river bank flooded again.', 'bank'], // no number
    ['34 go I went home.', 'go'], // the example does not hold the term: keep it whole
    ['12 bad', 'bad'], // nothing after the headword
  ])('keeps %s', (sentence, term) => {
    expect(stripListEntryPrefix(sentence, term)).toBe(sentence);
  });
});

describe('stripListEntry', () => {
  it('moves a span that pointed into the example', () => {
    const s = '1988 trailer I own a trailer.';
    expect(stripListEntry(s, 'trailer', [21, 28])).toEqual({ sentence: 'I own a trailer.', span: [8, 15] });
  });
  it('finds the word again when the span pointed at the headword', () => {
    const s = '1988 trailer I own a trailer.';
    expect(stripListEntry(s, 'trailer', [5, 12])).toEqual({ sentence: 'I own a trailer.', span: [8, 15] });
  });
  it('leaves clean sentences alone', () => {
    expect(stripListEntry('I own a trailer.', 'trailer', [8, 15])).toEqual({
      sentence: 'I own a trailer.',
      span: [8, 15],
    });
  });
});
