import { describe, expect, it } from 'vitest';
import { isUuid, uuidv7, uuidv7Time } from './ids';

describe('uuidv7', () => {
  it('produces RFC 9562 v7 ids carrying the timestamp', () => {
    const now = Date.UTC(2026, 9, 21, 12, 0, 0);
    const id = uuidv7(now + 10_000);
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect(uuidv7Time(id)).toBe(now + 10_000);
  });

  it('is strictly monotonic within one millisecond', () => {
    const t = Date.UTC(2030, 0, 1);
    const ids = Array.from({ length: 5000 }, () => uuidv7(t));
    for (let i = 1; i < ids.length; i++) expect(ids[i]! > ids[i - 1]!).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('stays monotonic when the clock goes backwards', () => {
    const t = Date.UTC(2031, 0, 1);
    const a = uuidv7(t);
    const b = uuidv7(t - 60_000);
    expect(b > a).toBe(true);
  });
});
