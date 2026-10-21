import { describe, expect, it } from 'vitest';
import { locateTerm } from './locateTerm';

const cut = (s: string, span: [number, number] | null) => (span ? s.slice(span[0], span[1]) : null);

describe('locateTerm', () => {
  it('finds the exact and case-insensitive form on word boundaries', () => {
    const s = 'Banks open early; the bank by the river is closed.';
    expect(cut(s, locateTerm(s, 'bank'))).toBe('bank');
    expect(cut('The Bank is here.', locateTerm('The Bank is here.', 'bank'))).toBe('Bank');
  });

  it('finds separable phrasal verbs and simple inflections', () => {
    const s = 'She turned the offer down after a week.';
    expect(cut(s, locateTerm(s, 'turn down'))).toBe('turned the offer down');
    const r = 'He kept running until dawn.';
    expect(cut(r, locateTerm(r, 'run'))).toBe('running');
    const g = 'Never giving up is hard.';
    expect(cut(g, locateTerm(g, 'give up'))).toBe('giving up');
  });

  it('returns null when the term is not in the sentence', () => {
    expect(locateTerm('Nothing to see here.', 'bank')).toBeNull();
    expect(locateTerm('', 'bank')).toBeNull();
    expect(locateTerm('A bank.', '  ')).toBeNull();
  });
});
