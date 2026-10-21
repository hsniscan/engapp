// Background preparation of example sentences (v0.2 İP5, ADR 0013). Senses of newly added
// cards (and, after "Tüm kartlarım için hazırla", all of them) are queued in example_jobs;
// this runner sends them to ai-examples in batches of up to 8 senses × 4 contexts. The
// shared lexicon answers whatever it already has without an AI call. Offline or signed out,
// jobs simply wait; the `online` event and new senses wake the runner. One tab runs it.
import { liveQuery } from 'dexie';
import { AiClientError } from '@/ai/client';
import { generateExamples, type ExamplesRequest, type ExamplesResponse } from '@/ai/examples';
import {
  countExampleCall,
  db,
  dueExampleJobs,
  exampleCallsToday,
  finishExampleJobs,
  logError,
  queueExampleJob,
  reconcileExampleJobs,
  storeExamples,
  JOB_PRIORITY,
} from '@/data';
import type { ExampleJob, Id } from '@/domain/types';
import {
  MAX_EXAMPLE_CONTEXTS,
  MAX_EXAMPLE_SENSES,
} from '../../../supabase/functions/_shared/examples-contracts';
import { getAccessToken, isBackendConfigured } from '@/lib/supabase';
import { createTabRunner } from '@/sync/lock';

/**
 * Background AI calls per local day on this device (plan: "günde en fazla 50 çağrı"): the
 * server's daily limit is shared with imports and the user's own actions, so the backfill
 * spreads over days instead of using it up. Calls answered from the cache do not count.
 */
export const DAILY_BACKGROUND_CALLS = 50;
/** A failing batch is retried this many times (with backoff), then its jobs are marked failed. */
export const MAX_JOB_ATTEMPTS = 3;
/** Pause between two background calls. */
export const EXAMPLE_GAP_MS = 1_500;
/** After the server's daily limit: try again this much later. */
export const DAILY_LIMIT_PAUSE_MS = 6 * 60 * 60_000;

export interface ExampleQueueDeps {
  generate: (input: ExamplesRequest) => Promise<ExamplesResponse>;
  isOnline: () => boolean;
  isSignedIn: () => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  gapMs: number;
  dailyCalls: number;
}

export const defaultExampleDeps: ExampleQueueDeps = {
  generate: (input) => generateExamples(input),
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
  isSignedIn: async () => isBackendConfigured() && (await getAccessToken()) !== null,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  gapMs: EXAMPLE_GAP_MS,
  dailyCalls: DAILY_BACKGROUND_CALLS,
};

export type ExampleQueueStop = 'idle' | 'offline' | 'signed_out' | 'daily_limit' | 'daily_cap';

/**
 * Due jobs of one band whose contexts fit one request (≤ 8 senses, ≤ 4 contexts in all),
 * starting with the most urgent job.
 */
export function pickBatch(due: readonly ExampleJob[]): { jobs: ExampleJob[]; contexts: string[] } {
  const first = due[0];
  if (!first) return { jobs: [], contexts: [] };
  const jobs: ExampleJob[] = [];
  const contexts = new Set<string>();
  for (const job of due) {
    if (job.level_band !== first.level_band) continue;
    const union = new Set([...contexts, ...job.contexts]);
    if (union.size > MAX_EXAMPLE_CONTEXTS) continue;
    jobs.push(job);
    for (const c of job.contexts) contexts.add(c);
    if (jobs.length >= MAX_EXAMPLE_SENSES) break;
  }
  // A single job asking for more than 4 contexts (contexts added on top of the selection):
  // send its first four; the rest is asked again by the next reconcile.
  if (jobs.length === 0) return { jobs: [first], contexts: first.contexts.slice(0, MAX_EXAMPLE_CONTEXTS) };
  return { jobs, contexts: [...contexts] };
}

const backoffMs = (attempts: number) => Math.min(60 * 60_000, 60_000 * 4 ** Math.max(0, attempts - 1));

/** Work through due jobs until done, offline, signed out or a daily limit. */
export async function processExampleQueue(deps: ExampleQueueDeps = defaultExampleDeps): Promise<ExampleQueueStop> {
  if (!deps.isOnline()) return 'offline';
  if (!(await deps.isSignedIn())) return 'signed_out';
  await reconcileExampleJobs(deps.now());
  let calls = 0;
  for (let round = 0; round < 1_000; round++) {
    const due = await dueExampleJobs(deps.now());
    const { jobs, contexts } = pickBatch(due);
    if (jobs.length === 0) return 'idle';
    const urgent = jobs.some((j) => j.priority >= JOB_PRIORITY.open);
    if (!urgent && (await exampleCallsToday(deps.now())) >= deps.dailyCalls) return 'daily_cap';
    if (!deps.isOnline()) return 'offline';
    if (calls++ > 0) await deps.sleep(deps.gapMs);
    const keys = jobs.map((j) => j.key);
    try {
      const res = await deps.generate({
        sense_ids: jobs.map((j) => j.sense_id),
        level_band: jobs[0]!.level_band,
        contexts,
      });
      await storeExamples(res.examples);
      if (res.ai_called) await countExampleCall(deps.now());
      await finishExampleJobs(keys, { status: 'done' }, deps.now());
    } catch (e) {
      const code = e instanceof AiClientError ? e.code : 'unknown';
      if (code === 'offline' && !deps.isOnline()) return 'offline';
      if (code === 'not_signed_in' || code === 'unauthorized') return 'signed_out';
      if (code === 'daily_limit') {
        await finishExampleJobs(keys, { status: 'queued', next_attempt_at: deps.now() + DAILY_LIMIT_PAUSE_MS, error: code }, deps.now());
        return 'daily_limit';
      }
      const attempts = Math.max(...jobs.map((j) => j.attempts)) + 1;
      const transient = !(e instanceof AiClientError) || e.transient || code === 'offline';
      if (code === 'unknown') void logError(e, 'examples.queue');
      if (transient && attempts < MAX_JOB_ATTEMPTS) {
        const retryAfter = e instanceof AiClientError && e.retryAfterS ? e.retryAfterS * 1000 : 0;
        await finishExampleJobs(
          keys,
          { status: 'queued', next_attempt_at: deps.now() + Math.max(retryAfter, backoffMs(attempts)), error: code },
          deps.now(),
        );
      } else {
        await finishExampleJobs(keys, { status: 'failed', error: code }, deps.now());
      }
    }
  }
  return 'idle';
}

