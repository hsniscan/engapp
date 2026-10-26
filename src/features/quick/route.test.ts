import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { countWords } from '@/features/share/route';
import {
  addFormPath,
  isOpenablePath,
  lookupForms,
  quickHref,
  quickTitle,
  routeQuick,
} from './route';

describe('routeQuick: a selected word → its card preview', () => {
  it.each([
    ['serendipity', 'serendipity'],
    ['  “Serendipity.” ', 'Serendipity'],
    ['(well-being),', 'well-being'],
    ['give up on', 'give up on'],
    ['take\naback', 'take aback'],
    ["don't mind", "don't mind"],
  ])('%j → term %j (cleaned like a shared word)', (text, term) => {
    expect(routeQuick(text)).toEqual({ kind: 'term', term });
  });
});

describe('routeQuick: longer selections → reader or word extraction', () => {
  it('four words and more are a text, kept whole', () => {
    const text = 'The committee reluctantly postponed the decision.';
    expect(routeQuick(text)).toEqual({ kind: 'text', text, words: 6 });
  });

  it('a selected address is a link (handed to the share flow)', () => {
    expect(routeQuick('https://example.com/a.')).toEqual({
      kind: 'link',
      url: 'https://example.com/a',
    });
  });

  it.each([[null], [undefined], [''], ['   '], ['🙂'], ['…']])('%j → empty', (text) => {
    expect(routeQuick(text)).toEqual({ kind: 'empty' });
  });

  it('never throws; terms are short and texts long', () => {
    fc.assert(
      fc.property(fc.option(fc.string({ maxLength: 300 })), (text) => {
        const r = routeQuick(text);
        if (r.kind === 'term') expect(countWords(r.term)).toBeLessThanOrEqual(3);
        if (r.kind === 'text') expect(r.words).toBeGreaterThan(3);
      }),
      { numRuns: 300 },
    );
  });
});

describe('lookupForms', () => {
  it('tries the word, then its likely base forms', () => {
    const forms = lookupForms('Postponed');
    expect(forms[0]).toBe('postponed');
    expect(forms).toContain('postpone');
    expect(lookupForms('studies')).toContain('study');
    expect(lookupForms('running')).toContain('run');
  });

  it('a phrase is looked up as typed only', () => {
    expect(lookupForms('Give  Up')).toEqual(['give up']);
  });

  it('folds typographic apostrophes like term_norm', () => {
    expect(lookupForms('don’t')[0]).toBe("don't");
  });

  it('nothing for an empty term', () => {
    expect(lookupForms('  ')).toEqual([]);
  });
});

describe('addresses', () => {
  it('quickHref carries the selection', () => {
    expect(quickHref('serendipity')).toBe('/quick?text=serendipity');
    expect(quickHref('a b\r\nc')).toBe('/quick?text=a+b%0Ac');
    expect(quickHref('  ')).toBe('/quick');
    expect(routeQuick(new URLSearchParams(quickHref('give up').split('?')[1]).get('text'))).toEqual(
      { kind: 'term', term: 'give up' },
    );
  });

  it('only reader and add-form addresses may be opened in the main app', () => {
    expect(isOpenablePath('/oku/0192f3a0-1b2c-7d4e-8f90-123456789abc')).toBe(true);
    expect(isOpenablePath(addFormPath('give up'))).toBe(true);
    expect(isOpenablePath('/settings')).toBe(false);
    expect(isOpenablePath('//evil.example/oku/1')).toBe(false);
    expect(isOpenablePath('/oku/1/../../x')).toBe(false);
    expect(isOpenablePath('/add?term=a&tab=paste')).toBe(false);
    expect(isOpenablePath(`/add?term=${'a'.repeat(700)}`)).toBe(false);
  });

  it('quickTitle: the first line, cut at a word', () => {
    expect(quickTitle('\nShort title\nbody')).toBe('Short title');
    const t = quickTitle('word '.repeat(40));
    expect(t.length).toBeLessThanOrEqual(61);
    expect(t.endsWith('…')).toBe(true);
  });
});
