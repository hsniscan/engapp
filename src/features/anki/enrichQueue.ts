// "Sözlükle eşleştir" after an Anki import (v0.3 İP1, ADR 0019): looks up the imported words
// with the existing ai-enrich function, ANKI_ENRICH_BATCH words per round. The server answers
// a word the shared lexicon has without an AI call; only unknown words use the daily budget.
// The runner stops before the budget runs out (ANKI_ENRICH_RESERVE calls are left for the
// user's own imports) and on the server's daily limit, and continues the next local day from
// where it stopped. Offline or signed out it simply waits. One tab runs it.
import { AiClientError, enrichTerm, toLexiconCacheRow, type EnrichResponse } from '@/ai/client';
import {
  ankiEnrichResumeAt,
  applyAnkiEnrichResult,
  getSettings,
  logError,
  nextAnkiEnrichItems,
  nextAnkiEnrichWake,
  pauseAnkiEnrich,
  type AnkiEnrichItem,
} from '@/data';
import type { EnrichRequest } from '../../../supabase/functions/_shared/contracts';
import { getAccessToken, isBackendConfigured } from '@/lib/supabase';
import { createTabRunner } from '@/sync/lock';

export const ANKI_ENRICH_BATCH = 20;
/** Daily AI calls left untouched for the user's own work. */
export const ANKI_ENRICH_RESERVE = 20;
/** After a passing failure (model busy, server error): try again this much later. */
export const ANKI_ENRICH_RETRY_MS = 30 * 60_000;
const GAP_MS = 300;

export interface AnkiEnrichDeps {
  enrich: (input: EnrichRequest) => Promise<EnrichResponse>;
  isOnline: () => boolean;
  isSignedIn: () => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  gapMs: number;
}

export const defaultAnkiEnrichDeps: AnkiEnrichDeps = {
  enrich: (input) => enrichTerm(input),
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
  isSignedIn: async () => isBackendConfigured() && (await getAccessToken()) !== null,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  gapMs: GAP_MS,
};

export type AnkiEnrichStop = 'idle' | 'offline' | 'signed_out' | 'daily_limit' | 'retry_later';

async function lookUp(item: AnkiEnrichItem, deps: AnkiEnrichDeps, level: EnrichRequest['level']): Promise<EnrichResponse | null> {
  try {
    return await deps.enrich({ term: item.term, more: false, level });
  } catch (e) {
    // A term the server refuses (not an English word, too long) simply has no match.
    if (e instanceof AiClientError && e.code === 'invalid_input') return null;
    throw e;
  }
}

/** Work through the queued words until done, offline, signed out or the daily budget. */
export async function processAnkiEnrich(deps: AnkiEnrichDeps = defaultAnkiEnrichDeps): Promise<AnkiEnrichStop> {
  if (!deps.isOnline()) return 'offline';
  if (!(await deps.isSignedIn())) return 'signed_out';
  const level = (await getSettings()).level;
  let calls = 0;
  for (let round = 0; round < 10_000; round++) {
    const items = await nextAnkiEnrichItems(ANKI_ENRICH_BATCH, deps.now());
    if (items.length === 0) return 'idle';
    for (const item of items) {
      if (!item.term) {
        await applyAnkiEnrichResult(item, null, deps.now());
        continue;
      }
      if (!deps.isOnline()) return 'offline';
      if (calls++ > 0) await deps.sleep(deps.gapMs);
      let res: EnrichResponse | null;
      try {
        res = await lookUp(item, deps, level);
      } catch (e) {
        const code = e instanceof AiClientError ? e.code : 'unknown';
        if (code === 'offline' && !deps.isOnline()) return 'offline';
        if (code === 'not_signed_in' || code === 'unauthorized' || code === 'not_configured') return 'signed_out';
        if (code === 'daily_limit') {
          await pauseAnkiEnrich(item.import_id, await ankiEnrichResumeAt(deps.now()), code, deps.now());
          return 'daily_limit';
        }
        if (code === 'unknown') void logError(e, 'anki.enrich');
        const retry = e instanceof AiClientError && e.retryAfterS ? e.retryAfterS * 1000 : 0;
        await pauseAnkiEnrich(item.import_id, deps.now() + Math.max(retry, ANKI_ENRICH_RETRY_MS), code, deps.now());
        return 'retry_later';
      }
      const found = res?.term ? { term_id: res.term.id, senses: res.senses.map(toLexiconCacheRow) } : null;
      await applyAnkiEnrichResult(item, found, deps.now());
      if (res?.usage && res.usage.limit - res.usage.used <= ANKI_ENRICH_RESERVE) {
        await pauseAnkiEnrich(item.import_id, await ankiEnrichResumeAt(deps.now()), 'daily_limit', deps.now());
        return 'daily_limit';
      }
    }
  }
  return 'idle';
}

const runner = createTabRunner('engapp-anki-enrich');
let running: Promise<unknown> | null = null;
let again = false;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;

/** Run now (or right after the current run). */
export function kickAnkiEnrich(deps: AnkiEnrichDeps = defaultAnkiEnrichDeps): void {
  if (running) {
    again = true;
    return;
  }
  running = runner
    .run(() => processAnkiEnrich(deps))
    .catch((e: unknown) => {
      void logError(e, 'anki.enrich');
      return undefined;
    })
    .finally(async () => {
      running = null;
      if (again) {
        again = false;
        kickAnkiEnrich(deps);
        return;
      }
      await scheduleWake(deps);
    });
}

/** Wake up when a pause ends (checked at least hourly while the app stays open). */
async function scheduleWake(deps: AnkiEnrichDeps): Promise<void> {
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = null;
  const next = await nextAnkiEnrichWake();
  if (next === null) return;
  wakeTimer = setTimeout(() => kickAnkiEnrich(deps), Math.min(60 * 60_000, Math.max(1_000, next - deps.now() + 1_000)));
}

let started = false;

/** Continue queued lookups after a restart and when the device is back online. Idempotent. */
export function startAnkiEnrichQueue(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('online', () => kickAnkiEnrich());
  kickAnkiEnrich();
}
