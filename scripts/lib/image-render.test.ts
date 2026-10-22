// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BACKDROP_CIRCLE, MIN_COVERAGE } from '../../supabase/functions/_shared/image-check.ts';
import { IMAGE_REFS } from '../../supabase/functions/_shared/image-refs.ts';
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
