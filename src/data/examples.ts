// Example sentences on the device (v0.2 İP5, ADR 0013): the shared sentence cache
// (lexicon_examples, read-only), the user's verdicts (content_feedback) and edits
// (user_content), both synced and private, and the background preparation queue
// (example_jobs, device-local). The AI calls themselves live in src/features/examples.
import {
  bandFor,
  buildSenseExamples,
  EXAMPLE_SENTENCE_KIND,
  EXAMPLE_TARGET,
  editSpan,
  exampleEditRowId,
  exampleState,
  feedbackRowId,
  selectedContexts,
  type ExampleState,
  type SenseExamples,
} from '../domain/examples';
import { dayKeyOf } from '../domain/day';
import type {
  ExampleJob,
  FeedbackVerdict,
  Id,
  LevelBand,
  LexiconExample,
  Millis,
  UserContent,
} from '../domain/types';
import { db } from './db';
import { ActionError } from './errors';
import { exampleCallsKey, getMeta, setMeta } from './meta';
import { dayConfig, getSettings } from './settings';
import { applyLexiconExamples } from './sync';
import { writeTx } from './writer';

/** Longest edited sentence (the shared ones are at most 300 characters, too). */
export const MAX_EDIT_CHARS = 300;

// ------------------------------------------------------------------ reading

/** Feedback and edits about these shared sentences. */
async function stateFor(exampleIds: Id[]): Promise<ExampleState> {
  if (exampleIds.length === 0) return exampleState([], []);
  const [feedback, content] = await Promise.all([
    db.content_feedback
      .where('[target_kind+target_id]')
      .anyOf(exampleIds.map((id) => [EXAMPLE_TARGET, id]))
      .toArray(),
    db.user_content.where('replaces_id').anyOf(exampleIds).toArray(),
  ]);
  return exampleState(feedback, content);
}

/** Cached sentences of these lexicon senses (every band), grouped by sense. */
async function cachedExamples(lexiconSenseIds: Id[]): Promise<Map<Id, LexiconExample[]>> {
  const out = new Map<Id, LexiconExample[]>();
  if (lexiconSenseIds.length === 0) return out;
  for (const e of await db.lexicon_examples.where('sense_id').anyOf(lexiconSenseIds).toArray()) {
    const list = out.get(e.sense_id);
    if (list) list.push(e);
    else out.set(e.sense_id, [e]);
  }
  return out;
}

/** Everything the "Örnek cümleler" section needs for one lexicon sense. */
export interface SenseExamplesView {
  lexiconSenseId: Id;
  band: LevelBand;
  /** Contexts chosen in Settings (or the defaults). */
  selected: string[];
  /** Settings: show the Turkish translation without a tap. */
  trVisible: boolean;
  examples: SenseExamples;
  /** The preparation job of this sense in the user's band, if any. */
  job: ExampleJob | null;
}

export async function getSenseExamples(lexiconSenseId: Id, now: Millis = Date.now()): Promise<SenseExamplesView> {
  const settings = await getSettings(now);
  const band = bandFor(settings);
  const selected = selectedContexts(settings);
  const rows = (await cachedExamples([lexiconSenseId])).get(lexiconSenseId) ?? [];
  const state = await stateFor(rows.map((r) => r.id));
  return {
    lexiconSenseId,
    band,
    selected,
    trVisible: settings.example_tr_visible === true,
    examples: buildSenseExamples(rows, state, band, selected),
    job: (await db.example_jobs.get(jobKey(lexiconSenseId, band))) ?? null,
  };
}

/** Sentences of one lexicon sense for a card (rotation): read inside the caller's transaction. */
export async function senseExamplesFor(
  lexiconSenseId: Id,
  band: LevelBand,
  selected: string[],
): Promise<SenseExamples> {
  const rows = (await cachedExamples([lexiconSenseId])).get(lexiconSenseId) ?? [];
  return buildSenseExamples(rows, await stateFor(rows.map((r) => r.id)), band, selected);
}

