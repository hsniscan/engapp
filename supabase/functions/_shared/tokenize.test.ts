// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { lemmaForms, prematchForms, termForms, tokenize } from './tokenize.ts';

describe('lemmaForms', () => {
  it.each([
    ['gave', 'give'],
    ['banks', 'bank'],
    ['stories', 'story'],
    ['stopped', 'stop'],
    ['used', 'use'],
    ['running', 'run'],
    ['making', 'make'],
    ['lying', 'lie'],
    ['bigger', 'big'],
    ['children', 'child'],
    ['studied', 'study'],
    ['watches', 'watch'],
  ])('%s -> %s', (word, base) => {
    expect(lemmaForms(word)).toContain(base);
  });

  it('always includes the word itself', () => {
    expect(lemmaForms('Bank')).toContain('bank');
  });
});

describe('prematchForms', () => {
  const text =
    'Maria finally gave up smoking. She sat on the bank of the river, and later Gave It Up.';
  const forms = prematchForms(text);

  it('includes base forms of content words', () => {
    expect(forms).toEqual(expect.arrayContaining(['bank', 'river', 'smoke', 'maria']));
  });
  it('includes multi-word expressions with the verb in base form', () => {
    expect(forms).toEqual(
      expect.arrayContaining(['give up', 'gave up', 'give up smoking', 'give it up']),
    );
  });
  it('skips bare function words and n-grams across sentence breaks', () => {
    expect(forms).not.toContain('the');
    expect(forms).not.toContain('smoking she');
    expect(forms).not.toContain('river and');
  });
  it('is capped', () => {
    const long = 'word '.repeat(5000) + 'alpha beta gamma delta '.repeat(500);
    expect(prematchForms(long, { maxForms: 100 }).length).toBeLessThanOrEqual(100);
  });
});

describe('tokenize / termForms', () => {
  it('keeps apostrophes and hyphens inside words', () => {
    expect(tokenize('one’s well-being').map((t) => t.norm)).toEqual(["one's", 'well-being']);
  });
  it('lemmatises the first word of a typed phrase', () => {
    expect(termForms('Gave up')).toEqual(expect.arrayContaining(['gave up', 'give up']));
    expect(termForms('banks')).toEqual(expect.arrayContaining(['banks', 'bank']));
  });
});
