// @vitest-environment node
// Unit tests of the sanitizer. Fixture files (30+ malicious cases, the reference copies):
// src/domain/svgSanitize.test.ts.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { IMAGE_ALLOWED_COLORS, IMAGE_MAX_BYTES, IMAGE_PALETTE } from './image-contract.ts';
import { IMAGE_REFS } from './image-refs.ts';
import { sanitizeSvg, svgColors } from './svg-sanitize.ts';

/** Anything that must never survive sanitising. */
const FORBIDDEN =
  /<script|<foreignobject|<use|<image|<style|<iframe|<a[\s>]|\son[a-z]+\s*=|href|url\s*\(|javascript:|data:|&|<!|<\?|<text/i;

const H = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">';
const ok = (svg: string) => {
  const r = sanitizeSvg(svg);
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  return r.svg;
};
const reason = (svg: string) => {
  const r = sanitizeSvg(svg);
  return r.ok ? null : r.reason;
};

describe('style-B references', () => {
  it.each(IMAGE_REFS.map((r) => [r.slug, r] as const))('%s passes unchanged', (_slug, ref) => {
    expect(ok(ref.svg)).toBe(ref.svg);
    expect(new TextEncoder().encode(ref.svg).length).toBeLessThanOrEqual(IMAGE_MAX_BYTES);
    for (const c of svgColors(ref.svg)) expect(IMAGE_ALLOWED_COLORS.has(c)).toBe(true);
  });
});

/** Harmless rewrites a model or an editor may produce; each must still pass. */
const VARIANTS: [string, (s: string) => string][] = [
  ['uppercase hex', (s) => s.replace(/#[0-9a-f]{6}/g, (h) => h.toUpperCase())],
  ['single quotes', (s) => s.replace(/="([^"]*)"/g, "='$1'")],
  ['xml declaration', (s) => `<?xml version="1.0" encoding="UTF-8"?>\n${s}`],
  ['comments and newlines', (s) => s.replace(/></g, '>\n  <!-- part -->\n  <')],
  [
    'title and desc',
    (s) => s.replace(/(<svg[^>]*>)/, '$1<title>Bir resim</title><desc>açıklama</desc>'),
  ],
  ['role and aria', (s) => s.replace('<svg ', '<svg role="img" aria-label="x" version="1.1" ')],
  ['width and height on root', (s) => s.replace('<svg ', '<svg width="256" height="256" ')],
  [
    'explicit end tags',
    (s) => s.replace(/<(circle|rect|path|ellipse|line)([^>]*)\/>/g, '<$1$2></$1>'),
  ],
  ['comma viewBox', (s) => s.replace('viewBox="0 0 256 256"', 'viewBox="0,0,256,256"')],
];

describe('valid variants of the references', () => {
  const cases = IMAGE_REFS.flatMap((r) =>
    VARIANTS.map(([n, f]) => [`${r.slug}: ${n}`, f(r.svg)] as const),
  );

  it('are at least 50', () => expect(cases.length).toBeGreaterThanOrEqual(50));

  it.each(cases)('%s', (_n, svg) => {
    const out = ok(svg);
    expect(out).not.toMatch(FORBIDDEN);
    expect(out.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"')).toBe(
      true,
    );
  });
});

describe('sanitizeSvg details', () => {
  it('normalises output and is idempotent', () => {
    const out = ok(`${H}<circle cx="128.0" cy='128' r="40.5000" fill="#D55E00"/></svg>`);
    expect(out).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="#2b2824"><circle cx="128" cy="128" r="40.5" fill="#d55e00"/></svg>',
    );
    expect(ok(out)).toBe(out);
  });

  it('gives shapes without any fill the ink colour, not black', () => {
    expect(ok(`${H}<rect width="10" height="10"/></svg>`)).toContain('fill="#2b2824"');
    expect(
      ok(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="none"><rect width="10" height="10"/></svg>`,
      ),
    ).not.toContain('#2b2824');
  });

  it('expands short hex and accepts none', () => {
    expect(ok(`${H}<rect width="1" height="1" fill="#FFF" stroke="none"/></svg>`)).toContain(
      'fill="#ffffff" stroke="none"',
    );
  });

  it('names the reason', () => {
    expect(reason(`${H}<rect width="1" height="1" fill="#000000"/></svg>`)).toBe('color:#000000');
    expect(reason(`${H}<script/></svg>`)).toBe('element:script');
    expect(reason(`${H}<rect width="1" height="1" onload="x"/></svg>`)).toBe('attribute:onload');
    expect(reason(`${H}<rect width="1" height="1" fill="url(#a)"/></svg>`)).toBe('url');
    expect(
      reason(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="1" height="1"/></svg>`,
      ),
    ).toBe('viewbox');
    expect(reason(`${H}</svg>`)).toBe('empty');
    expect(reason('')).toBe('empty');
    expect(reason(`${H}<rect width="-4" height="1"/></svg>`)).toBe('value:width');
    expect(reason(`${H}<circle cx="1" cy="1" r="1" points="1 2"/></svg>`)).toBe('attribute:points');
    expect(reason(`${H}<rect width="1" height="1" transform="rotate(1 2)"/></svg>`)).toBe(
      'value:transform',
    );
    expect(reason(`${H}<rect width="1" height="1" fill="#d55e00" fill="#2b2824"/></svg>`)).toBe(
      'duplicate_attribute:fill',
    );
  });

  it('keeps transforms and paths readable', () => {
    const out = ok(
      `${H}<g transform="translate(10,20) rotate(22 86 106)  scale(2)"><path d="M0 0   L 10 10 Z" fill="#009e73"/><polygon points="1,2 3,4 5,6" fill="#e69f00"/></g></svg>`,
    );
    expect(out).toContain('transform="translate(10 20) rotate(22 86 106) scale(2)"');
    expect(out).toContain('d="M0 0 L 10 10 Z"');
    expect(out).toContain('points="1 2 3 4 5 6"');
  });

  it('never throws and never lets forbidden markup through (fuzz)', () => {
    const pieces = [
      H,
      '</svg>',
      '<g>',
      '</g>',
      '<circle cx="1" cy="1" r="1" fill="#d55e00"/>',
      '<script>',
      '</script>',
      'onload="x"',
      '<use href="#a"/>',
      '&amp;',
      '<!--',
      '-->',
      '<![CDATA[',
      ']]>',
      '"',
      "'",
      '<',
      '>',
      'url(',
      'javascript:',
      '<foreignObject>',
      'text',
      ' ',
      '<rect width="1" height="1"/>',
      '<title>',
      '</title>',
      '<style>',
      '<!DOCTYPE x>',
      '<?x?>',
      'fill="#123456"',
      '<a href="x">',
    ];
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...pieces), { maxLength: 24 }), (parts) => {
        const r = sanitizeSvg(parts.join(''));
        if (r.ok) {
          expect(r.svg).not.toMatch(FORBIDDEN);
          expect(sanitizeSvg(r.svg)).toEqual(r);
          for (const c of svgColors(r.svg)) expect(IMAGE_ALLOWED_COLORS.has(c)).toBe(true);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it('uses only palette colours in its default', () => {
    expect(IMAGE_ALLOWED_COLORS.has(IMAGE_PALETTE.ink[0])).toBe(true);
  });
});
