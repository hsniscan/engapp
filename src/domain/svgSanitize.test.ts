// The sanitizer as the client uses it, against the fixture files: the malicious set
// (tests/fixtures/svg/malicious, plan acceptance criterion 4) and the viewable reference copies
// (docs/image-style/refs). Unit tests: supabase/functions/_shared/svg-sanitize.test.ts.
import { describe, expect, it } from 'vitest';
import { IMAGE_REFS } from '../../supabase/functions/_shared/image-refs';
import { sanitizeSvg } from './svgSanitize';

const MALICIOUS = import.meta.glob<string>('../../tests/fixtures/svg/malicious/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const REFS = import.meta.glob<string>('../../docs/image-style/refs/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Anything that must never survive sanitising. */
const FORBIDDEN =
  /<script|<foreignobject|<use|<image|<style|<iframe|<a[\s>]|\son[a-z]+\s*=|href|url\s*\(|javascript:|data:|&|<!|<\?|<text|alert/i;

const base = (path: string) => path.slice(path.lastIndexOf('/') + 1);

describe('malicious fixtures', () => {
  const cases = Object.entries(MALICIOUS)
    .map(([p, src]) => [base(p), src] as const)
    .sort(([a], [b]) => a.localeCompare(b));

  it('has at least 30 cases that must be refused', () => {
    expect(cases.filter(([f]) => !f.startsWith('n-')).length).toBeGreaterThanOrEqual(30);
  });

  it.each(cases)('%s is refused or neutralised', (file, src) => {
    const r = sanitizeSvg(src);
    if (file.startsWith('n-')) {
      // Accepted only with the dangerous part gone (a comment, a <title> text).
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.svg).not.toMatch(FORBIDDEN);
    } else {
      expect(r).toMatchObject({ ok: false });
    }
  });
});

describe('docs/image-style/refs', () => {
  it('are the stored references, and each passes unchanged', () => {
    const files = Object.keys(REFS).map(base).sort();
    expect(files).toEqual(IMAGE_REFS.map((r) => `${r.slug}.svg`).sort());
    for (const r of IMAGE_REFS) {
      const src = REFS[`../../docs/image-style/refs/${r.slug}.svg`]!.trim();
      expect(src).toBe(r.svg);
      expect(sanitizeSvg(src)).toEqual({ ok: true, svg: src });
    }
  });
});
