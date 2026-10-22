// The client level file (data/levels/client-levels.tsv, ~490 KB, ~160 KB compressed): word
// lists and word frequency for levels without the server (guests, offline, senses added by
// hand). It is a hashed build asset fetched the first time a screen needs levels; the service
// worker keeps it (CacheFirst, like the pdf.js worker: docs/decisions/0008 and 0012), so it
// works offline after that. Not in the precache: it is not needed to open the app.
import levelsUrl from '../../data/levels/client-levels.tsv?url';
import { parseClientLevels, type LevelData } from '@/domain/level';

let pending: Promise<LevelData> | null = null;
let loaded: LevelData | null = null;

/** The parsed file; loads it once. A failed load is retried on the next call. */
export function loadLevelData(fetchImpl: typeof fetch = fetch): Promise<LevelData> {
  pending ??= fetchImpl(levelsUrl)
    .then((r) => {
      if (!r.ok) throw new Error(`level data: HTTP ${r.status}`);
      return r.text();
    })
    .then((text) => {
      loaded = parseClientLevels(text);
      return loaded;
    })
    .catch((e: unknown) => {
      pending = null;
      throw e;
    });
  return pending;
}

/** The file if it is already loaded (synchronous; null before the first load). */
export function levelDataNow(): LevelData | null {
  return loaded;
}

/** Tests only. */
export function setLevelDataForTests(data: LevelData | null): void {
  loaded = data;
  pending = data ? Promise.resolve(data) : null;
}