/** Tables getCardView must read to build a rotating sentence. */
export const exampleTables = () => [db.lexicon_examples, db.content_feedback, db.user_content];

// ------------------------------------------------------------------ verdicts and edits

/**
 * Like / skip / reject a shared sentence; null takes the verdict back. One row per sentence
 * (deterministic id), synced to the user's account only.
 */
export async function setExampleVerdict(
  exampleId: Id,
  verdict: FeedbackVerdict | null,
  now: Millis = Date.now(),
): Promise<void> {
  const id = await feedbackRowId(EXAMPLE_TARGET, exampleId);
  await writeTx([db.content_feedback], now, async (w) => {
    const existing = await db.content_feedback.get(id);
    if (verdict === null) {
      if (existing && existing.deleted_at === null) await w.put('content_feedback', { ...existing, deleted_at: now });
      return;
    }
    if (existing && existing.deleted_at === null && existing.verdict === verdict) return;
    await w.put('content_feedback', {
      ...(existing ?? w.base(id)),
      user_id: existing?.user_id ?? w.userId,
      target_kind: EXAMPLE_TARGET,
      target_id: exampleId,
      verdict,
      deleted_at: null,
    });
  });
}

/**
 * Save the user's own version of a shared sentence. It stays in user_content (this account
 * only) and is never sent to the server's shared tables or to the model.
 * @throws ActionError('invalid_input') for an empty or too long sentence.
 */
export async function saveExampleEdit(
  exampleId: Id,
  text: string,
  opts: { senseId?: Id | null } = {},
  now: Millis = Date.now(),
): Promise<UserContent> {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean || clean.length > MAX_EDIT_CHARS) throw new ActionError('invalid_input', 'example sentence length');
  const original = await db.lexicon_examples.get(exampleId);
  if (!original) throw new ActionError('not_found', 'example sentence');
  const id = await exampleEditRowId(exampleId);
  return writeTx([db.user_content], now, async (w) => {
    const existing = await db.user_content.get(id);
    const unchanged = clean === original.text_en;
    const row: UserContent = {
      ...(existing ?? w.base(id)),
      user_id: existing?.user_id ?? w.userId,
      kind: EXAMPLE_SENTENCE_KIND,
      lexicon_sense_id: original.sense_id,
      sense_id: opts.senseId ?? existing?.sense_id ?? null,
      context: original.context,
      replaces_id: exampleId,
      text: clean,
      // The shared translation no longer fits an edited sentence.
      translations: unchanged ? { ...original.translations } : null,
      span: editSpan({ text: clean, span: null }, original),
      selected: null,
      // Saving the original text again takes the edit back.
      deleted_at: unchanged ? now : null,
    };
    return w.put('user_content', row);
  });
}

/** Back to the shared sentence. */
export async function removeExampleEdit(exampleId: Id, now: Millis = Date.now()): Promise<void> {
  const id = await exampleEditRowId(exampleId);
  await writeTx([db.user_content], now, async (w) => {
    const existing = await db.user_content.get(id);
    if (existing && existing.deleted_at === null) await w.put('user_content', { ...existing, deleted_at: now });
  });
}

/** Rows returned by ai-examples go straight into the local cache (the pull brings them too). */
export function storeExamples(rows: LexiconExample[]): Promise<void> {
  return applyLexiconExamples(rows);
}

// ------------------------------------------------------------------ preparation queue

export const jobKey = (lexiconSenseId: Id, band: LevelBand): string => `${lexiconSenseId}|${band}`;

/** Job priorities: a sense open on screen > a newly added card > the "prepare all" backfill. */
export const JOB_PRIORITY = { open: 2, recent: 1, backfill: 0 } as const;

/** Meta: when the background preparation started on this device (older senses wait for the backfill). */
export const EXAMPLES_SINCE_KEY = 'examples_since';
/** Meta: the user asked to prepare sentences for all existing cards. */
export const EXAMPLES_BACKFILL_KEY = 'examples_backfill';

