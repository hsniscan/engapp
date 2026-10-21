import { describe, expect, it } from 'vitest';
import { extraNewSteps, parsePracticeParams, practiceHref } from './links';

describe('practice links', () => {
  it('round-trips a round through the URL', () => {
    const p = { source: 'tag', size: 20, tag: 'iş yeri' } as const;
    const href = practiceHref(p);
    expect(href.startsWith('/practice?')).toBe(true);
    expect(parsePracticeParams(new URLSearchParams(href.split('?')[1]))).toEqual(p);
  });

  it('drops the tag for other sources', () => {
    expect(practiceHref({ source: 'hard', size: 10, tag: 'x' })).toBe(
      '/practice?source=hard&size=10',
    );
    expect(parsePracticeParams(new URLSearchParams('source=recent&size=10&tag=x')).tag).toBeNull();
  });

  it('falls back to hard / 10 for unknown values', () => {
    expect(parsePracticeParams(new URLSearchParams('source=nope&size=7'))).toEqual({
      source: 'hard',
      size: 10,
      tag: null,
    });
  });
});

describe('extraNewSteps', () => {
  it('offers +5 and +10 when enough new cards wait, else what is left', () => {
    expect(extraNewSteps(0)).toEqual([]);
    expect(extraNewSteps(3)).toEqual([3]);
    expect(extraNewSteps(5)).toEqual([5]);
    expect(extraNewSteps(7)).toEqual([5, 7]);
    expect(extraNewSteps(10)).toEqual([5, 10]);
    expect(extraNewSteps(250)).toEqual([5, 10]);
  });
});
