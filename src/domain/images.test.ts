import { describe, expect, it } from 'vitest';
import { IMAGE_DARK_SWAP, IMAGE_PALETTE } from '../../supabase/functions/_shared/image-contract';
import { SAMPLE_PICTURES } from '@/test/imageSamples';
import {
  choiceOf,
  diffManifest,
  IMAGE_CACHE_CAP_BYTES,
  IMAGE_CHOICE_KIND,
  orderImages,
  pickImage,
  pictureDataUrl,
  planEviction,
  rejectedImageIds,
  safeSanitize,
  toCachedImage,
  type CachedImage,
} from './images';
import type { ContentFeedback, UserContent } from './types';

const SENSE = '0199f0a0-0000-7000-8000-00000000a001';
const id = (n: number) => `0199f0a0-0000-7000-8000-0000000b${String(n).padStart(4, '0')}`;
const pass = (svg: string) => ({ ok: true as const, svg });

function img(n: number, p: Partial<CachedImage> = {}): CachedImage {
  return {
    id: id(n),
    sense_id: SENSE,
    variant: n,
    svg: SAMPLE_PICTURES.apple.svg,
    alt_tr: 'Kırmızı bir elma',
    status: 'approved',
    created_at: '2026-10-25T01:30:00Z',
    fetched_at: 1000,
    ...p,
  };
}

describe('toCachedImage', () => {
  const row = {
    id: id(1),
    sense_id: SENSE,
    variant: 0,
    svg: SAMPLE_PICTURES.apple.svg,
    alt_tr: '  Kırmızı bir elma ',
    status: 'approved' as const,
    created_at: '2026-10-25T01:30:00Z',
  };

  it('keeps approved and review rows, sanitized, with the fetch time', () => {
    expect(toCachedImage(row, 42, pass)).toMatchObject({ id: id(1), alt_tr: 'Kırmızı bir elma', fetched_at: 42, status: 'approved' });
    expect(toCachedImage({ ...row, status: 'review' }, 42, pass)?.status).toBe('review');
    const cleaned = toCachedImage(row, 42, () => ({ ok: true, svg: '<svg viewBox="0 0 256 256"/>' }));
    expect(cleaned?.svg).toBe('<svg viewBox="0 0 256 256"/>');
  });

  it('never caches rejected or checking rows, or what the sanitizer refuses', () => {
    expect(toCachedImage({ ...row, status: 'rejected' }, 1, pass)).toBeNull();
    expect(toCachedImage({ ...row, status: 'checking' }, 1, pass)).toBeNull();
    expect(toCachedImage(row, 1, () => ({ ok: false, reason: 'script' }))).toBeNull();
    // A sanitizer that throws (the İP2 stub) means "do not show", never a crash.
    expect(
      toCachedImage(row, 1, () => {
        throw new Error('not implemented');
      }),
    ).toBeNull();
    expect(safeSanitize('x'.repeat(9000), pass)).toBeNull();
  });
});

describe('pickImage', () => {
  const rows = [img(2, { status: 'review' }), img(1), img(0, { status: 'review', variant: 5 })];

  it('orders approved before new, then by variant', () => {
    expect(orderImages(rows).map((r) => r.variant)).toEqual([1, 2, 5]);
  });

  it('shows the chosen picture, else the first one the user did not reject', () => {
    expect(pickImage(rows, { imageId: null, hidden: false })?.id).toBe(id(1));
    expect(pickImage(rows, { imageId: id(2), hidden: false })?.id).toBe(id(2));
    expect(pickImage(rows, { imageId: null, hidden: false }, new Set([id(1)]))?.id).toBe(id(2));
    // A chosen picture the cache no longer has falls back to the default.
    expect(pickImage(rows, { imageId: 'gone', hidden: false })?.id).toBe(id(1));
    expect(pickImage(rows, { imageId: null, hidden: false }, new Set(rows.map((r) => r.id)))).toBeNull();
  });

  it('shows nothing when the user hid the picture', () => {
    expect(pickImage(rows, { imageId: id(2), hidden: true })).toBeNull();
  });

  it('reads the choice row and the "Hayır" answers', () => {
    const row = { kind: IMAGE_CHOICE_KIND, replaces_id: id(2), selected: false, deleted_at: null } as UserContent;
    expect(choiceOf(row)).toEqual({ imageId: id(2), hidden: true });
    expect(choiceOf({ ...row, deleted_at: 5 })).toEqual({ imageId: null, hidden: false });
    expect(choiceOf(null)).toEqual({ imageId: null, hidden: false });
    const fb = (target_id: string, verdict: ContentFeedback['verdict'], deleted_at: number | null = null) =>
      ({ target_kind: 'image', target_id, verdict, deleted_at }) as ContentFeedback;
    expect([...rejectedImageIds([fb(id(1), 'reject'), fb(id(2), 'like'), fb(id(3), 'reject', 9)])]).toEqual([id(1)]);
  });
});

