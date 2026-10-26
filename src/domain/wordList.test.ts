// "CSV ya da kelime listesi" (decision 0056): files and typed lists become term / meaning rows.
import { describe, expect, it } from 'vitest';
import { detectSeparator, MAX_LIST_ROWS, parseWordList, splitCsvLine } from './wordList';

describe('splitCsvLine', () => {
  it('honours quotes and doubled quotes', () => {
    expect(splitCsvLine('bank,"kıyı, sahil","He said ""hi"" at the bank."', ',')).toEqual([
      'bank',
      'kıyı, sahil',
      'He said "hi" at the bank.',
    ]);
  });
});

describe('detectSeparator', () => {
  it('prefers tab and ";" over ","; a dash only with spaces', () => {
    expect(detectSeparator(['bank\tkıyı, sahil', 'run\tkoşmak'])).toBe('\t');
    expect(detectSeparator(['bank;kıyı, sahil', 'run;koşmak'])).toBe(';');
    expect(detectSeparator(['give up - vazgeçmek', 'well-known - tanınmış'])).toBe(' - ');
    expect(detectSeparator(['hello'])).toBeNull();
  });
});

describe('parseWordList', () => {
  it('a CSV with a header and an example sentence', () => {
    const r = parseWordList(
      '﻿term,meaning,example\r\nbank,kıyı,We sat on the bank.\r\nrecipe,tarif\r\n',
    );
    expect(r).toEqual({
      rows: [
        { term: 'bank', meaning: 'kıyı', sentence: 'We sat on the bank.' },
        { term: 'recipe', meaning: 'tarif', sentence: null },
      ],
      skipped: 0,
      truncated: false,
    });
  });

  it('a typed list; short trailing cells are more meanings; bad lines are counted', () => {
    const r = parseWordList(
      'give up - vazgeçmek\nbank - kıyı - sahil\njust a line\n- yalnız anlam',
    );
    expect(r.rows).toEqual([
      { term: 'give up', meaning: 'vazgeçmek', sentence: null },
      { term: 'bank', meaning: 'kıyı, sahil', sentence: null },
    ]);
    expect(r.skipped).toBe(2);
  });

  it('cuts at MAX_LIST_ROWS and says so', () => {
    const text = Array.from({ length: MAX_LIST_ROWS + 3 }, (_, i) => `w${i}x;anlam`).join('\n');
    const r = parseWordList(text);
    expect(r.rows).toHaveLength(MAX_LIST_ROWS);
    expect(r.truncated).toBe(true);
  });
});
