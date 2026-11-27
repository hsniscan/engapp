import { describe, expect, it } from 'vitest';
import { charCountNearLimit, TYPED_TERM_MAX, LIMITS } from './limits';

describe('charCountNearLimit (ekle.md #13)', () => {
  it('is quiet until the last fifth, then counts code points', () => {
    expect(charCountNearLimit('x'.repeat(63), 80)).toBeNull();
    expect(charCountNearLimit('x'.repeat(64), 80)).toEqual({ count: 64, max: 80 });
    expect(charCountNearLimit('ğ'.repeat(400), 500)).toEqual({ count: 400, max: 500 });
    expect(charCountNearLimit('🙂'.repeat(64), 80)).toEqual({ count: 64, max: 80 });
  });

  it('the typed term cap fits the column', () => {
    expect(TYPED_TERM_MAX).toBeLessThanOrEqual(LIMITS.term);
  });
});
