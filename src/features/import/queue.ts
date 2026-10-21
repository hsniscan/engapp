// Import job runner (plan steps 4–5): chunks go one by one, local chunk_cache first (the
// same text never reaches the AI twice), then ai-extract with a short gap between calls.
// Offline: the job waits ("sırada") and resumes on the `online` event. One tab runs it.
import { AiClientError, extractChunk, type ExtractResponse } from '@/ai/client';
import {
  getCachedChunk,
  listPendingImportJobs,
  logError,
  recordChunkResult,
  updateImportJob,
  type ChunkResult,
  type ImportErrorCode,
  type ImportJobRecord,
} from '@/data';
import { hashChunk } from '@/domain/chunking';
import type { CefrLevel } from '@/domain/types';
import { getAccessToken, isBackendConfigured } from '@/lib/supabase';
import { createTabRunner } from '@/sync/lock';

/** Pause between two AI calls (free-tier rate limits; plan: "aralarında kısa beklemeyle"). */
export const CHUNK_GAP_MS = 600;
/** Transient AI errors (busy model, 5xx) are retried this many times per chunk. */
export const TRANSIENT_RETRIES = 2;

export interface ImportQueueDeps {
  extract: (input: {
    text: string;
    level: CefrLevel;
  }) => Promise<ExtractResponse & { chunk_hash: string }>;
  isOnline: () => boolean;
  isSignedIn: () => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  gapMs: number;
}

export const defaultQueueDeps: ImportQueueDeps = {
  extract: (input) => extractChunk(input),
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
  isSignedIn: async () => isBackendConfigured() && (await getAccessToken()) !== null,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  gapMs: CHUNK_GAP_MS,
};

export function toChunkResult(res: ExtractResponse, level: CefrLevel): ChunkResult {
  return {
    prompt_version: res.prompt_version,
    level,
    candidates: res.candidates.map((c) => ({
      term: c.term,
      surface: c.surface,
      term_type: c.term_type,
      source_sentence: c.source_sentence,
      span: c.span,
      confidence: c.confidence,
      match: c.match,
      lexicon: { ...c.lexicon },
    })),
  };
}

function errorCodeOf(e: unknown): ImportErrorCode | 'offline' {
  if (e instanceof AiClientError) {
    switch (e.code) {
      case 'offline':
        return 'offline';
      case 'daily_limit':
      case 'quota_exceeded':
      case 'ai_failed':
      case 'not_configured':
      case 'invalid_input':
      case 'bad_response':
        return e.code;
      case 'not_signed_in':
      case 'unauthorized':
        return 'not_signed_in';
      case 'internal':
        return 'ai_failed';
      default:
        return 'unknown';
    }
  }
  return 'unknown';
}

export type QueueStop = 'idle' | 'offline' | 'signed_out' | 'daily_limit';

/**
 * Process every pending job until done, offline, signed out or the daily limit. Returns why
 * it stopped. Safe to call repeatedly; callers serialize through runImportQueue().
 */
export async function processImportQueue(
  deps: ImportQueueDeps = defaultQueueDeps,
): Promise<QueueStop> {
  let aiCalls = 0;
  for (;;) {
    const jobs = (await listPendingImportJobs()).filter(
      (j) => !j.next_attempt_at || j.next_attempt_at <= deps.now(),
    );
    if (jobs.length === 0) return 'idle';
    const job = jobs[0]!;
    const stop = await processJob(job, deps, () => aiCalls++);
    if (stop) return stop;
  }
}

async function processJob(
  job: ImportJobRecord,
  deps: ImportQueueDeps,
  countCall: () => number,
): Promise<QueueStop | null> {
  let retries = 0;
  for (let index = job.chunk_done; index < job.chunk_total;) {
    const text = (job.chunks[index] ?? '').normalize('NFC');
    const hash = await hashChunk(text);
    const cached = await getCachedChunk(hash, job.level);
    if (cached) {
      await recordChunkResult(job.id, index, hash, cached, { fromLocalCache: true }, deps.now());
      index++;
      continue;
    }
    if (!deps.isOnline()) {
      await updateImportJob(job.id, { status: 'queued' }, deps.now());
      return 'offline';
    }
    if (!(await deps.isSignedIn())) {
      // Waits in the queue; signing in again resumes it.
      await updateImportJob(
        job.id,
        { status: 'queued', error_code: 'not_signed_in', error: null },
        deps.now(),
      );
      return 'signed_out';
    }
    await updateImportJob(job.id, { status: 'processing' }, deps.now());
    if (countCall() > 0) await deps.sleep(deps.gapMs);
    try {
      const res = await deps.extract({ text, level: job.level });
      const result = toChunkResult(res, job.level);
      const lexiconHits = res.cache_hit ? 0 : res.candidates.filter((c) => c.lexicon_hit).length;
      await recordChunkResult(
        job.id,
        index,
        hash,
        result,
        { fromLocalCache: false, serverCacheHit: res.cache_hit, lexiconHits },
        deps.now(),
      );
      index++;
      retries = 0;
    } catch (e) {
      let code = errorCodeOf(e);
      // A failed request while the browser says it is online (server down, CORS rejection,
      // flaky network) must not park the job until the next `online` event: retry, then fail.
      if (code === 'offline' && deps.isOnline()) code = 'unreachable';
      if (code === 'offline') {
        await updateImportJob(job.id, { status: 'queued' }, deps.now());
        return 'offline';
      }
      if (code === 'not_signed_in') {
        await updateImportJob(
          job.id,
          { status: 'queued', error_code: 'not_signed_in', error: null },
          deps.now(),
        );
        return 'signed_out';
      }
      const transient = code === 'quota_exceeded' || code === 'ai_failed' || code === 'unreachable';
      if (transient && retries < TRANSIENT_RETRIES) {
        retries++;
        const retryAfter = e instanceof AiClientError && e.retryAfterS ? e.retryAfterS * 1000 : 0;
        await deps.sleep(Math.min(60_000, Math.max(retryAfter, 3_000 * 2 ** (retries - 1))));
        continue;
      }
      if (code === 'unknown') void logError(e, 'import.extract');
      await updateImportJob(
        job.id,
        { status: 'failed', error_code: code, error: e instanceof Error ? e.message : String(e) },
        deps.now(),
      );
      if (code === 'daily_limit') return 'daily_limit';
      return null; // next job
    }
  }
  return null;
}

// ------------------------------------------------------------------ app wiring

const runner = createTabRunner('engapp-import', () => kickImportQueue());
let running: Promise<QueueStop | undefined> | null = null;
let again = false;

/** Start (or continue) processing in the background. Idempotent. */
export function kickImportQueue(deps: ImportQueueDeps = defaultQueueDeps): void {
  if (running) {
    again = true;
    return;
  }
  running = runner
    .run(() => processImportQueue(deps))
    .catch((e: unknown) => {
      void logError(e, 'import.queue');
      return undefined;
    })
    .finally(() => {
      running = null;
      if (again) {
        again = false;
        kickImportQueue(deps);
      }
    });
}

let started = false;

/** Resume queued jobs now and whenever the connection comes back. */
export function startImportQueue(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('online', () => kickImportQueue());
  kickImportQueue();
}
