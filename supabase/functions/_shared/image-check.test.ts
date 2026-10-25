// @vitest-environment node
// Backdrop, contrast and coverage for both picture styles (style B image-v1, watercolour image-v2).
import { describe, expect, it } from 'vitest';
import {
  BACKDROP,
  BACKDROP_CIRCLE,
  contrastCheck,
  contrastRatio,
  findBackdrop,
  IMAGE_CHECK_SYSTEM_PROMPT,
  visibleCoverage,
} from './image-check.ts';
import { IMAGE_CHECK_PROMPT_VERSION, IMAGE_WC_PALETTE } from './image-contract.ts';
import { sanitizeSvg } from './svg-sanitize.ts';

const H = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">';
const BLOB = 'M24 128 C24 50 232 50 232 128 C232 206 24 206 24 128 Z';
const wash = (fill: string, filter = ' filter="url(#wash)"') =>
  `<path d="${BLOB}" fill="${fill}" opacity="0.8"${filter}/>`;
const LINE = '<g filter="url(#line)" stroke="#4a4440" stroke-width="2.5">';
const clean = (svg: string) => {
  const r = sanitizeSvg(svg);
  if (!r.ok) throw new Error(r.reason);
  return r.svg;
};

describe('findBackdrop', () => {
  it('finds the flat circle of style B', () => {
    expect(
      findBackdrop(
        clean(`${H}${BACKDROP_CIRCLE}<circle cx="1" cy="1" r="9" fill="#d55e00"/></svg>`),
      ),
    ).toBe(BACKDROP);
  });

  it('finds the first wash-filtered shape filled with a wash colour', () => {
    const svg = clean(
      `${H}<circle cx="1" cy="1" r="9" fill="#c2654a" filter="url(#wash)"/>${wash('#d6e6ec')}${wash('#f1dfc0')}${LINE}<circle cx="128" cy="128" r="40" fill="#c2654a"/></g></svg>`,
    );
    expect(findBackdrop(svg)).toEqual(IMAGE_WC_PALETTE.washSky);
  });

  it('needs the wash filter, and a wash colour', () => {
    expect(findBackdrop(clean(`${H}${wash('#f1dfc0', '')}</svg>`))).toBeNull();
    expect(findBackdrop(clean(`${H}${wash('#c2654a')}</svg>`))).toBeNull();
    expect(
      findBackdrop(clean(`${H}${LINE}<path d="${BLOB}" fill="#f1dfc0"/></g></svg>`)),
    ).toBeNull();
  });
});

describe('contrastCheck, watercolour', () => {
  it('passes pencil and a terracotta subject on a sand wash, against the wash in each theme', () => {
    const r = contrastCheck(
      clean(
        `${H}${wash('#f1dfc0')}${LINE}<circle cx="128" cy="128" r="50" fill="#c2654a" fill-opacity="0.85"/></g></svg>`,
      ),
    );
    expect(r).toMatchObject({ ok: true, problem: null });
    const pencil = r.colors.find((c) => c.color === '#4a4440')!;
    expect(pencil.light).toBeCloseTo(contrastRatio('#4a4440', '#f1dfc0'), 1);
    expect(pencil.dark).toBeCloseTo(contrastRatio('#e6ded2', '#4b4335'), 1);
    // The backdrop's own colour is not a drawn colour.
    expect(r.colors.map((c) => c.color)).not.toContain('#f1dfc0');
  });

  it('is no_backdrop without a wash', () => {
    const r = contrastCheck(
      clean(`${H}${LINE}<circle cx="128" cy="128" r="50" fill="#c2654a"/></g></svg>`),
    );
    expect(r.problem).toBe('no_backdrop');
  });

  it('is low_contrast when nothing stands out from the wash', () => {
    const r = contrastCheck(
      clean(
        `${H}${wash('#e1e9d2')}<g filter="url(#line)" stroke="#d6e6ec"><circle cx="128" cy="128" r="50" fill="#fefefe"/></g></svg>`,
      ),
    );
    expect(r.problem).toBe('low_contrast');
  });
});

describe('visibleCoverage', () => {
  const SIZE = 16;
  /** A buffer filled with one premultiplied colour. */
  const solid = (hex: string, alpha = 1) => {
    const buf = new Uint8Array(SIZE * SIZE * 4);
    const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (let p = 0; p < SIZE * SIZE; p++) {
      buf.set([...rgb.map((v) => Math.round(v * alpha)), Math.round(alpha * 255)], p * 4);
    }
    return buf;
  };

  it('measures against the given backdrop (style B by default)', () => {
    expect(visibleCoverage(solid(BACKDROP[0]), SIZE, 'light')).toBe(0);
    expect(visibleCoverage(solid('#f1dfc0'), SIZE, 'light')).toBe(0);
    expect(visibleCoverage(solid('#c2654a'), SIZE, 'light', IMAGE_WC_PALETTE.washSand)).toBe(1);
    expect(visibleCoverage(solid('#4b4335'), SIZE, 'dark', IMAGE_WC_PALETTE.washSand)).toBe(0);
  });

  it('undoes premultiplied alpha, and skips mostly transparent pixels', () => {
    expect(visibleCoverage(solid('#f1dfc0', 0.6), SIZE, 'light', IMAGE_WC_PALETTE.washSand)).toBe(
      0,
    );
    expect(visibleCoverage(solid('#4a4440', 0.3), SIZE, 'light', IMAGE_WC_PALETTE.washSand)).toBe(
      0,
    );
  });
});

describe('imagecheck prompt', () => {
  it('knows the watercolour style', () => {
    expect(IMAGE_CHECK_PROMPT_VERSION).toBe('imagecheck-v2');
    expect(IMAGE_CHECK_SYSTEM_PROMPT).toMatch(/watercolour/);
    expect(IMAGE_CHECK_SYSTEM_PROMPT).toMatch(/not clutter/);
  });
});
