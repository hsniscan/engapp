import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compareHlc, decodeHlc, encodeHlc, HLC_ZERO, isClockSkewed, receive, tick } from './hlc';

const T = Date.UTC(2026, 9, 21);

describe('hlc', () => {
  it('round-trips encoding', () => {
    const h = { ms: T, counter: 42, node: 'dev-a' };
    expect(decodeHlc(encodeHlc(h))).toEqual(h);
    expect(() => decodeHlc('garbage')).toThrow();
  });

  it('tick is monotonic even when the wall clock jumps back', () => {
    let h = { ms: 0, counter: 0, node: 'a' };
    const times = [T, T, T + 5, T - 3_600_000, T - 3_600_000, T + 1];
    let prev = HLC_ZERO;
    for (const now of times) {
      h = tick(h, now);
      const s = encodeHlc(h);
      expect(compareHlc(s, prev)).toBe(1);
      prev = s;
    }
  });

  it('receive orders after both local and remote, adopting a fast remote clock', () => {
    const local = tick({ ms: 0, counter: 0, node: 'a' }, T);
    const remote = { ms: T + 86_400_000 * 365, counter: 7, node: 'b' }; // device a year ahead
    const merged = receive(local, remote, T + 1);
    expect(compareHlc(encodeHlc(merged), encodeHlc(remote))).toBe(1);
    expect(merged.node).toBe('a');
    const next = tick(merged, T + 2);
    expect(compareHlc(encodeHlc(next), encodeHlc(merged))).toBe(1);
    expect(isClockSkewed(encodeHlc(remote), T)).toBe(true);
    expect(isClockSkewed(encodeHlc(local), T)).toBe(false);
  });

  it('string comparison matches (ms, counter) ordering', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 47 }),
        fc.integer({ min: 0, max: 99_999 }),
        fc.integer({ min: 0, max: 2 ** 47 }),
        fc.integer({ min: 0, max: 99_999 }),
        (m1, c1, m2, c2) => {
          const a = encodeHlc({ ms: m1, counter: c1, node: 'x' });
          const b = encodeHlc({ ms: m2, counter: c2, node: 'x' });
          const expected = m1 !== m2 ? Math.sign(m1 - m2) : Math.sign(c1 - c2);
          expect(compareHlc(a, b)).toBe(expected);
        },
      ),
    );
  });

  it('counter overflow rolls into the next millisecond', () => {
    const h = tick({ ms: T, counter: 99_999, node: 'a' }, T);
    expect(h).toEqual({ ms: T + 1, counter: 0, node: 'a' });
  });
});
