// The graded library on the device (decision 0047): the catalogue pull by cursor, withdrawn
// texts dropped, bodies cached for offline reading, one reading row per library text, and the
// suggestion order against the user's difficulty.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDb } from '../test/db';
import type { GradedRemote } from '@/ai/graded';
import { db } from './db';
import {
  applyGradedCatalogPage,
  getGradedBody,
  getGradedCursor,
  getReadingDifficulty,
  GRADED_META,
  GradedUnavailableError,
  listGradedCatalog,
  openGradedText,
  pullGradedCatalog,
  setGradedRemoteForTests,
  suggestedGradedTexts,
} from './library';
import { getMeta } from './meta';
import { ensureSettings, SETTINGS_ID } from './settings';

// The reader package replaces the knowledge stub; here the user knows the lemmas listed in
// KNOWN and nothing else.
const KNOWN = new Set<string>();
vi.mock('./knowledge', () => ({
  loadKnowledge: async () => ({
    lemmatize: (w: string) => w.toLowerCase(),
    pKnown: (l: string) => (KNOWN.has(l) ? 1 : 0),
  }),
}));

const T = Date.UTC(2026, 10, 2, 9);
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A catalogue row whose profile has `known` known tokens and `unknown` unknown ones. */
function row(n: number, over: Record<string, unknown> = {}, known = 96, unknown = 4) {
  const profile: Record<string, number> = { kword: known };
  if (unknown > 0) profile[`u${n}`] = unknown;
  return {
    id: ID(n),
    level: 'B1',
    topic: 'travel',
    title: `Text ${n}`,
    words: known + unknown + 3,
    tokens: known + unknown,
    cov_level: 0.97,
    lemma_profile: profile,
    target_lemmas: ['journey'],
    status: 'approved',
    server_seq: n,
    ...over,
  };
}

const body = (n: number) => ({
  id: ID(n),
  title: `Text ${n}`,
  sentences: [
    { en: 'The train was late.', tr: 'Tren geç kaldı.', audio_key: 'en-US/abc.mp3', p: 0 },
    { en: 'We waited.', tr: 'Bekledik.', audio_key: null, p: 1 },
  ],
  glosses: [],
  status: 'approved',
});

class FakeRemote implements GradedRemote {
  rows: Record<string, unknown>[] = [];
  bodies = new Map<string, unknown>();
  pages: number[] = [];
  bodyCalls = 0;
  async catalogPage(after: number, limit: number) {
    this.pages.push(after);
    return this.rows.filter((r) => (r.server_seq as number) > after).slice(0, limit);
  }
  async body(id: string) {
    this.bodyCalls++;
    return this.bodies.get(id) ?? null;
  }
}

let remote: FakeRemote;
beforeEach(async () => {
  await resetDb();
  KNOWN.clear();
  KNOWN.add('kword');
  remote = new FakeRemote();
  setGradedRemoteForTests(remote);
});
afterEach(() => {
  setGradedRemoteForTests(undefined);
  vi.unstubAllGlobals();
});

describe('catalogue', () => {
  it('pulls after the cursor, stores approved texts and moves the cursor', async () => {
    remote.rows = [row(1), row(2), row(3)];
    expect(await pullGradedCatalog({ now: T })).toEqual({ status: 'done', stored: 3, removed: 0 });
    expect(await getGradedCursor()).toBe(3);
    expect((await listGradedCatalog()).map((e) => e.id).sort()).toEqual([ID(1), ID(2), ID(3)]);
    expect(await getMeta(GRADED_META.syncedAt)).toBe(T);
    // Fresh: no request until the refresh time has passed.
    expect(await pullGradedCatalog({ now: T + 60_000 })).toEqual({ status: 'fresh' });
    remote.rows.push(row(4));
    expect(await pullGradedCatalog({ now: T + 7 * 3600_000 })).toMatchObject({ status: 'done', stored: 1 });
    expect(remote.pages.at(-1)).toBe(3);
  });

  it('drops a withdrawn text and its cached body', async () => {
    await applyGradedCatalogPage([row(1), row(2)]);
    remote.bodies.set(ID(1), body(1));
    await getGradedBody(ID(1), T);
    expect(await db.graded_bodies.count()).toBe(1);
    const r = await applyGradedCatalogPage([row(1, { status: 'rejected', server_seq: 9 })]);
    expect(r).toEqual({ stored: 0, removed: 1, cursor: 9 });
    expect(await db.graded_catalog.get(ID(1))).toBeUndefined();
    expect(await db.graded_bodies.count()).toBe(0);
  });

  it('skips invalid rows but still moves past them', async () => {
    const r = await applyGradedCatalogPage([{ id: 'nope', server_seq: 5 }, row(2)]);
    expect(r).toEqual({ stored: 1, removed: 0, cursor: 5 });
  });

  it('a cleared copy starts over', async () => {
    await applyGradedCatalogPage([row(7)]);
    await db.graded_catalog.clear();
    expect(await getGradedCursor()).toBe(0);
  });

  it('without a backend or offline it does nothing', async () => {
    setGradedRemoteForTests(null);
    expect(await pullGradedCatalog()).toEqual({ status: 'no_backend' });
    setGradedRemoteForTests(remote);
    expect(await pullGradedCatalog({ isOnline: () => false })).toEqual({ status: 'offline' });
  });
});

