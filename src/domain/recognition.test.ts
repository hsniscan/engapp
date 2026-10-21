import { describe, expect, it } from 'vitest';
import { makeLog, makeSense } from '../test/factories';
import type { ReviewLog } from './types';
import { canHaveCloze, findSpan, firstLetterHint, isValidSpan, lastShownSenseId, makeCloze, nextRecognitionSense } from './recognition';

describe('recognition sentence rotation', () => {
  const s1 = makeSense({ id: 's1', note_id: 'n', sense_no: 1, source_sentence: 'I went to the bank.' });
  const s2 = makeSense({ id: 's2', note_id: 'n', sense_no: 2, source_sentence: null });
  const s3 = makeSense({ id: 's3', note_id: 'n', sense_no: 3, source_sentence: 'We sat on the river bank.' });
  const s4 = makeSense({ id: 's4', note_id: 'n', sense_no: 4, source_sentence: 'Bank on it.', deleted_at: 5 });
  const senses = [s3, s2, s1, s4];

  it('rotates through senses that have a sentence, in sense order', () => {
    expect(nextRecognitionSense(senses, null)?.id).toBe('s1');
    expect(nextRecognitionSense(senses, 's1')?.id).toBe('s3');
    expect(nextRecognitionSense(senses, 's3')?.id).toBe('s1');
    expect(nextRecognitionSense(senses, 's4')?.id).toBe('s1');
    expect(nextRecognitionSense([s2], null)).toBeNull();
  });

  it('reads the last shown sense from non-undone logs', () => {
    const a = makeLog({ card_id: 'c', reviewed_at: 1, shown_sense_id: 's1' });
    const b = makeLog({ card_id: 'c', reviewed_at: 2, shown_sense_id: 's3' });
    const undo = makeLog({ card_id: 'c', reviewed_at: 3, undo_of: b.id });
    expect(lastShownSenseId([a, b])).toBe('s3');
    expect(lastShownSenseId([a, b, undo])).toBe('s1');
    expect(lastShownSenseId([])).toBeNull();
    // Full cycle driven by logs.
    const shown: string[] = [];
    const logs: ReviewLog[] = [];
    for (let i = 0; i < 4; i++) {
      const next = nextRecognitionSense(senses, lastShownSenseId(logs))!;
      shown.push(next.id);
      logs.push(makeLog({ card_id: 'c', reviewed_at: 10 + i, shown_sense_id: next.id }));
    }
    expect(shown).toEqual(['s1', 's3', 's1', 's3']);
  });
});

describe('cloze helpers', () => {
  const sentence = 'She gave up smoking last year.';
  it('validates spans', () => {
    expect(isValidSpan(sentence, [4, 11])).toBe(true);
    expect(isValidSpan(sentence, [4, 4])).toBe(false);
    expect(isValidSpan(sentence, [-1, 3])).toBe(false);
    expect(isValidSpan(sentence, [20, 99])).toBe(false);
    expect(isValidSpan(sentence, [3, 4])).toBe(false); // whitespace only
    expect(isValidSpan(sentence, null)).toBe(false);
    expect(canHaveCloze({ source_sentence: sentence, span: [4, 11] })).toBe(true);
    expect(canHaveCloze({ source_sentence: null, span: [4, 11] })).toBe(false);
  });
  it('blanks out the span', () => {
    const c = makeCloze(sentence, [4, 11]);
    expect(c.answer).toBe('gave up');
    expect(c.masked).toBe('She _____ smoking last year.');
    expect(() => makeCloze(sentence, [0, 100])).toThrow();
  });
  it('finds a span case-insensitively', () => {
    expect(findSpan(sentence, 'GAVE UP')).toEqual([4, 11]);
    expect(findSpan(sentence, 'nope')).toBeNull();
  });
  it('builds the first-letter hint', () => {
    expect(firstLetterHint('bank')).toBe('b___');
    expect(firstLetterHint('give up')).toBe('g___ u_');
    expect(firstLetterHint("don't")).toBe("d__'_");
  });
});
