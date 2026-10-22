import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cleanTerm, countWords, MAX_SHARED_CHARS, routeShared, shareHref } from './route';

describe('routeShared: words → card preview', () => {
  it.each([
    ['serendipity', 'serendipity'],
    ['  “Serendipity.” ', 'Serendipity'],
    ['give up on', 'give up on'],
    ["don't mind", "don't mind"],
    ['(well-being)', 'well-being'],
    ['take\naback', 'take aback'],
  ])('%j → term %j', (text, term) => {
    expect(routeShared({ text })).toEqual({ kind: 'term', term });
  });

  it('uses the subject when an app shares the selection only there', () => {
    expect(routeShared({ text: '', title: 'ubiquitous' })).toEqual({
      kind: 'term',
      term: 'ubiquitous',
    });
  });
});

describe('routeShared: longer text → extraction preview', () => {
  it('keeps the whole text (it becomes the source of the sentences)', () => {
    const text = 'The committee reluctantly postponed the decision until spring.';
    expect(routeShared({ text })).toEqual({ kind: 'text', text, title: null });
  });

  it('four words is already text', () => {
    expect(routeShared({ text: 'kick the bucket today' }).kind).toBe('text');
  });

  it('a long passage that contains a link is text without the link', () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const r = routeShared({ text: `${words} https://example.com/a more` });
    expect(r.kind).toBe('text');
    if (r.kind === 'text') expect(r.text).not.toContain('https://');
  });

  it('bounds the text like a pasted import', () => {
    const r = routeShared({ text: 'word '.repeat(MAX_SHARED_CHARS) });
    expect(r.kind === 'text' && r.text.length).toBeLessThanOrEqual(MAX_SHARED_CHARS);
  });
});

describe('routeShared: links → title only', () => {
  it('Chrome on Android: the address in text, the page title in the subject', () => {
    expect(
      routeShared({ text: 'https://example.com/story?id=1', title: 'Why we procrastinate' }),
    ).toEqual({
      kind: 'link',
      url: 'https://example.com/story?id=1',
      title: 'Why we procrastinate',
    });
  });

  it('apps that put "Title – address" in the text', () => {
    expect(routeShared({ text: 'Why we procrastinate - https://example.com/s.' })).toEqual({
      kind: 'link',
      url: 'https://example.com/s',
      title: 'Why we procrastinate',
    });
  });

  it('Web Share Target: the url parameter', () => {
    expect(routeShared({ url: 'https://example.com/', title: 'Example' })).toEqual({
      kind: 'link',
      url: 'https://example.com/',
      title: 'Example',
    });
  });

  it('no title available → the address alone', () => {
    expect(routeShared({ text: 'https://example.com/x' })).toEqual({
      kind: 'link',
      url: 'https://example.com/x',
      title: null,
    });
  });

  it('only http(s) counts as a link', () => {
    expect(routeShared({ url: 'javascript:alert(1)', text: 'hello' })).toEqual({
      kind: 'term',
      term: 'hello',
    });
  });
});

describe('routeShared: nothing usable', () => {
  it.each([[''], ['   '], ['🙂 👍'], ['…']])('%j → empty', (text) => {
    expect(routeShared({ text })).toEqual({ kind: 'empty' });
  });

  it('never throws, whatever is shared', () => {
    fc.assert(
      fc.property(
        fc.record({
          text: fc.option(fc.string({ maxLength: 400 })),
          title: fc.option(fc.string({ maxLength: 80 })),
          url: fc.option(fc.string({ maxLength: 80 })),
        }),
        (input) => {
          const r = routeShared(input);
          if (r.kind === 'term') {
            expect(r.term.length).toBeGreaterThan(0);
            expect(countWords(r.term)).toBeLessThanOrEqual(3);
          }
          if (r.kind === 'text') expect(countWords(r.text)).toBeGreaterThan(3);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('helpers', () => {
  it('counts words with letters only', () => {
    expect(countWords('a - b , c')).toBe(3);
    expect(countWords('İstanbul’da çalışıyor')).toBe(2);
  });

  it('cleans a term', () => {
    expect(cleanTerm('"hello!"')).toBe('hello');
  });

  it('builds the in-app address', () => {
    expect(shareHref({ text: 'a b', title: 'T' })).toBe('/share?text=a+b&title=T');
    expect(shareHref({})).toBe('/share');
    expect(routeShared(Object.fromEntries(new URLSearchParams('text=a+b&title=T')))).toEqual({
      kind: 'term',
      term: 'a b',
    });
  });
});
