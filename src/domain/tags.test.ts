import { describe, expect, it } from 'vitest';
import { LIMITS } from './limits';
import {
  cleanTag,
  hasTag,
  MAX_TAG_LENGTH,
  renamedTags,
  sameTag,
  tagCounts,
  withoutTags,
  withTags,
} from './tags';

describe('tags', () => {
  it('cleans spacing, a leading # and over-long input', () => {
    expect(cleanTag('  #  iş   yeri ')).toBe('iş yeri');
    expect(cleanTag('##')).toBe('');
    expect([...cleanTag('ğ'.repeat(100))]).toHaveLength(MAX_TAG_LENGTH);
  });

  it('compares with Turkish case rules', () => {
    expect(sameTag('İş', 'iş')).toBe(true);
    expect(sameTag('IRMAK', 'ırmak')).toBe(true);
    expect(sameTag('I', 'i')).toBe(false);
    expect(hasTag(['Seyahat'], 'SEYAHAT')).toBe(true);
  });

  it('adds only missing tags, keeps the first spelling, and respects the server limit', () => {
    expect(withTags(['İş'], ['iş', ' seyahat ', '', 'Seyahat'])).toEqual(['İş', 'seyahat']);
    const full = Array.from({ length: LIMITS.tags }, (_, i) => `t${i}`);
    expect(withTags(full, ['t0'])).toEqual(full);
    expect(withTags(full, ['new'])).toBeNull();
  });

  it('removes and renames case-insensitively, merging duplicates', () => {
    expect(withoutTags(['İş', 'spor'], ['iş'])).toEqual(['spor']);
    expect(renamedTags(['iş', 'spor'], 'İŞ', 'çalışma')).toEqual(['çalışma', 'spor']);
    expect(renamedTags(['iş', 'çalışma'], 'iş', 'Çalışma')).toEqual(['Çalışma']);
    expect(renamedTags(['spor'], 'iş', 'x')).toEqual(['spor']);
  });

  it('counts distinct tags per note, most used first', () => {
    expect(tagCounts([['iş', 'İş'], ['spor', 'iş'], ['spor'], ['ada']])).toEqual([
      { tag: 'iş', count: 2 },
      { tag: 'spor', count: 2 },
      { tag: 'ada', count: 1 },
    ]);
  });
});
