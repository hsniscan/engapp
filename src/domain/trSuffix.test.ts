import { describe, expect, it } from 'vitest';
import { lastSpokenWord, possessiveAccusativeSuffix, possessiveSuffix } from './trSuffix';

describe('Turkish number suffixes', () => {
  it('reads the last spoken word of a number', () => {
    expect(lastSpokenWord(91)).toBe('bir');
    expect(lastSpokenWord(90)).toBe('doksan');
    expect(lastSpokenWord(100)).toBe('yüz');
    expect(lastSpokenWord(0)).toBe('sıfır');
    expect(lastSpokenWord(2000)).toBe('bin');
  });

  it('gives the forms the reader coverage line needs (%90–%100)', () => {
    const want: Record<number, string> = {
      90: 'ını',
      91: 'ini',
      92: 'sini',
      93: 'ünü',
      94: 'ünü',
      95: 'ini',
      96: 'sını',
      97: 'sini',
      98: 'ini',
      99: 'unu',
      100: 'ünü',
    };
    for (const [n, s] of Object.entries(want)) expect(possessiveAccusativeSuffix(Number(n))).toBe(s);
  });

  it('covers every ending: zero, tens and the possessive alone', () => {
    expect(possessiveAccusativeSuffix(0)).toBe('ını');
    expect(possessiveAccusativeSuffix(10)).toBe('unu');
    expect(possessiveAccusativeSuffix(20)).toBe('sini');
    expect(possessiveAccusativeSuffix(40)).toBe('ını');
    expect(possessiveAccusativeSuffix(50)).toBe('sini');
    expect(possessiveAccusativeSuffix(60)).toBe('ını');
    expect(possessiveAccusativeSuffix(70)).toBe('ini');
    expect(possessiveAccusativeSuffix(80)).toBe('ini');
    expect(possessiveSuffix(91)).toBe('i');
    expect(possessiveSuffix(96)).toBe('sı');
    expect(possessiveSuffix(80)).toBe('i');
    expect(possessiveSuffix(30)).toBe('u');
  });
});
