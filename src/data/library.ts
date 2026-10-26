// The graded reading library on this device (v0.5 İP5, decision 0047).
//
// `graded_catalog` is a read-only copy of the approved texts' metadata in public.graded_texts
// (system content, the same for every user and guest), pulled page by page after
// meta.graded_cursor like the word bank; `graded_bodies` keeps the sentences of every text the
// user opened, so it reads offline after the first open. Nothing is ever written back, and the
// user's own reading rows (`texts`, kind 'graded') only point at a library text by graded_id.
//
// The reader (İP1) shows suggestedGradedTexts on Bugün and reads a text's sentences with
// getGradedBody; GradedLibraryList (Desteler → Okuma, /kitaplik) uses the rest.
import { z } from 'zod';
import {
  GRADED_PAGE,
  gradedBodySchema,
  gradedCatalogRowSchema,
  topicInterests,
} from '../../supabase/functions/_shared/graded-contract';
import type { GradedRemote } from '@/ai/graded';
import {
  scoreGradedText,
  suggestTexts,
  type GradedBody,
  type GradedCatalogEntry,
  type ScoredGradedText,
} from '../domain/library';
import { DEFAULT_DIFFICULTY, DIFFICULTY_BANDS, type ReaderText, type ReadingDifficulty } from '../domain/texts';
import type { Id, Millis } from '../domain/types';
import { db } from './db';
import { logError } from './errorLog';
import { loadKnowledge } from './knowledge';
import { getMeta, setMeta } from './meta';
import { getSettings } from './settings';
import { saveText } from './texts';

export interface GradedSummary {
  id: string;
  title: string;
  level: string;
  topic: string;
  words: number;
  /** Expected unknown share for this user (domain/coverage.ts). */
  unknownRate: number;
  /** Where the text sits against the chosen difficulty: -1 easier, 0 inside, 1 harder. */
  fit?: -1 | 0 | 1;
}

export const GRADED_META = {
  /** server_seq of the last pulled catalogue row. */
  cursor: 'graded_cursor',
  /** When the last full pull finished (ms). */
  syncedAt: 'graded_synced_at',
} as const;

/** A filled catalogue is asked for changes again after this long (new texts come nightly). */
export const GRADED_REFRESH_MS = 6 * 60 * 60_000;
/** Safety stop: never more pages than this in one pull (~10 000 texts). */
const MAX_PAGES = 20;

// ------------------------------------------------------------------ the network seam

let remoteOverride: GradedRemote | null | undefined;

/** Tests: the remote to use (null = no backend); undefined restores the real one. */
export function setGradedRemoteForTests(remote: GradedRemote | null | undefined): void {
  remoteOverride = remote;
}

async function gradedRemote(): Promise<GradedRemote | null> {
  if (remoteOverride !== undefined) return remoteOverride;
  // Loaded on first use: the data layer itself holds no network code.
  return (await import('@/ai/graded')).supabaseGradedRemote;
}

const online = () => (typeof navigator === 'undefined' ? true : navigator.onLine);

// ------------------------------------------------------------------ catalogue

export const catalogEntryOf = (r: z.infer<typeof gradedCatalogRowSchema>): GradedCatalogEntry => ({
  id: r.id,
  level: r.level,
  topic: r.topic,
  title: r.title,
  words: r.words,
  tokens: r.tokens,
  cov_level: r.cov_level,
  lemma_profile: r.lemma_profile,
  target_lemmas: r.target_lemmas,
  server_seq: r.server_seq,
});

export async function getGradedCursor(): Promise<number> {
  const cursor = (await getMeta<number>(GRADED_META.cursor)) ?? 0;
  // A copy that was cleared starts over.
  if (cursor > 0 && (await db.graded_catalog.count()) === 0) return 0;
  return cursor;
}

/**
 * Stores one pulled page and moves the cursor past it, in one transaction: approved texts are
 * written, withdrawn ones (and their cached bodies) removed. Invalid rows are skipped.
 */