// ------------------------------------------------------------------ interactive requests

export type ExampleRequestError =
  | 'offline'
  | 'signed_out'
  | 'daily_limit'
  | 'busy'
  | 'no_lexicon'
  | 'failed';

export type ExampleRequestResult =
  | { ok: true; newIds: Id[] }
  | { ok: false; error: ExampleRequestError };

function requestError(e: unknown): ExampleRequestError {
  if (!(e instanceof AiClientError)) return 'failed';
  switch (e.code) {
    case 'offline':
      return 'offline';
    case 'not_signed_in':
    case 'unauthorized':
    case 'not_configured':
      return 'signed_out';
    case 'daily_limit':
      return 'daily_limit';
    case 'quota_exceeded':
      return 'busy';
    default:
      return 'failed';
  }
}

/**
 * Sentences asked for on screen: "Yenisini üret" (`fresh`) or a context added with
 * "+ Bağlam". Not subject to the background cap (the server's daily limit still applies).
 */
export async function requestExamples(
  input: { lexiconSenseId: Id | null; band: ExampleJob['level_band']; context: string; fresh: boolean },
  deps: Pick<ExampleQueueDeps, 'generate' | 'isOnline' | 'isSignedIn'> = defaultExampleDeps,
): Promise<ExampleRequestResult> {
  if (!input.lexiconSenseId) return { ok: false, error: 'no_lexicon' };
  if (!(await deps.isSignedIn())) return { ok: false, error: 'signed_out' };
  if (!deps.isOnline()) return { ok: false, error: 'offline' };
  try {
    const res = await deps.generate({
      sense_ids: [input.lexiconSenseId],
      level_band: input.band,
      contexts: [input.context],
      ...(input.fresh ? { fresh: { sense_id: input.lexiconSenseId, context: input.context } } : {}),
    });
    await storeExamples(res.examples);
    return { ok: true, newIds: res.new_ids };
  } catch (e) {
    if (!(e instanceof AiClientError)) void logError(e, 'examples.request');
    return { ok: false, error: requestError(e) };
  }
}

// ------------------------------------------------------------------ app wiring

const runner = createTabRunner('engapp-examples', () => kickExampleQueue());
let running: Promise<unknown> | null = null;
let again = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/** Run the queue in the background now (coalesced). */
export function kickExampleQueue(deps: ExampleQueueDeps = defaultExampleDeps): void {
  if (running) {
    again = true;
    return;
  }
  running = runner
    .run(() => processExampleQueue(deps))
    .catch((e: unknown) => {
      void logError(e, 'examples.queue');
      return undefined;
    })
    .finally(async () => {
      running = null;
      if (again) {
        again = false;
        kickExampleQueue(deps);
        return;
      }
      await scheduleRetry(deps);
    });
}

/** Wake up for the earliest job waiting on a backoff (at most an hour ahead). */
async function scheduleRetry(deps: ExampleQueueDeps): Promise<void> {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const next = (await db.example_jobs.where('status').equals('queued').toArray())
    .map((j) => j.next_attempt_at)
    .filter((t) => t > deps.now())
    .sort((a, b) => a - b)[0];
  if (next === undefined) return;
  retryTimer = setTimeout(() => kickExampleQueue(deps), Math.min(60 * 60_000, next - deps.now() + 1_000));
}

/** The section is open on screen: prepare this sense first. */
export async function prioritizeExamples(lexiconSenseId: Id): Promise<void> {
  const job = await queueExampleJob(lexiconSenseId, { priority: JOB_PRIORITY.open });
  if (job?.status === 'queued') kickExampleQueue();
}

let started = false;
const NEW_SENSE_DEBOUNCE_MS = 5_000;

/** Start the background preparation (signed-in builds). Idempotent. */
export function startExampleQueue(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('online', () => kickExampleQueue());
  // New senses (added here or pulled from another device) get their sentences soon after.
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last: number | null = null;
  liveQuery(() => db.senses.count()).subscribe({
    next: (n) => {
      if (last !== null && n === last) return;
      last = n;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => kickExampleQueue(), NEW_SENSE_DEBOUNCE_MS);
    },
    error: (e: unknown) => void logError(e, 'examples.watch'),
  });
}
