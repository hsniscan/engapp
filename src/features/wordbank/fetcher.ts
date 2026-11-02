// Downloading the word bank (decision 0038): public.word_bank is readable with the public key,
// so guests get it too. Pages of WORDBANK_PAGE rows after the device's cursor (server_seq), so
// the first download is ~10 requests and later ones only bring what changed. Runs when the
// bank screen opens (at most every WORD_BANK_REFRESH_MS); after that the bank works offline.
import {
  WORDBANK_COLUMNS,
  WORDBANK_PAGE,
} from '../../../supabase/functions/_shared/wordbank-contract';
import {
  applyWordBankPage,
  countWordBank,
  getWordBankCursor,
  getWordBankSyncedAt,
  logError,
  markWordBankSynced,
} from '@/data';
import { backendConfig, requireSupabase } from '@/lib/supabase';

/**
 * A filled copy is asked for changes again after this long. Short on purpose: an up-to-date
 * copy costs one empty page, and a day-long wait left devices that first opened the screen
 * mid-fill (or before a clean-up) with a partial bank.
 */
export const WORD_BANK_REFRESH_MS = 15 * 60_000;
/** Safety stop: never more pages than this in one run (~20 000 rows). */
const MAX_PAGES = 20;

export interface WordBankFetchDeps {
  /** Rows with server_seq > after, oldest first, at most `limit`. Null: no backend (dev). */
  fetchPage: ((after: number, limit: number) => Promise<unknown[]>) | null;
  isOnline: () => boolean;
  now: () => number;
}

export const defaultWordBankDeps: WordBankFetchDeps = {
  fetchPage: backendConfig
    ? async (after, limit) => {
        const { data, error } = await (await requireSupabase())
          .from('word_bank')
          .select(WORDBANK_COLUMNS)
          .gt('server_seq', after)
          .order('server_seq', { ascending: true })
          .limit(limit);
        if (error) throw new Error(`word_bank: ${error.message}`);
        return (data ?? []) as unknown[];
      }
    : null,
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
  now: () => Date.now(),
};

export type WordBankFetchOutcome =
  | { status: 'no_backend' | 'offline' | 'fresh' }
  | { status: 'done'; stored: number; removed: number }
  | { status: 'failed'; error: string };

export interface WordBankFetchOptions {
  force?: boolean;
  /** Rows on the device so far, after each page (the first download is ~10 pages). */
  onProgress?: (rows: number) => void;
}

let inflight: Promise<WordBankFetchOutcome> | null = null;
const progressListeners = new Set<(rows: number) => void>();

/**
 * One download run. Never throws. A run already going is joined, not doubled (the bank tab
 * and the add sheet can both start one); its progress reaches every caller.
 */
export function fetchWordBank(
  deps: WordBankFetchDeps = defaultWordBankDeps,
  opts: WordBankFetchOptions = {},
): Promise<WordBankFetchOutcome> {
  const listener = opts.onProgress;
  if (listener) progressListeners.add(listener);
  const run =
    inflight ??
    (inflight = runFetch(deps, opts.force ?? false, (n) => {
      for (const l of [...progressListeners]) l(n);
    }).finally(() => {
      inflight = null;
    }));
  return run.finally(() => {
    if (listener) progressListeners.delete(listener);
  });
}

/** The first full download finished (a partial copy left by a dropped connection is not). */
export async function isWordBankComplete(): Promise<boolean> {
  return (await getWordBankSyncedAt()) !== null;
}

async function runFetch(
  deps: WordBankFetchDeps,
  force: boolean,
  onProgress: (rows: number) => void,
): Promise<WordBankFetchOutcome> {
  const opts = { force };
  try {
    if (!deps.fetchPage) return { status: 'no_backend' };
    if (!deps.isOnline()) return { status: 'offline' };
    const last = await getWordBankSyncedAt();
    const filled = (await countWordBank()) > 0;
    if (!opts.force && filled && last !== null && deps.now() - last < WORD_BANK_REFRESH_MS)
      return { status: 'fresh' };
    let cursor = await getWordBankCursor();
    let stored = 0;
    let removed = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = await deps.fetchPage(cursor, WORDBANK_PAGE);
      const r = await applyWordBankPage(rows);
      stored += r.stored;
      removed += r.removed;
      onProgress(await countWordBank());
      if (rows.length < WORDBANK_PAGE || r.cursor <= cursor) break;
      cursor = r.cursor;
    }
    await markWordBankSynced(deps.now());
    return { status: 'done', stored, removed };
  } catch (e) {
    void logError(e, 'wordBank.fetch');
    return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}