export async function applyGradedCatalogPage(
  rows: readonly unknown[],
): Promise<{ stored: number; removed: number; cursor: number }> {
  let maxSeq = 0;
  const keep: GradedCatalogEntry[] = [];
  const gone: string[] = [];
  for (const raw of rows) {
    const seq = Number((raw as { server_seq?: unknown } | null)?.server_seq);
    if (Number.isFinite(seq)) maxSeq = Math.max(maxSeq, seq);
    const r = gradedCatalogRowSchema.safeParse(raw);
    if (!r.success) continue;
    if (r.data.status === 'approved') keep.push(catalogEntryOf(r.data));
    else gone.push(r.data.id);
  }
  return db.transaction('rw', db.graded_catalog, db.graded_bodies, db.meta, async () => {
    const before = (await getMeta<number>(GRADED_META.cursor)) ?? 0;
    const cursor = Math.max(before, maxSeq);
    if (keep.length) await db.graded_catalog.bulkPut(keep);
    if (gone.length) {
      await db.graded_catalog.bulkDelete(gone);
      await db.graded_bodies.bulkDelete(gone);
    }
    await setMeta(GRADED_META.cursor, cursor);
    return { stored: keep.length, removed: gone.length, cursor };
  });
}

export type GradedPullOutcome =
  | { status: 'no_backend' | 'offline' | 'fresh' }
  | { status: 'done'; stored: number; removed: number }
  | { status: 'failed'; error: string };

/** One catalogue pull (pages after the cursor). Never throws. */
export async function pullGradedCatalog(
  opts: { force?: boolean; now?: Millis; isOnline?: () => boolean } = {},
): Promise<GradedPullOutcome> {
  const now = opts.now ?? Date.now();
  try {
    const remote = await gradedRemote();
    if (!remote) return { status: 'no_backend' };
    if (!(opts.isOnline ?? online)()) return { status: 'offline' };
    const last = (await getMeta<number>(GRADED_META.syncedAt)) ?? null;
    const filled = (await db.graded_catalog.count()) > 0;
    if (!opts.force && filled && last !== null && now - last < GRADED_REFRESH_MS) return { status: 'fresh' };
    let cursor = await getGradedCursor();
    let stored = 0;
    let removed = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = await remote.catalogPage(cursor, GRADED_PAGE);
      const r = await applyGradedCatalogPage(rows);
      stored += r.stored;
      removed += r.removed;
      if (rows.length < GRADED_PAGE || r.cursor <= cursor) break;
      cursor = r.cursor;
    }
    await setMeta(GRADED_META.syncedAt, now);
    return { status: 'done', stored, removed };
  } catch (e) {
    void logError(e, 'library.pull');
    return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}

let inflight: Promise<GradedPullOutcome> | null = null;

/** Starts a pull unless one is running (after a sync, on opening the library). */
export function kickGradedCatalogPull(opts: { force?: boolean } = {}): Promise<GradedPullOutcome> {
  inflight ??= pullGradedCatalog(opts).finally(() => {
    inflight = null;
  });
  return inflight;
}

export async function listGradedCatalog(): Promise<GradedCatalogEntry[]> {
  return db.graded_catalog.toArray();
}

export async function countGradedCatalog(): Promise<number> {
  return db.graded_catalog.count();
}

// ------------------------------------------------------------------ bodies

export class GradedUnavailableError extends Error {
  readonly reason: 'offline' | 'no_backend' | 'not_found';
  constructor(reason: 'offline' | 'no_backend' | 'not_found') {
    super(`graded text unavailable: ${reason}`);
    this.name = 'GradedUnavailableError';
    this.reason = reason;
  }
}

/**
 * A library text's sentences ({en, tr, audio_key, p}) and glosses: from this device when it
 * was opened before, else fetched once and kept. Throws GradedUnavailableError when it is not
 * on the device and cannot be fetched (offline, no backend, withdrawn).
 */
export async function getGradedBody(gradedId: string, now: Millis = Date.now()): Promise<GradedBody> {
  const cached = await db.graded_bodies.get(gradedId);
  if (cached) return cached;
  const remote = await gradedRemote();
  if (!remote) throw new GradedUnavailableError('no_backend');
  if (!online()) throw new GradedUnavailableError('offline');
  const raw = await remote.body(gradedId);
  const r = raw ? gradedBodySchema.safeParse(raw) : null;
  if (!r?.success || r.data.status !== 'approved') throw new GradedUnavailableError('not_found');
  const body: GradedBody = {
    id: r.data.id,
    title: r.data.title,
    sentences: r.data.sentences.map((s) => ({ en: s.en, tr: s.tr, audio_key: s.audio_key, p: s.p })),
    glosses: r.data.glosses,
    fetched_at: now,
  };
  await db.graded_bodies.put(body);
  return body;
}

