import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addNoteWithSenses, db, getMeta } from '@/data';
import type { ImageManifestRow } from '@/domain/images';
import { resetDb } from '@/test/db';
import { SAMPLE_PICTURES } from '@/test/imageSamples';
import type { LexiconImageRow } from '../../../supabase/functions/_shared/image-contract';
import { fetchImages, IMAGE_FETCH_META, IMAGE_REFRESH_MS, senseSetKey, type ImageFetchDeps } from './fetcher';

// The İP2 sanitizer is a stub on this branch: a stand-in that keeps the SVG and refuses
// anything with a <script>, so the default path (no `sanitize` in deps) is exercised.
const sanitizeSvg = vi.hoisted(() =>
  vi.fn((svg: string) => (svg.includes('<script') ? { ok: false as const, reason: 'script' } : { ok: true as const, svg })),
);
vi.mock('../../../supabase/functions/_shared/svg-sanitize', () => ({ sanitizeSvg }));

const T = Date.UTC(2026, 9, 25, 9);
const LEX = '0199f0a0-0000-7000-8000-00000000a001';
const LEX2 = '0199f0a0-0000-7000-8000-00000000a002';
const id = (n: number) => `0199f0a0-0000-7000-8000-0000000b${String(n).padStart(4, '0')}`;

function row(n: number, p: Partial<LexiconImageRow> = {}): LexiconImageRow {
  return {
    id: id(n),
    sense_id: LEX,
    variant: n,
    svg: SAMPLE_PICTURES.apple.svg,
    alt_tr: 'Kırmızı bir elma',
    status: 'approved',
    created_at: '2026-10-25T01:30:00Z',
    ...p,
  };
}

/** A fake server holding `rows`; records what was asked. */
function server(rows: LexiconImageRow[]) {
  const asked = { manifest: [] as string[][], download: [] as string[][] };
  let now = T;
  const deps: ImageFetchDeps = {
    listManifest: async (senseIds) => {
      asked.manifest.push([...senseIds]);
      return rows
        .filter((r) => senseIds.includes(r.sense_id))
        .map(({ id, sense_id, variant, status, created_at }): ImageManifestRow => ({ id, sense_id, variant, status, created_at }));
    },
    download: async (ids) => {
      asked.download.push([...ids]);
      return rows.filter((r) => ids.includes(r.id));
    },
    isOnline: () => true,
    isSignedIn: async () => true,
    now: () => now,
  };
  return { deps, asked, rows, tick: (ms: number) => (now += ms) };
}

beforeEach(async () => {
  await resetDb();
  sanitizeSvg.mockClear();
  await addNoteWithSenses({ term: 'apple', senses: [{ meaning_tr: 'elma', lexicon_sense_id: LEX }] }, T);
});

describe('fetchImages', () => {
  it('guests and offline devices fetch nothing', async () => {
    const s = server([row(0)]);
    expect(await fetchImages({ ...s.deps, isSignedIn: async () => false })).toEqual({ status: 'signed_out' });
    expect(await fetchImages({ ...s.deps, isOnline: () => false })).toEqual({ status: 'offline' });
    expect(s.asked.manifest).toEqual([]);
    expect(await db.images.count()).toBe(0);
  });

  it("downloads the pictures of the user's senses, sanitized, and skips while fresh", async () => {
    const s = server([row(0), row(1, { status: 'review' }), row(2, { sense_id: '0199f0a0-0000-7000-8000-00000000ffff' })]);
    const out = await fetchImages(s.deps);
    expect(out).toMatchObject({ status: 'done', downloaded: 2 });
    expect(s.asked.manifest).toEqual([[LEX]]);
    expect(s.asked.download).toEqual([[id(0), id(1)]]);
    expect(sanitizeSvg).toHaveBeenCalledTimes(2);
    const cached = await db.images.orderBy('id').toArray();
    expect(cached.map((r) => [r.id, r.status, r.fetched_at])).toEqual([
      [id(0), 'approved', T],
      [id(1), 'review', T],
    ]);
    expect(await getMeta(IMAGE_FETCH_META)).toEqual({ at: T, key: senseSetKey([LEX]) });

    s.tick(60_000);
    expect(await fetchImages(s.deps)).toEqual({ status: 'fresh' });
    expect(s.asked.manifest).toHaveLength(1);
  });

  it('a new card fetches again at once; later only what is new is downloaded', async () => {
    const s = server([row(0), row(5, { sense_id: LEX2 })]);
    await fetchImages(s.deps);
    await addNoteWithSenses({ term: 'bridge', senses: [{ meaning_tr: 'köprü', lexicon_sense_id: LEX2 }] }, T);
    s.tick(1000);
    expect(await fetchImages(s.deps)).toMatchObject({ status: 'done', downloaded: 1 });
    expect(s.asked.download).toEqual([[id(0)], [id(5)]]);
  });

  it('after the refresh time: approvals update, pictures gone on the server are dropped', async () => {
    const s = server([row(0, { status: 'review' }), row(1)]);
    await fetchImages(s.deps);
    s.rows.splice(0, 2, row(0, { status: 'approved' }), row(2));
    s.tick(IMAGE_REFRESH_MS + 1);
    expect(await fetchImages(s.deps)).toMatchObject({ status: 'done', result: { added: 1, removed: 1, updated: 1 } });
    expect((await db.images.orderBy('id').toArray()).map((r) => [r.id, r.status])).toEqual([
      [id(0), 'approved'],
      [id(2), 'approved'],
    ]);
  });

  it('a picture the sanitizer refuses is never stored; a broken listing is logged, not thrown', async () => {
    const s = server([row(0, { svg: '<svg viewBox="0 0 256 256"><script>alert(1)</script></svg>' }), row(1)]);
    await fetchImages(s.deps);
    expect((await db.images.toArray()).map((r) => r.id)).toEqual([id(1)]);
    const broken = { ...s.deps, listManifest: async () => Promise.reject(new Error('boom')) };
    expect(await fetchImages(broken, { force: true })).toEqual({ status: 'failed', error: 'boom' });
    expect(await db.images.count()).toBe(1);
  });

  it('a removed card takes its pictures off the device', async () => {
    const s = server([row(0)]);
    await fetchImages(s.deps);
    await db.senses.toCollection().modify({ deleted_at: T });
    s.tick(1000);
    await fetchImages(s.deps);
    expect(await db.images.count()).toBe(0);
  });

  it('v0.4 İP8: a fetched approved picture makes the picture card; the server dropping it takes the card away', async () => {
    const picture = async () => (await db.cards.where('card_type').equals('image').toArray()).filter((c) => c.deleted_at === null);
    const s = server([row(0, { status: 'review' })]);
    await fetchImages(s.deps);
    expect(await picture()).toHaveLength(0);
    s.rows.splice(0, 1, row(0));
    s.tick(IMAGE_REFRESH_MS + 1);
    await fetchImages(s.deps);
    expect(await picture()).toHaveLength(1);
    // Offline the cache stays and so does the card.
    expect(await fetchImages({ ...s.deps, isOnline: () => false })).toEqual({ status: 'offline' });
    expect(await picture()).toHaveLength(1);
    s.rows.splice(0, 1);
    s.tick(IMAGE_REFRESH_MS + 1);
    await fetchImages(s.deps);
    expect(await db.images.count()).toBe(0);
    expect(await picture()).toHaveLength(0);
  });
});