describe('bodies', () => {
  it('fetches once, then reads offline', async () => {
    remote.bodies.set(ID(1), body(1));
    const b = await getGradedBody(ID(1), T);
    expect(b.sentences).toEqual(body(1).sentences);
    vi.stubGlobal('navigator', { onLine: false });
    expect((await getGradedBody(ID(1))).sentences[0]).toMatchObject({ en: 'The train was late.', audio_key: 'en-US/abc.mp3' });
    expect(remote.bodyCalls).toBe(1);
  });

  it('says why a body is not available', async () => {
    await expect(getGradedBody(ID(5))).rejects.toMatchObject({ reason: 'not_found' });
    vi.stubGlobal('navigator', { onLine: false });
    await expect(getGradedBody(ID(6))).rejects.toBeInstanceOf(GradedUnavailableError);
  });
});

describe('opening a library text', () => {
  it('makes one reading row per library text and reuses it', async () => {
    remote.bodies.set(ID(1), body(1));
    const id = await openGradedText({ id: ID(1), title: 'Text 1' }, T);
    const text = await db.texts.get(id);
    expect(text).toMatchObject({ kind: 'graded', graded_id: ID(1), title: 'Text 1', body: '' });
    expect(await db.graded_bodies.get(ID(1))).toBeDefined();
    expect(await openGradedText({ id: ID(1), title: 'Text 1' }, T + 1)).toBe(id);
    expect(await db.texts.count()).toBe(1);
  });

  it('opens offline too (the reader fetches the body later)', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const id = await openGradedText({ id: ID(2), title: 'Text 2' }, T);
    expect(await db.texts.get(id)).toMatchObject({ graded_id: ID(2) });
  });
});

describe('suggestions', () => {
  beforeEach(async () => {
    await applyGradedCatalogPage([
      row(1, { title: 'Easy' }, 99, 1), // 1 % unknown: easier than every band
      row(2, { title: 'Balanced A' }, 96, 4), // 4 %
      row(3, { title: 'Balanced B', topic: 'sports' }, 97, 3), // 3 %
      row(4, { title: 'Stretch' }, 92, 8), // 8 %
      row(5, { title: 'Too hard' }, 80, 20), // 20 %: over the cap
    ]);
  });

  it('suggests only texts inside the band, nearest its centre first', async () => {
    const s = await suggestedGradedTexts('dengeli', 5);
    expect(s.map((x) => x.title)).toEqual(['Balanced A', 'Balanced B']);
    expect(s[0]).toMatchObject({ id: ID(2), level: 'B1', topic: 'travel', fit: 0 });
    expect(s[0]!.unknownRate).toBeCloseTo(0.04);
    expect((await suggestedGradedTexts('zorlayici', 5)).map((x) => x.title)).toEqual(['Stretch']);
  });

  it('never suggests a text over the 10 % cap', async () => {
    for (const d of ['rahat', 'dengeli', 'zorlayici'] as const)
      expect((await suggestedGradedTexts(d, 10)).every((x) => x.unknownRate <= 0.1)).toBe(true);
  });

  it('puts the user’s interests first', async () => {
    await ensureSettings(T);
    await db.settings.update(SETTINGS_ID, { interests: ['sports'] });
    expect((await suggestedGradedTexts('dengeli', 5)).map((x) => x.title)).toEqual(['Balanced B', 'Balanced A']);
  });

  it('puts finished texts last', async () => {
    remote.bodies.set(ID(2), body(2));
    const id = await openGradedText({ id: ID(2), title: 'Balanced A' }, T);
    await db.texts.update(id, { finished_at: T });
    expect((await suggestedGradedTexts('dengeli', 5)).map((x) => x.title)).toEqual(['Balanced B', 'Balanced A']);
  });

  it('falls back to the closest easier texts when none is in the band', async () => {
    await db.graded_catalog.bulkDelete([ID(2), ID(3), ID(4)]);
    expect((await suggestedGradedTexts('dengeli', 5)).map((x) => x.title)).toEqual(['Easy']);
  });

  it('respects the limit', async () => {
    expect(await suggestedGradedTexts('dengeli', 1)).toHaveLength(1);
    expect(await suggestedGradedTexts('dengeli', 0)).toEqual([]);
  });

  it('reads the difficulty setting defensively, Dengeli by default', async () => {
    expect(await getReadingDifficulty()).toBe('dengeli');
    await ensureSettings(T);
    await db.settings.update(SETTINGS_ID, { reading_difficulty: 'rahat' } as never);
    expect(await getReadingDifficulty()).toBe('rahat');
    await db.settings.update(SETTINGS_ID, { reading_difficulty: 'odd' } as never);
    expect(await getReadingDifficulty()).toBe('dengeli');
  });
});