export async function hasGradedBody(gradedId: string): Promise<boolean> {
  return (await db.graded_bodies.get(gradedId)) !== undefined;
}

// ------------------------------------------------------------------ reading rows

/** The user's reading rows of library texts, by graded_id (newest first wins). */
export async function gradedReadingRows(): Promise<Map<string, ReaderText>> {
  const rows = await db.texts.where('kind').equals('graded').toArray();
  const out = new Map<string, ReaderText>();
  for (const r of rows.sort((a, b) => b.updated_at - a.updated_at)) {
    if (r.deleted_at !== null || !r.graded_id || out.has(r.graded_id)) continue;
    out.set(r.graded_id, r);
  }
  return out;
}

/**
 * The reading row for a library text: the user's existing one (resume point kept), else a new
 * `texts` row (kind 'graded', empty body: the sentences are shared). The body is fetched now
 * when it can be, so the text reads offline from here on. Returns the row id for readerPath.
 */
export async function openGradedText(entry: { id: string; title: string }, now: Millis = Date.now()): Promise<Id> {
  const existing = (await gradedReadingRows()).get(entry.id);
  const id = existing?.id ?? (await saveText({ kind: 'graded', graded_id: entry.id, title: entry.title, body: '' }, now));
  try {
    await getGradedBody(entry.id, now);
  } catch (e) {
    // Offline before the first open: the reader asks again when it shows the text.
    if (!(e instanceof GradedUnavailableError)) void logError(e, 'library.open');
  }
  return id;
}

// ------------------------------------------------------------------ suggestions

const isDifficulty = (v: unknown): v is ReadingDifficulty =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(DIFFICULTY_BANDS, v);

/**
 * The user's reading difficulty (settings.reading_difficulty, added by the reader package);
 * 'dengeli' when it is not set or not known.
 */
export async function getReadingDifficulty(): Promise<ReadingDifficulty> {
  const s = (await getSettings()) as unknown as { reading_difficulty?: unknown };
  return isDifficulty(s.reading_difficulty) ? s.reading_difficulty : DEFAULT_DIFFICULTY;
}

export interface ScoredLibrary {
  difficulty: ReadingDifficulty;
  texts: ScoredGradedText[];
  /** Library texts the user finished. */
  finished: Set<string>;
  /** Library texts the user started (reading row with a resume point). */
  started: Set<string>;
  /** The user's reading row per library text. */
  rows: Map<string, ReaderText>;
}

/** Every catalogue text measured against what the user knows (the reader's knowledge model). */
export async function scoreLibrary(difficulty?: ReadingDifficulty): Promise<ScoredLibrary> {
  const [entries, knowledge, settings, rows, chosen] = await Promise.all([
    listGradedCatalog(),
    loadKnowledge(),
    getSettings(),
    gradedReadingRows(),
    difficulty ? Promise.resolve(difficulty) : getReadingDifficulty(),
  ]);
  const interests = new Set(settings.interests ?? []);
  const texts = entries.map((entry) =>
    scoreGradedText(entry, { pKnown: knowledge.pKnown, difficulty: chosen, interests, topicInterests }),
  );
  const finished = new Set<string>();
  const started = new Set<string>();
  for (const [gid, r] of rows) {
    if (r.finished_at !== null) finished.add(gid);
    else if (r.progress_offset > 0 || r.read_ms > 0) started.add(gid);
  }
  return { difficulty: chosen, texts, finished, started, rows };
}

export const summaryOf = (s: ScoredGradedText): GradedSummary => ({
  id: s.entry.id,
  title: s.entry.title,
  level: s.entry.level,
  topic: s.entry.topic,
  words: s.entry.words,
  unknownRate: s.unknownRate,
  fit: s.fit,
});

/**
 * Library texts that fit the user's difficulty, best first (domain/library.ts suggestTexts):
 * inside the band, the user's interests first, nearest the band's centre; finished texts last.
 * Works offline on the downloaded catalogue (pulled after each sync for a signed-in user, and
 * when the library opens); never calls the network itself.
 */
export async function suggestedGradedTexts(difficulty: ReadingDifficulty, limit: number): Promise<GradedSummary[]> {
  const lib = await scoreLibrary(isDifficulty(difficulty) ? difficulty : DEFAULT_DIFFICULTY);
  return suggestTexts(lib.texts, lib.difficulty, limit, lib.finished).map(summaryOf);
}
