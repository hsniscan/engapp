// One progress wording for a text everywhere (v0.5.2, B14).
import { describe, expect, it } from 'vitest';
import { readingProgress } from './texts';

const text = (over: Partial<Parameters<typeof readingProgress>[0]> = {}) => ({
  finished_at: null,
  progress_offset: 0,
  read_ms: 0,
  body: 'x'.repeat(200),
  ...over,
});

describe('readingProgress', () => {
  it('is unread with no resume point and no reading time', () => {
    expect(readingProgress(text())).toEqual({ state: 'unread', pct: 0 });
  });

  it('counts reading time as started, even on the first screen', () => {
    expect(readingProgress(text({ read_ms: 30_000 }))).toEqual({ state: 'started', pct: 0 });
  });

  it('gives the percent before the resume point, never 100 until finished', () => {
    expect(readingProgress(text({ progress_offset: 100 }))).toEqual({ state: 'started', pct: 50 });
    expect(readingProgress(text({ progress_offset: 200 })).pct).toBe(99);
    expect(readingProgress(text({ finished_at: 1 }))).toEqual({ state: 'finished', pct: 100 });
  });

  it('copes with an empty body', () => {
    expect(readingProgress(text({ body: '', read_ms: 5 }))).toEqual({ state: 'started', pct: 0 });
  });
});