describe('cache size', () => {
  it('evicts nothing under the cap', () => {
    expect(planEviction([img(1), img(2)], new Set(), IMAGE_CACHE_CAP_BYTES)).toEqual([]);
  });

  it('drops extra variants before the pictures cards show, oldest first', () => {
    const size = SAMPLE_PICTURES.apple.svg.length;
    const rows = [img(1, { fetched_at: 1 }), img(2, { fetched_at: 2 }), img(3, { fetched_at: 3 }), img(4, { fetched_at: 0 })];
    // Room for two pictures: the two shown ones (1 and 4) stay although 4 is the oldest.
    expect(planEviction(rows, new Set([id(1), id(4)]), size * 2).sort()).toEqual([id(2), id(3)]);
    // Room for one: then the older shown picture goes too.
    expect(planEviction(rows, new Set([id(1), id(4)]), size)).toEqual([id(2), id(3), id(4)]);
  });
});

describe('diffManifest', () => {
  it('downloads new pictures, updates statuses and drops what is gone or out of the cards', () => {
    const other = '0199f0a0-0000-7000-8000-00000000a002';
    const cached = [
      { id: id(1), sense_id: SENSE, status: 'review' as const },
      { id: id(2), sense_id: SENSE, status: 'approved' as const },
      { id: id(3), sense_id: other, status: 'approved' as const },
    ];
    const m = (n: number, status: string, sense = SENSE) => ({ id: id(n), sense_id: sense, variant: n, status, created_at: '' });
    const diff = diffManifest(cached, [m(1, 'approved'), m(4, 'review'), m(5, 'rejected'), m(3, 'approved', other)], new Set([SENSE]));
    expect(diff).toEqual({
      download: [id(4)],
      statusChanges: [{ id: id(1), status: 'approved' }],
      remove: [id(2), id(3)],
    });
  });
});

describe('pictureDataUrl', () => {
  const svg = SAMPLE_PICTURES.apple.svg;
  const decode = (url: string) => decodeURIComponent(url.slice('data:image/svg+xml,'.length));

  it('keeps the light values in the light theme and swaps every colour in the dark theme', () => {
    expect(decode(pictureDataUrl(svg, 'light'))).toBe(svg);
    const dark = decode(pictureDataUrl(svg, 'dark'));
    for (const [light, darkHex] of IMAGE_DARK_SWAP) {
      if (svg.includes(light)) {
        expect(dark).not.toContain(light);
        expect(dark).toContain(darkHex);
      }
    }
    expect(dark).toContain(IMAGE_PALETTE.soft[1]);
  });

  it('adds the SVG namespace an <img> needs and escapes the markup', () => {
    const url = pictureDataUrl('<svg viewBox="0 0 256 256"><circle cx="1" cy="1" r="1" fill="#2b2824"/></svg>', 'light');
    expect(url.startsWith('data:image/svg+xml,')).toBe(true);
    expect(url).not.toMatch(/[<>"#]/);
    expect(decode(url)).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox/);
  });
});
