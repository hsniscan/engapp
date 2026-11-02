// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { levelBand } from './examples-contracts.ts';
import { exampleTextKey, isNearDuplicateSentence, locateExampleTerm, wordCount } from './sentences.ts';

describe('helpers', () => {
  it('locates inflected and separated terms', () => {
    expect(locateExampleTerm('The banks were closed.', 'bank', '')).toEqual([4, 9]);
    expect(locateExampleTerm('She turned the offer down politely.', 'turn down', 'turned down')).toEqual([4, 25]);
    expect(locateExampleTerm('Nothing to see here.', 'reluctant', 'reluctant')).toBeNull();
    // A surface that is not a form of the term is not trusted.
    expect(locateExampleTerm('He was happy about it.', 'reluctant', 'happy')).toBeNull();
  });

  it('normalises sentences for duplicate checks', () => {
    expect(exampleTextKey('  She GAVE up—coffee! ')).toBe('she gave up coffee');
    expect(isNearDuplicateSentence('She gave up coffee last year.', 'Last year she gave up coffee.')).toBe(true);
    expect(isNearDuplicateSentence('She gave up coffee last year.', 'My team never gives up.')).toBe(false);
  });

  it('counts words, not punctuation', () => {
    expect(wordCount('She gave up — coffee, 2 times!')).toBe(6);
  });

  it('maps CEFR levels to four bands', () => {
    expect(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((l) => levelBand(l as 'A1'))).toEqual(['A2', 'A2', 'B1', 'B2', 'C1', 'C1']);
  });
});
