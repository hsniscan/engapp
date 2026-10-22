// Keeping the pictures of the user's cards on the device (v0.4 İP3, ADR 0031). After every
// sync, when cards are added and every few hours, the runner asks the server which pictures
// exist for the user's lexicon senses (a small listing without SVG), downloads only the ones
// the device lacks, sanitizes them and stores them in Dexie (`images`), within ~20 MB. Offline
// or signed out it does nothing: cards then simply show no picture (or the cached one).
import { liveQuery } from 'dexie';
import { downloadImages, listImageManifest } from '@/ai/image';
import {
  applyImageFetch,
  db,
  getMeta,
  listCachedImageKeys,
  listImageSenseIds,
  logError,
  setMeta,
  type ImageFetchResult,
} from '@/data';
import { diffManifest, toCachedImage, type CachedImage, type ImageManifestRow } from '@/domain/images';
import type { LexiconImageRow, SanitizeResult } from '../../../supabase/functions/_shared/image-contract';
import { getAccessToken, isBackendConfigured } from '@/lib/supabase';
import { engine } from '@/sync/instance';
import { createTabRunner } from '@/sync/lock';

/** Without new cards, the listing is asked again after this long (new pictures, approvals). */
export const IMAGE_REFRESH_MS = 6 * 60 * 60_000;
/** meta key: when the last full fetch finished and for which set of senses. */
export const IMAGE_FETCH_META = 'images_fetch';

interface FetchMark {
  at: number;
  /** Fingerprint of the sense ids the fetch covered. */
  key: string;
}

export interface ImageFetchDeps {
  listManifest: (senseIds: readonly string[]) => Promise<ImageManifestRow[]>;
  download: (ids: readonly string[]) => Promise<LexiconImageRow[]>;
  isOnline: () => boolean;
  isSignedIn: () => Promise<boolean>;
  now: () => number;
  /** Tests: a stand-in for the İP2 sanitizer. */
  sanitize?: (svg: string) => SanitizeResult;
  capBytes?: number;
}

export const defaultImageFetchDeps: ImageFetchDeps = {
  listManifest: (ids) => listImageManifest(ids),
  download: (ids) => downloadImages(ids),
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
  isSignedIn: async () => isBackendConfigured() && (await getAccessToken()) !== null,
  now: () => Date.now(),
};

/** FNV-1a over the sorted ids: changes when a sense is added or removed. */
export function senseSetKey(ids: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const id of ids) {
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x2c;
    h = Math.imul(h, 0x01000193);
  }
  return `${ids.length}:${(h >>> 0).toString(16)}`;
}

export type ImageFetchOutcome =
  | { status: 'offline' | 'signed_out' | 'fresh' }
  | { status: 'done'; result: ImageFetchResult; downloaded: number }
  | { status: 'failed'; error: string };

/**
 * One fetch. Skipped while the last one is fresh for the same senses, unless `force`.
 * Never throws.
 */
export async function fetchImages(
  deps: ImageFetchDeps = defaultImageFetchDeps,
  opts: { force?: boolean } = {},
): Promise<ImageFetchOutcome> {
  try {
    if (!deps.isOnline()) return { status: 'offline' };
    if (!(await deps.isSignedIn())) return { status: 'signed_out' };
    const now = deps.now();
    const senseIds = await listImageSenseIds();
    const key = senseSetKey(senseIds);
    const last = await getMeta<FetchMark>(IMAGE_FETCH_META);
    if (!opts.force && last && last.key === key && now - last.at < IMAGE_REFRESH_MS) return { status: 'fresh' };

    const manifest = senseIds.length ? await deps.listManifest(senseIds) : [];
    const diff = diffManifest(await listCachedImageKeys(), manifest, new Set(senseIds));
    const rows = diff.download.length ? await deps.download(diff.download) : [];
    const wanted = new Set(diff.download);
    const downloaded: CachedImage[] = [];
    for (const row of rows) {
      if (!wanted.has(row.id)) continue;
      const cached = toCachedImage(row, now, deps.sanitize);
      if (cached) downloaded.push(cached);
    }
    const result = await applyImageFetch(diff, downloaded, deps.capBytes);
    await setMeta(IMAGE_FETCH_META, { at: now, key } satisfies FetchMark);
    return { status: 'done', result, downloaded: downloaded.length };
  } catch (e) {
    void logError(e, 'images.fetch');
    return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}

// ------------------------------------------------------------------ app wiring

const runner = createTabRunner('engapp-images', () => kickImageFetch());
let running: Promise<unknown> | null = null;
let again: { force: boolean } | null = null;

/** Fetch in the background now (coalesced; one tab runs it). */
export function kickImageFetch(opts: { force?: boolean } = {}, deps: ImageFetchDeps = defaultImageFetchDeps): void {
  if (running) {
    again = { force: (again?.force ?? false) || !!opts.force };
    return;
  }
  running = runner
    .run(() => fetchImages(deps, opts))
    .finally(() => {
      running = null;
      if (again) {
        const next = again;
        again = null;
        kickImageFetch(next, deps);
      }
    });
}

let started = false;
const NEW_SENSE_DEBOUNCE_MS = 4_000;
const CHECK_INTERVAL_MS = 30 * 60_000;

/** Start the background fetch (signed-in builds). Idempotent. */
export function startImageFetch(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('online', () => kickImageFetch());
  // After every successful sync (pulled senses from another device, approvals on the server).
  let wasRunning = engine.getSnapshot().running;
  engine.subscribe(() => {
    const snap = engine.getSnapshot();
    if (wasRunning && !snap.running && !snap.error) kickImageFetch();
    wasRunning = snap.running;
  });
  // New senses (cards added here): their pictures come a few seconds later.
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last: number | null = null;
  liveQuery(() => db.senses.count()).subscribe({
    next: (n) => {
      if (last !== null && n === last) return;
      last = n;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => kickImageFetch(), NEW_SENSE_DEBOUNCE_MS);
    },
    error: (e: unknown) => void logError(e, 'images.watch'),
  });
  // A periodic check (the fetch itself skips while the last one is fresh).
  setInterval(() => {
    if (document.visibilityState === 'visible') kickImageFetch();
  }, CHECK_INTERVAL_MS);
}
