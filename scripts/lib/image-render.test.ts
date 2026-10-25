// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BACKDROP_CIRCLE, MIN_COVERAGE } from '../../supabase/functions/_shared/image-check.ts';
import { IMAGE_REFS } from '../../supabase/functions/_shared/image-refs.ts';
import { sanitizeSvg } from '../../supabase/functions/_shared/svg-sanitize.ts';
import { loadRenderer } from './image-render.ts';

const PNG = 'iVBORw0KGgo';

describe('image renderer (resvg-wasm)', () => {
  it('renders every reference in both themes with enough visible coverage', async () => {
    const render = await loadRenderer();
    for (const r of IMAGE_REFS) {
      const out = render(r.svg);
      expect(out.light.png.startsWith(PNG)).toBe(true);
      expect(out.dark.png.startsWith(PNG)).toBe(true);
      expect(out.light.coverage).toBeGreaterThan(MIN_COVERAGE);
      expect(out.dark.coverage).toBeGreaterThan(MIN_COVERAGE);
    }
  });

  it('a pale picture has almost no visible coverage', async () => {
    const render = await loadRenderer();
    const out = render(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">${BACKDROP_CIRCLE}<circle cx="128" cy="128" r="60" fill="#ffffff"/></svg>`,
    );
    expect(out.light.coverage).toBeLessThan(MIN_COVERAGE);
  });
});

describe('watercolour pictures (image-v2)', () => {
  const H = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">';
  const WASH =
    '<path d="M24 128 C24 50 90 22 140 26 C200 30 234 80 232 132 C230 190 180 232 124 230 C64 228 24 190 24 128 Z" fill="#f1dfc0" opacity="0.8" filter="url(#wash)"/>';
  const wc = (inner: string) => {
    const r = sanitizeSvg(`${H}${WASH}${inner}</svg>`);
    if (!r.ok) throw new Error(r.reason);
    return r.svg;
  };

  it('renders the turbulence, displacement and blur filters without throwing', async () => {
    const render = await loadRenderer();
    const svg = wc(
      '<g filter="url(#line)" stroke="#4a4440" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="128" cy="120" r="56" fill="#c2654a" fill-opacity="0.85"/><path d="M128 64 C132 50 140 44 150 42" fill="none"/></g>',
    );
    expect(svg).toContain('<feTurbulence');
    const out = render(svg);
    expect(out.light.png.startsWith(PNG)).toBe(true);
    expect(out.dark.png.startsWith(PNG)).toBe(true);
    expect(out.light.coverage).toBeGreaterThan(MIN_COVERAGE);
    expect(out.dark.coverage).toBeGreaterThan(MIN_COVERAGE);
  });

  it('measures coverage against the wash: a wash alone covers nothing', async () => {
    const render = await loadRenderer();
    const out = render(
      wc('<g filter="url(#line)"><circle cx="128" cy="128" r="40" fill="#f1dfc0"/></g>'),
    );
    expect(out.light.coverage).toBeLessThan(MIN_COVERAGE);
    expect(out.dark.coverage).toBeLessThan(MIN_COVERAGE);
  });
});