/**
 * Contexts of `wanted` without any cached sentence of this band for the sense (whatever the
 * user's verdict: a context whose sentences were all rejected is not asked again by the
 * background queue; "Yenisini üret" is the way to get another one).
 */
function contextsWithoutSentences(rows: LexiconExample[] | undefined, band: LevelBand, wanted: string[]): string[] {
  const have = new Set((rows ?? []).filter((r) => r.level_band === band).map((r) => r.context));
  return wanted.filter((c) => !have.has(c));
}

/**
 * Queue (or re-queue) one sense. A finished job is only queued again when contexts were
 * added that it did not ask for (the model may skip a context that does not fit a word).
 */
export async function queueExampleJob(
  lexiconSenseId: Id,
  opts: { priority: number; contexts?: string[]; band?: LevelBand },
  now: Millis = Date.now(),
): Promise<ExampleJob | null> {
  const settings = await getSettings(now);
  const band = opts.band ?? bandFor(settings);
  const wanted = opts.contexts ?? selectedContexts(settings);
  const rows = (await cachedExamples([lexiconSenseId])).get(lexiconSenseId);
  const missing = contextsWithoutSentences(rows, band, wanted);
  return db.transaction('rw', db.example_jobs, async () => {
    const key = jobKey(lexiconSenseId, band);
    const job = await db.example_jobs.get(key);
    if (missing.length === 0) return job ?? null;
    if (job?.status === 'queued') {
      const contexts = [...new Set([...job.contexts, ...missing])];
      if (opts.priority > job.priority || contexts.length !== job.contexts.length) {
        const next = { ...job, contexts, priority: Math.max(job.priority, opts.priority), updated_at: now };
        await db.example_jobs.put(next);
        return next;
      }
      return job;
    }
    if (job && missing.every((c) => job.contexts.includes(c))) {
      // Asked before: the model had nothing natural for these contexts, or the job failed for
      // good. "Yenisini üret" / "+ Bağlam" on the card ask again explicitly.
      return job;
    }
    const next: ExampleJob = {
      key,
      sense_id: lexiconSenseId,
      level_band: band,
      contexts: missing,
      status: 'queued',
      priority: opts.priority,
      attempts: job?.status === 'failed' ? job.attempts : 0,
      next_attempt_at: now,
      created_at: job?.created_at ?? now,
      updated_at: now,
      error: null,
    };
    await db.example_jobs.put(next);
    return next;
  });
}

/**
 * Find senses whose sentences should be prepared and queue them: senses added since the
 * preparation started on this device (or all of them after "Tüm kartlarım için hazırla").
 * Returns the number of jobs queued.
 */
export async function reconcileExampleJobs(now: Millis = Date.now()): Promise<number> {
  let since = await getMeta<number>(EXAMPLES_SINCE_KEY);
  if (typeof since !== 'number') {
    // First run: cards of the last week count as new; older ones wait for the backfill.
    since = now - 7 * 86_400_000;
    await db.transaction('rw', db.meta, () => setMeta(EXAMPLES_SINCE_KEY, since));
  }
  const backfill = (await getMeta<boolean>(EXAMPLES_BACKFILL_KEY)) === true;
  const settings = await getSettings(now);
  const band = bandFor(settings);
  const wanted = selectedContexts(settings);
  const senses = (await db.senses.toArray()).filter(
    (s) => s.deleted_at === null && s.lexicon_sense_id && (backfill || s.created_at >= since),
  );
  const ids = [...new Set(senses.map((s) => s.lexicon_sense_id!))];
  const cached = await cachedExamples(ids);
  const jobs = new Map((await db.example_jobs.toArray()).map((j) => [j.key, j]));
  const recent = new Set(senses.filter((s) => s.created_at >= since).map((s) => s.lexicon_sense_id!));
  let queued = 0;
  for (const id of ids) {
    const missing = contextsWithoutSentences(cached.get(id), band, wanted);
    if (missing.length === 0) continue;
    const job = jobs.get(jobKey(id, band));
    if (job && (job.status === 'queued' || missing.every((c) => job.contexts.includes(c)))) continue;
    await queueExampleJob(id, { priority: recent.has(id) ? JOB_PRIORITY.recent : JOB_PRIORITY.backfill, contexts: wanted, band }, now);
    queued++;
  }
  return queued;
}

/** How far the preparation is (Settings: "Tüm kartlarım için hazırla"). */
export interface ExamplePrepStatus {
  /** Live senses with a lexicon sense. */
  senses: number;
  /** Of those, senses with a sentence in every selected context (or asked for them already). */
  ready: number;
  queued: number;
  failed: number;
  backfill: boolean;
}

export async function getExamplePrepStatus(now: Millis = Date.now()): Promise<ExamplePrepStatus> {
  const settings = await getSettings(now);
  const band = bandFor(settings);
  const wanted = selectedContexts(settings);
  const ids = [
    ...new Set(
      (await db.senses.toArray()).filter((s) => s.deleted_at === null && s.lexicon_sense_id).map((s) => s.lexicon_sense_id!),
    ),
  ];
  const cached = await cachedExamples(ids);
  const jobs = new Map((await db.example_jobs.toArray()).map((j) => [j.key, j]));
  let ready = 0;
  let queued = 0;
  let failed = 0;
  for (const id of ids) {
    const job = jobs.get(jobKey(id, band));
    const missing = contextsWithoutSentences(cached.get(id), band, wanted);
    if (missing.length === 0 || (job?.status === 'done' && missing.every((c) => job.contexts.includes(c)))) ready++;
    else if (job?.status === 'queued') queued++;
    else if (job?.status === 'failed') failed++;
  }
  return { senses: ids.length, ready, queued, failed, backfill: (await getMeta<boolean>(EXAMPLES_BACKFILL_KEY)) === true };
}

/** "Tüm kartlarım için hazırla": queue every sense; the daily cap spreads it over days. */
export async function startExampleBackfill(now: Millis = Date.now()): Promise<number> {
  await db.transaction('rw', db.meta, () => setMeta(EXAMPLES_BACKFILL_KEY, true));
  return reconcileExampleJobs(now);
}

/** Due jobs, highest priority first, newest first within a priority. */
export async function dueExampleJobs(now: Millis = Date.now()): Promise<ExampleJob[]> {
  const jobs = await db.example_jobs.where('status').equals('queued').toArray();
  return jobs
    .filter((j) => j.next_attempt_at <= now)
    .sort((a, b) => b.priority - a.priority || b.created_at - a.created_at || (a.key < b.key ? -1 : 1));
}

export async function finishExampleJobs(
  keys: string[],
  patch: Pick<ExampleJob, 'status'> & Partial<Pick<ExampleJob, 'next_attempt_at' | 'error'>>,
  now: Millis = Date.now(),
): Promise<void> {
  await db.transaction('rw', db.example_jobs, async () => {
    for (const key of keys) {
      const job = await db.example_jobs.get(key);
      if (!job) continue;
      await db.example_jobs.put({
        ...job,
        ...patch,
        attempts: job.attempts + 1,
        error: patch.error ?? null,
        updated_at: now,
      });
    }
  });
}

/** Background calls made today on this device (the soft daily cap). */
export async function exampleCallsToday(now: Millis = Date.now()): Promise<number> {
  const day = dayKeyOf(now, dayConfig(await getSettings(now)));
  return (await getMeta<number>(exampleCallsKey(day))) ?? 0;
}

export async function countExampleCall(now: Millis = Date.now()): Promise<void> {
  const day = dayKeyOf(now, dayConfig(await getSettings(now)));
  await db.transaction('rw', db.meta, async () => {
    await setMeta(exampleCallsKey(day), ((await getMeta<number>(exampleCallsKey(day))) ?? 0) + 1);
  });
}
