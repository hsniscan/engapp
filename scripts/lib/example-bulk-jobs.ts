// The bulk example job (decision 0074), with its dependencies passed in so tests run it
// against fakes. CLI: scripts/examples-bulk.ts; workflow: .github/workflows/examples-bulk.yml.
//
// Goal: TARGET_PER_SENSE shared example sentences (lexicon_examples) for every live sense of
// the Kelime Bankası, in the default contexts, at the word's level band.
//
//   match     (free) Tatoeba pairs that contain the word and fit its level become candidates.
//   tag       (Haiku batch) each row's candidates: which meaning, natural or not, context.
//             The best good pairs a sense needs are kept; other good ones wait as spares.
//   generate  (Haiku batch) only what Tatoeba could not fill (spares are used first).
//   review    (Sonnet batch) every kept sentence, before it ships: natural Turkish, this
//             meaning, the level. Fixes the Turkish; rejects what a small fix cannot save.
//   publish   (free) approved sentences go into lexicon_examples (lexicon_examples_insert),
//             where devices pull them and the pronunciation job voices them.
//
// Every model step is a Message Batch whose upper-bound cost is reserved on the shared monthly
// Claude budget (image_budget, purpose 'wordbank') and must also fit the job's own cap
// (EXAMPLES_BULK_CAP_USD, default 15 USD, counted over all its batches ever). Idempotent and
// resumable: what a batch is working on is recorded before it is sent, and `collect` reads it.

import { createHash } from 'node:crypto';
import { levelBand } from '../../supabase/functions/_shared/examples-contracts.ts';
import {
  callCostUsd,
  reserveUsd,
  roundUsd,
  tokenBound,
} from '../../supabase/functions/_shared/image-models.ts';
import type { CalledMessage } from '../../supabase/functions/_shared/image-pipeline.ts';
import { exampleTextKey } from '../../supabase/functions/_shared/sentences.ts';
import { exampleSpan } from '../../supabase/functions/_shared/wordbank-contract.ts';
import {
  BULK_CONTEXTS,
  buildGenRequest,
  buildReviewRequest,
  buildTagRequest,
  GEN_MAX_TOKENS,
  GEN_PROMPT_VERSION,
  GEN_SYSTEM_PROMPT,
  genUserContent,
  parseGenAnswer,
  parseReviewAnswer,
  parseTagAnswer,
  REVIEW_GROUP_SIZE,
  REVIEW_MAX_TOKENS,
  REVIEW_PROMPT_VERSION,
  REVIEW_SYSTEM_PROMPT,
  reviewUserContent,
  TAG_MAX_TOKENS,
  TAG_PROMPT_VERSION,
  TAG_SYSTEM_PROMPT,
  tagUserContent,
  type GenInput,
  type ReviewItemInput,
  type TagInput,
} from './example-bulk-prompt.ts';
import { matchRow, type LevelIndex, type PairIndex } from './example-match.ts';
import type { BatchApi, BatchResult, Log } from './image-jobs.ts';
import { attributionOf, type TatoebaAttribution } from './tatoeba.ts';

/** Shared sentences wanted per bank sense (the card's own sentence comes on top). */
export const TARGET_PER_SENSE = 3;
/** Tatoeba candidates sent for tagging per bank row, at most. */
export const MAX_CANDIDATES = 8;
/** Model attempts per row and step before the row is given up. */
export const MAX_ATTEMPTS = 3;
/** A sense with this many rejected sentences gets no more generated ones. */
export const MAX_REJECTED_PER_SENSE = 4;

/** EXAMPLES_BULK_CAP_USD: the job's own cap over all its batches (default 15 USD, max 200). */
export function jobCapUsd(env: (key: string) => string | undefined): number {
  const raw = env('EXAMPLES_BULK_CAP_USD')?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 200 ? n : 15;
}

// ---------------------------------------------------------------------------
// data shapes
// ---------------------------------------------------------------------------

/** A live bank row with its senses and the shared sentences they already have. */
export interface TargetRow {
  lemma_norm: string;
  pos: string;
  lemma: string;
  cefr: string;
  senses: { sense_id: string; meaning_tr: string; example_en: string }[];
  /** sense_id → active lexicon_examples texts. */
  active: Record<string, string[]>;
}

export type ItemState =
  | 'candidate'
  | 'tag_sent'
  | 'spare'
  | 'dropped'
  | 'kept'
  | 'review_sent'
  | 'approved'
  | 'rejected'
  | 'published';

/** One example_bulk_items row (text_key and timestamps are the database's). */
export interface ItemRow {
  id: string;
  lemma_norm: string;
  pos: string;
  sense_id: string | null;
  state: ItemState;
  source: 'tatoeba' | 'model';
  context: string | null;
  level_band: string | null;
  text_en: string;
  text_tr: string | null;
  attribution: TatoebaAttribution | null;
  score: number;
  model: string | null;
  prompt_version: string | null;
  review_batch_id: string | null;
  review_custom_id: string | null;
  review_attempts: number;
  review_note: string | null;
  example_id: string | null;
}

export type NewItem = Omit<ItemRow, 'id'>;

/** One example_bulk_rows row. Its existence means the row was matched against Tatoeba. */
export interface BulkRow {
  lemma_norm: string;
  pos: string;
  tag_batch_id: string | null;
  tag_custom_id: string | null;
  tag_attempts: number;
  gen_batch_id: string | null;
  gen_custom_id: string | null;
  gen_attempts: number;
  gen_input: GenInput | null;
  last_error: string | null;
}

export interface BulkBatch {
  id: string;
  step: 'tag' | 'generate' | 'review';
  hold_id: string | null;
  reserved_usd: number;
  requests: number;
  model: string;
  prompt_version: string;
  state: 'submitted' | 'collected';
  cost_usd: number | null;
}

/** sense_id → state → count (example_bulk_sense_counts). */
export type SenseCounts = Map<string, Partial<Record<ItemState, number>>>;

/** An approved sentence in the shape of lexicon_examples_insert. */
export interface ExampleInsert {
  sense_id: string;
  context: string;
  level_band: string;
  text_en: string;
  span: [number, number];
  translations: { tr: string };
  model: string | null;
  prompt_version: string;
  source: 'tatoeba' | null;
  attribution: TatoebaAttribution | null;
}

/** What the job needs from the database (SupabaseExampleBulkStore implements it). */
export interface ExampleBulkStore {
  targets(): Promise<TargetRow[]>;
  senseCounts(): Promise<SenseCounts>;
  rows(): Promise<BulkRow[]>;
  upsertRows(rows: BulkRow[]): Promise<void>;
  /** Items in these states (all pages), optionally only those of one review batch. */
  items(states: readonly ItemState[], opts?: { reviewBatch?: string }): Promise<ItemRow[]>;
  /** Inserts new items; a sentence the row already has is skipped. Returns how many were new. */
  insertItems(items: NewItem[]): Promise<number>;
  /** Saves whole items; returns the ids that could not be saved (a duplicate sentence). */
  saveItems(items: ItemRow[]): Promise<string[]>;
  insertBatch(b: BulkBatch): Promise<void>;
  openBatches(): Promise<BulkBatch[]>;
  closeBatch(id: string, costUsd: number): Promise<void>;
  /** lexicon_examples_insert; returns the rows actually inserted. */
  publish(items: ExampleInsert[]): Promise<{ id: string; sense_id: string; text_en: string }[]>;
  reserve(amountUsd: number, capUsd: number): Promise<string | null>;
  settle(holdId: string, actualUsd: number): Promise<void>;
  /** Settled costs plus open reservations of all the job's batches (example_bulk_spent). */
  spent(): Promise<number>;
}

export interface ExampleBulkDeps {
  store: ExampleBulkStore;
  batches: BatchApi;
  /** Tagging and generation (Haiku by default). */
  model: string;
  /** The review (Sonnet by default). */
  reviewModel: string;
  /** Shared monthly Claude cap (image_budget). */
  capUsd: number;
  /** The job's own cap over all its batches. */
  jobCapUsd: number;
  log: Log;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const keyOf = (x: { lemma_norm: string; pos: string }) => `${x.lemma_norm}|${x.pos}`;
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 40);
export const tagCustomId = (r: { lemma_norm: string; pos: string }, attempt: number) =>
  `ext_${hash(`${keyOf(r)}|${attempt}`)}`;
export const genCustomId = (r: { lemma_norm: string; pos: string }, attempt: number) =>
  `exg_${hash(`${keyOf(r)}|${attempt}`)}`;
export const reviewCustomId = (ids: readonly string[]) => `exr_${hash(ids.join('|'))}`;

const chunks = <T>(xs: readonly T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/** Order of a row's candidates in its tagging request (the same at submit and collect). */
const candidateOrder = (a: ItemRow, b: ItemRow) =>
  a.score - b.score || (a.text_en < b.text_en ? -1 : a.text_en > b.text_en ? 1 : 0);
const idOrder = (a: ItemRow, b: ItemRow) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Sentences still wanted for a sense: the target minus what it has and what is on the way. */
export function senseNeed(
  active: number,
  counts: Partial<Record<ItemState, number>> | undefined,
): number {
  const c = counts ?? {};
  const inflight = (c.kept ?? 0) + (c.review_sent ?? 0) + (c.approved ?? 0);
  return Math.max(0, TARGET_PER_SENSE - active - inflight);
}

const bump = (counts: SenseCounts, senseId: string, state: ItemState, by = 1) => {
  const c = counts.get(senseId) ?? {};
  c[state] = (c[state] ?? 0) + by;
  counts.set(senseId, c);
};

const emptyRow = (t: { lemma_norm: string; pos: string }): BulkRow => ({
  lemma_norm: t.lemma_norm,
  pos: t.pos,
  tag_batch_id: null,
  tag_custom_id: null,
  tag_attempts: 0,
  gen_batch_id: null,
  gen_custom_id: null,
  gen_attempts: 0,
  gen_input: null,
  last_error: null,
});

/** Expected cost: system prompt read from the cache, the user turn and the expected output. */
function expectedUsd(model: string, system: string, user: string, outputTokens: number): number {
  return callCostUsd(
    model,
    {
      input_tokens: Math.ceil(user.length / 3.5),
      cache_read_input_tokens: Math.ceil(system.length / 3.5),
      output_tokens: outputTokens,
    },
    { batch: true },
  );
}

const boundUsd = (model: string, system: string, user: string, maxTokens: number) =>
  reserveUsd(model, { inputTokens: tokenBound(system + user), maxTokens, batch: true });

interface PlannedRequest<T> {
  custom_id: string;
  params: ReturnType<typeof buildTagRequest>;
  bound: number;
  expected: number;
  what: T;
}

export interface SubmitReport {
  step: 'tag' | 'generate' | 'review';
  ready: number;
  submitted: number;
  batchId: string | null;
  reservedUsd: number;
  estimatedUsd: number;
  stopped: 'done' | 'empty' | 'budget' | 'cap' | 'dry_run';
}

/**
 * Sends one Message Batch of `reqs` (at most `max`), after reserving its upper bound on both
 * caps; halves it until it fits. `record` runs once the batch exists, before anything else.
 */
async function sendBatch<T>(
  deps: ExampleBulkDeps,
  step: SubmitReport['step'],
  model: string,
  promptVersion: string,
  reqs: PlannedRequest<T>[],
  opts: { max: number; dryRun?: boolean },
  record: (batchId: string, picked: PlannedRequest<T>[]) => Promise<void>,
): Promise<SubmitReport> {
  const report: SubmitReport = {
    step,
    ready: reqs.length,
    submitted: 0,
    batchId: null,
    reservedUsd: 0,
    estimatedUsd: 0,
    stopped: reqs.length === 0 ? 'empty' : 'done',
  };
  let picked = reqs.slice(0, opts.max);
  if (picked.length === 0) return report;
  const sum = (xs: PlannedRequest<T>[], k: 'bound' | 'expected') =>
    roundUsd(
      xs.reduce((s, r) => s + r[k], 0),
      'up',
    );
  if (opts.dryRun) {
    report.submitted = picked.length;
    report.reservedUsd = sum(picked, 'bound');
    report.estimatedUsd = sum(picked, 'expected');
    report.stopped = 'dry_run';
    return report;
  }
  const spent = await deps.store.spent();
  let hold: string | null = null;
  let amount = 0;
  while (picked.length > 0) {
    amount = sum(picked, 'bound');
    if (spent + amount > deps.jobCapUsd) {
      report.stopped = 'cap';
    } else {
      hold = await deps.store.reserve(amount, deps.capUsd);
      if (hold) break;
      report.stopped = 'budget';
    }
    picked = picked.slice(0, Math.floor(picked.length / 2));
  }
  if (picked.length === 0 || !hold) return report;
  let batch: { id: string };
  try {
    batch = await deps.batches.create(picked.map((r) => ({ custom_id: r.custom_id, params: r.params })));
  } catch (e) {
    await deps.store.settle(hold, 0);
    throw e;
  }
  await deps.store.insertBatch({
    id: batch.id,
    step,
    hold_id: hold,
    reserved_usd: amount,
    requests: picked.length,
    model,
    prompt_version: promptVersion,
    state: 'submitted',
    cost_usd: null,
  });
  await record(batch.id, picked);
  report.submitted = picked.length;
  report.batchId = batch.id;
  report.reservedUsd = amount;
  report.estimatedUsd = sum(picked, 'expected');
  deps.log('example batch submitted', {
    step,
    batch_id: batch.id,
    requests: picked.length,
    reserved_usd: amount,
    estimated_usd: report.estimatedUsd,
  });
  return report;
}

/** Everything the steps read about the bank and the job's state. */
interface Snapshot {
  targets: TargetRow[];
  byKey: Map<string, TargetRow>;
  /** sense_id → its row and meaning. */
  senses: Map<string, { row: TargetRow; meaning_tr: string }>;
  counts: SenseCounts;
  rows: Map<string, BulkRow>;
}

async function snapshot(store: ExampleBulkStore): Promise<Snapshot> {
  const [targets, counts, rows] = await Promise.all([
    store.targets(),
    store.senseCounts(),
    store.rows(),
  ]);
  const senses = new Map<string, { row: TargetRow; meaning_tr: string }>();
  for (const t of targets) for (const s of t.senses) senses.set(s.sense_id, { row: t, meaning_tr: s.meaning_tr });
  return {
    targets,
    byKey: new Map(targets.map((t) => [keyOf(t), t])),
    senses,
    counts,
    rows: new Map(rows.map((r) => [keyOf(r), r])),
  };
}

const needOf = (snap: Snapshot, t: TargetRow, senseId: string) =>
  senseNeed(t.active[senseId]?.length ?? 0, snap.counts.get(senseId));

// ---------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------

export interface PlanReport {
  bankRows: number;
  senses: number;
  sensesComplete: number;
  sentencesWanted: number;
  rowsMatched: number;
  items: Partial<Record<ItemState, number>>;
  /** Rough cost of what is left, by step (USD). */
  estimate: { tag: number; generate: number; review: number; total: number };
  spentUsd: number;
  jobCapUsd: number;
}

/** Counts and a rough estimate of what is left; reads only. */
export async function runPlan(
  deps: Pick<ExampleBulkDeps, 'store' | 'model' | 'reviewModel' | 'jobCapUsd'>,
): Promise<PlanReport> {
  const snap = await snapshot(deps.store);
  const items: Partial<Record<ItemState, number>> = {};
  for (const c of snap.counts.values())
    for (const [state, n] of Object.entries(c)) items[state as ItemState] = (items[state as ItemState] ?? 0) + (n ?? 0);
  const candidates = await deps.store.items(['candidate']);
  items.candidate = candidates.length;
  let senses = 0;
  let complete = 0;
  let wanted = 0;
  for (const t of snap.targets)
    for (const s of t.senses) {
      senses++;
      const need = needOf(snap, t, s.sense_id);
      if (need === 0) complete++;
      wanted += need;
    }
  // Per request: tag ~1 per row with candidates; generation fills about half of what is wanted
  // when Tatoeba has not been matched yet; every kept or wanted sentence is reviewed.
  const rowsWithCandidates = new Set(candidates.map(keyOf)).size;
  const tagOne = expectedUsd(deps.model, TAG_SYSTEM_PROMPT, 'x'.repeat(900), 250);
  const genOne = expectedUsd(deps.model, GEN_SYSTEM_PROMPT, 'x'.repeat(500), 400);
  const reviewOne = expectedUsd(deps.reviewModel, REVIEW_SYSTEM_PROMPT, 'x'.repeat(3600), 200);
  const genRows = snap.targets.filter((t) => t.senses.some((s) => needOf(snap, t, s.sense_id) > 0)).length;
  const toReview = wanted + (items.kept ?? 0);
  const estimate = {
    tag: roundUsd(rowsWithCandidates * tagOne, 'up'),
    generate: roundUsd(genRows * genOne, 'up'),
    review: roundUsd(Math.ceil(toReview / REVIEW_GROUP_SIZE) * reviewOne, 'up'),
    total: 0,
  };
  estimate.total = roundUsd(estimate.tag + estimate.generate + estimate.review, 'up');
  return {
    bankRows: snap.targets.length,
    senses,
    sensesComplete: complete,
    sentencesWanted: wanted,
    rowsMatched: snap.rows.size,
    items,
    estimate,
    spentUsd: await deps.store.spent(),
    jobCapUsd: deps.jobCapUsd,
  };
}

// ---------------------------------------------------------------------------
// match (free)
// ---------------------------------------------------------------------------

export interface MatchReport {
  rows: number;
  rowsWithPairs: number;
  pairs: number;
  stored: number;
}

/**
 * Tatoeba candidates for every bank row not matched yet whose senses still need sentences.
 * Idempotent: a matched row is skipped (its example_bulk_rows row exists); `rematch` matches
 * every row again (a sentence a row already has is skipped by the database).
 */
export async function runMatch(
  deps: Pick<ExampleBulkDeps, 'store' | 'log'>,
  pairs: PairIndex,
  levels: LevelIndex,
  opts: { rematch?: boolean; dryRun?: boolean } = {},
): Promise<MatchReport> {
  const snap = await snapshot(deps.store);
  const report: MatchReport = { rows: 0, rowsWithPairs: 0, pairs: 0, stored: 0 };
  const newItems: NewItem[] = [];
  const marked: BulkRow[] = [];
  for (const t of snap.targets) {
    if (!opts.rematch && snap.rows.has(keyOf(t))) continue;
    const needing = t.senses.filter((s) => needOf(snap, t, s.sense_id) > 0).length;
    if (needing === 0) continue;
    report.rows++;
    const avoid = new Set(
      [...t.senses.map((s) => s.example_en), ...Object.values(t.active).flat()].map(exampleTextKey),
    );
    const found = matchRow(pairs, levels, t, {
      want: Math.min(MAX_CANDIDATES, 2 + 2 * needing),
      avoid,
    });
    if (found.length > 0) report.rowsWithPairs++;
    report.pairs += found.length;
    for (const m of found)
      newItems.push({
        lemma_norm: t.lemma_norm,
        pos: t.pos,
        sense_id: null,
        state: 'candidate',
        source: 'tatoeba',
        context: null,
        level_band: levelBand(t.cefr as Parameters<typeof levelBand>[0]),
        text_en: m.pair.en,
        text_tr: m.pair.tr,
        attribution: attributionOf(m.pair),
        score: m.score,
        model: null,
        prompt_version: null,
        review_batch_id: null,
        review_custom_id: null,
        review_attempts: 0,
        review_note: null,
        example_id: null,
      });
    marked.push(snap.rows.get(keyOf(t)) ?? emptyRow(t));
  }
  if (opts.dryRun) return report;
  for (const part of chunks(newItems, 500)) report.stored += await deps.store.insertItems(part);
  for (const part of chunks(marked, 500)) await deps.store.upsertRows(part);
  deps.log('example match stored', { ...report });
  return report;
}

// ---------------------------------------------------------------------------
// tag
// ---------------------------------------------------------------------------

export async function runTagSubmit(
  deps: ExampleBulkDeps,
  opts: { max: number; dryRun?: boolean },
): Promise<SubmitReport> {
  const snap = await snapshot(deps.store);
  const byRow = new Map<string, ItemRow[]>();
  for (const it of await deps.store.items(['candidate'])) {
    const list = byRow.get(keyOf(it));
    if (list) list.push(it);
    else byRow.set(keyOf(it), [it]);
  }
  const reqs: PlannedRequest<{ row: BulkRow; items: ItemRow[] }>[] = [];
  for (const [key, list] of byRow) {
    const t = snap.byKey.get(key);
    const row = snap.rows.get(key) ?? (t ? emptyRow(t) : null);
    if (!t || !row || row.tag_batch_id || t.senses.length === 0) continue;
    const items = [...list].sort(candidateOrder).slice(0, MAX_CANDIDATES);
    const x: TagInput = {
      lemma_norm: t.lemma_norm,
      pos: t.pos,
      cefr: t.cefr,
      senses: t.senses,
      candidates: items.map((i) => ({ en: i.text_en, tr: i.text_tr ?? '' })),
    };
    const user = tagUserContent(x);
    reqs.push({
      custom_id: tagCustomId(t, row.tag_attempts),
      params: buildTagRequest(x, { model: deps.model }),
      bound: boundUsd(deps.model, TAG_SYSTEM_PROMPT, user, TAG_MAX_TOKENS),
      expected: expectedUsd(deps.model, TAG_SYSTEM_PROMPT, user, 150 + 12 * items.length),
      what: { row, items },
    });
  }
  return sendBatch(deps, 'tag', deps.model, TAG_PROMPT_VERSION, reqs, opts, async (batchId, picked) => {
    const items = picked.flatMap((p) => p.what.items.map((i) => ({ ...i, state: 'tag_sent' as const })));
    for (const part of chunks(items, 500)) await deps.store.saveItems(part);
    await deps.store.upsertRows(
      picked.map((p) => ({ ...p.what.row, tag_batch_id: batchId, tag_custom_id: p.custom_id })),
    );
  });
}

// ---------------------------------------------------------------------------
// generate
// ---------------------------------------------------------------------------

/** Contexts for the next `count` sentences of a sense, continuing the default rotation. */
export function nextContexts(have: number, count: number): string[] {
  return Array.from({ length: count }, (_, k) => BULK_CONTEXTS[(have + k) % BULK_CONTEXTS.length]!);
}

export interface GenerateReport extends SubmitReport {
  promoted: number;
}

export async function runGenerateSubmit(
  deps: ExampleBulkDeps,
  opts: { max: number; dryRun?: boolean; withoutMatch?: boolean },
): Promise<GenerateReport> {
  const snap = await snapshot(deps.store);
  // Rows whose Tatoeba candidates are still being sorted wait for that step.
  const waiting = new Set((await deps.store.items(['candidate', 'tag_sent'])).map(keyOf));
  const inflight = await deps.store.items(['kept', 'review_sent', 'approved']);
  const textsOf = new Map<string, string[]>();
  for (const it of inflight)
    if (it.sense_id) textsOf.set(it.sense_id, [...(textsOf.get(it.sense_id) ?? []), it.text_en]);

  // 1. Spare Tatoeba pairs first: free.
  const promote: ItemRow[] = [];
  const spares = (await deps.store.items(['spare'])).sort(candidateOrder);
  for (const sp of spares) {
    if (!sp.sense_id) continue;
    const t = snap.byKey.get(keyOf(sp));
    if (!t || needOf(snap, t, sp.sense_id) === 0) continue;
    promote.push({ ...sp, state: 'kept' });
    bump(snap.counts, sp.sense_id, 'kept');
    textsOf.set(sp.sense_id, [...(textsOf.get(sp.sense_id) ?? []), sp.text_en]);
  }
  if (!opts.dryRun) for (const part of chunks(promote, 500)) await deps.store.saveItems(part);

  // 2. The rest from the model.
  const reqs: PlannedRequest<{ row: BulkRow; input: GenInput }>[] = [];
  for (const t of snap.targets) {
    const key = keyOf(t);
    const row = snap.rows.get(key) ?? (opts.withoutMatch ? emptyRow(t) : null);
    if (!row || row.gen_batch_id || row.gen_attempts >= MAX_ATTEMPTS || waiting.has(key)) continue;
    const senses = t.senses
      .map((s) => {
        const have = (t.active[s.sense_id]?.length ?? 0) + (textsOf.get(s.sense_id)?.length ?? 0);
        const count = needOf(snap, t, s.sense_id);
        const rejected = snap.counts.get(s.sense_id)?.rejected ?? 0;
        return {
          sense_id: s.sense_id,
          meaning_tr: s.meaning_tr,
          count: rejected >= MAX_REJECTED_PER_SENSE ? 0 : count,
          contexts: nextContexts(have, count),
          avoid: [s.example_en, ...(t.active[s.sense_id] ?? []), ...(textsOf.get(s.sense_id) ?? [])],
        };
      })
      .filter((s) => s.count > 0);
    if (senses.length === 0) continue;
    const input: GenInput = { lemma_norm: t.lemma_norm, pos: t.pos, cefr: t.cefr, senses };
    const user = genUserContent(input);
    const n = senses.reduce((s, x) => s + x.count, 0);
    reqs.push({
      custom_id: genCustomId(t, row.gen_attempts),
      params: buildGenRequest(input, { model: deps.model }),
      bound: boundUsd(deps.model, GEN_SYSTEM_PROMPT, user, GEN_MAX_TOKENS),
      expected: expectedUsd(deps.model, GEN_SYSTEM_PROMPT, user, 150 + 70 * n),
      what: { row, input },
    });
  }
  const report = await sendBatch(
    deps,
    'generate',
    deps.model,
    GEN_PROMPT_VERSION,
    reqs,
    opts,
    async (batchId, picked) => {
      await deps.store.upsertRows(
        picked.map((p) => ({
          ...p.what.row,
          gen_batch_id: batchId,
          gen_custom_id: p.custom_id,
          gen_input: p.what.input,
        })),
      );
    },
  );
  return { ...report, promoted: promote.length };
}

// ---------------------------------------------------------------------------
// review
// ---------------------------------------------------------------------------

function reviewInput(it: ItemRow, snap: Snapshot): ReviewItemInput | null {
  const s = it.sense_id ? snap.senses.get(it.sense_id) : undefined;
  if (!s || !it.text_tr) return null;
  return {
    lemma_norm: it.lemma_norm,
    pos: it.pos,
    cefr: s.row.cefr,
    meaning_tr: s.meaning_tr,
    en: it.text_en,
    tr: it.text_tr,
    fixedEnglish: it.source === 'tatoeba',
  };
}

export async function runReviewSubmit(
  deps: ExampleBulkDeps,
  opts: { max: number; dryRun?: boolean },
): Promise<SubmitReport> {
  const snap = await snapshot(deps.store);
  const kept = (await deps.store.items(['kept'])).sort(
    (a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : idOrder(a, b)),
  );
  const orphans: ItemRow[] = [];
  const ready: { item: ItemRow; input: ReviewItemInput }[] = [];
  for (const it of kept) {
    const input = reviewInput(it, snap);
    if (input) ready.push({ item: it, input });
    else orphans.push({ ...it, state: 'dropped', review_note: 'sense gone' });
  }
  if (!opts.dryRun) for (const part of chunks(orphans, 500)) await deps.store.saveItems(part);
  const reqs: PlannedRequest<ItemRow[]>[] = chunks(ready, REVIEW_GROUP_SIZE).map((group) => {
    const sorted = [...group].sort((a, b) => idOrder(a.item, b.item));
    const inputs = sorted.map((g) => g.input);
    const user = reviewUserContent(inputs);
    return {
      custom_id: reviewCustomId(sorted.map((g) => g.item.id)),
      params: buildReviewRequest(inputs, { model: deps.reviewModel }),
      bound: boundUsd(deps.reviewModel, REVIEW_SYSTEM_PROMPT, user, REVIEW_MAX_TOKENS),
      expected: expectedUsd(deps.reviewModel, REVIEW_SYSTEM_PROMPT, user, 40 + 10 * inputs.length),
      what: sorted.map((g) => g.item),
    };
  });
  return sendBatch(
    deps,
    'review',
    deps.reviewModel,
    REVIEW_PROMPT_VERSION,
    reqs,
    opts,
    async (batchId, picked) => {
      const items = picked.flatMap((p) =>
        p.what.map((i) => ({
          ...i,
          state: 'review_sent' as const,
          review_batch_id: batchId,
          review_custom_id: p.custom_id,
        })),
      );
      for (const part of chunks(items, 500)) await deps.store.saveItems(part);
    },
  );
}

// ---------------------------------------------------------------------------
// collect (every step)
// ---------------------------------------------------------------------------

export interface CollectReport {
  batches: { id: string; step: string; status: string }[];
  costUsd: number;
  tag: { rows: number; kept: number; spare: number; dropped: number; retried: number };
  generate: { rows: number; stored: number; dropped: number; retried: number };
  review: { items: number; approved: number; fixed: number; rejected: number; retried: number };
  problems: Record<string, number>;
  /** Up to 30 review changes, for the log. */
  samples: { lemma: string; kind: string; old: string; new: string; reason: string }[];
}

type Msg = CalledMessage;

async function* succeeded(
  deps: ExampleBulkDeps,
  b: BulkBatch,
  onFailed: (customId: string, why: string) => void,
): AsyncGenerator<{ custom_id: string; message: Msg; cost: number }> {
  for await (const res of (await deps.batches.results(b.id)) as AsyncIterable<BatchResult>) {
    if (res.result.type !== 'succeeded') {
      onFailed(res.custom_id, `batch ${res.result.type}`);
      continue;
    }
    const message = res.result.message as unknown as Msg;
    yield {
      custom_id: res.custom_id,
      message,
      cost: callCostUsd(message.model ?? b.model, message.usage, { batch: true }),
    };
  }
}

async function collectTag(
  deps: ExampleBulkDeps,
  b: BulkBatch,
  snap: Snapshot,
  report: CollectReport,
  problem: (p: string) => void,
): Promise<number> {
  const rows = [...snap.rows.values()].filter((r) => r.tag_batch_id === b.id);
  const byCustom = new Map(rows.map((r) => [r.tag_custom_id ?? '', r]));
  const sent = await deps.store.items(['tag_sent']);
  const itemsOf = new Map<string, ItemRow[]>();
  for (const it of sent) itemsOf.set(keyOf(it), [...(itemsOf.get(keyOf(it)) ?? []), it]);
  let cost = 0;
  const save: ItemRow[] = [];
  const done = new Set<string>();
  const retry = (r: BulkRow, why: string) => {
    const attempt = r.tag_attempts + 1;
    const giveUp = attempt >= MAX_ATTEMPTS;
    const list = itemsOf.get(keyOf(r)) ?? [];
    save.push(...list.map((i) => ({ ...i, state: giveUp ? ('dropped' as const) : ('candidate' as const) })));
    snap.rows.set(keyOf(r), { ...r, tag_batch_id: null, tag_custom_id: null, tag_attempts: attempt, last_error: why });
    report.tag.retried++;
  };
  for await (const res of succeeded(deps, b, (cid, why) => {
    const r = byCustom.get(cid);
    if (r && !done.has(cid)) {
      done.add(cid);
      retry({ ...r, tag_attempts: r.tag_attempts - 1 }, why); // not billed: no attempt counted
    }
  })) {
    const r = byCustom.get(res.custom_id);
    if (!r || done.has(res.custom_id)) continue;
    done.add(res.custom_id);
    cost += res.cost;
    const t = snap.byKey.get(keyOf(r));
    const list = [...(itemsOf.get(keyOf(r)) ?? [])].sort(candidateOrder);
    if (!t) {
      save.push(...list.map((i) => ({ ...i, state: 'dropped' as const })));
      continue;
    }
    const parsed = parseTagAnswer(res.message, { senses: t.senses, candidates: list.map((i) => ({ en: i.text_en, tr: i.text_tr ?? '' })) });
    if (parsed.kind === 'invalid') {
      problem(`tag_${parsed.reason}`);
      retry(r, parsed.reason);
      continue;
    }
    report.tag.rows++;
    // Good pairs per sense, best first; each sense keeps what it still needs.
    const good = new Map<number, ItemRow[]>();
    list.forEach((it, k) => {
      const v = parsed.verdicts.get(k);
      if (!v || !v.ok || v.sense === null) {
        save.push({ ...it, state: 'dropped' });
        report.tag.dropped++;
        return;
      }
      const sense = t.senses[v.sense]!;
      const tagged = { ...it, sense_id: sense.sense_id, context: v.context, prompt_version: TAG_PROMPT_VERSION };
      good.set(v.sense, [...(good.get(v.sense) ?? []), tagged]);
    });
    for (const [k, items] of good) {
      const senseId = t.senses[k]!.sense_id;
      for (const it of items) {
        if (needOf(snap, t, senseId) > 0) {
          save.push({ ...it, state: 'kept' });
          bump(snap.counts, senseId, 'kept');
          report.tag.kept++;
        } else {
          save.push({ ...it, state: 'spare' });
          report.tag.spare++;
        }
      }
    }
    snap.rows.set(keyOf(r), { ...r, tag_batch_id: null, tag_custom_id: null, last_error: null });
  }
  // Requests the batch never answered: ask again.
  for (const r of rows) if (!done.has(r.tag_custom_id ?? '')) retry({ ...r, tag_attempts: r.tag_attempts - 1 }, 'missing from batch results');
  for (const part of chunks(save, 500)) await deps.store.saveItems(part);
  await deps.store.upsertRows(rows.map((r) => snap.rows.get(keyOf(r))!));
  return cost;
}

async function collectGenerate(
  deps: ExampleBulkDeps,
  b: BulkBatch,
  snap: Snapshot,
  report: CollectReport,
  problem: (p: string) => void,
): Promise<number> {
  const rows = [...snap.rows.values()].filter((r) => r.gen_batch_id === b.id);
  const byCustom = new Map(rows.map((r) => [r.gen_custom_id ?? '', r]));
  const done = new Set<string>();
  const fresh: NewItem[] = [];
  let cost = 0;
  const finish = (r: BulkRow, attempts: number, error: string | null) =>
    snap.rows.set(keyOf(r), {
      ...r,
      gen_batch_id: null,
      gen_custom_id: null,
      gen_input: null,
      gen_attempts: attempts,
      last_error: error,
    });
  for await (const res of succeeded(deps, b, (cid, why) => {
    const r = byCustom.get(cid);
    if (r && !done.has(cid)) {
      done.add(cid);
      finish(r, r.gen_attempts, why);
      report.generate.retried++;
    }
  })) {
    const r = byCustom.get(res.custom_id);
    if (!r || done.has(res.custom_id)) continue;
    done.add(res.custom_id);
    cost += res.cost;
    const input = r.gen_input;
    if (!input) {
      finish(r, r.gen_attempts + 1, 'no input');
      continue;
    }
    const parsed = parseGenAnswer(res.message, input);
    if (parsed.kind === 'invalid') {
      problem(`gen_${parsed.reason}`);
      finish(r, r.gen_attempts + 1, parsed.reason);
      report.generate.retried++;
      continue;
    }
    for (const d of parsed.dropped) problem(`gen_${d}`);
    report.generate.dropped += parsed.dropped.length;
    report.generate.rows++;
    for (const s of parsed.sentences)
      fresh.push({
        lemma_norm: r.lemma_norm,
        pos: r.pos,
        sense_id: s.sense_id,
        state: 'kept',
        source: 'model',
        context: s.context,
        level_band: levelBand(input.cefr as Parameters<typeof levelBand>[0]),
        text_en: s.en,
        text_tr: s.tr,
        attribution: null,
        score: 0,
        model: res.message.model ?? b.model,
        prompt_version: GEN_PROMPT_VERSION,
        review_batch_id: null,
        review_custom_id: null,
        review_attempts: 0,
        review_note: null,
        example_id: null,
      });
    finish(r, r.gen_attempts + 1, parsed.sentences.length === 0 ? 'no sentence passed' : null);
  }
  for (const r of rows)
    if (!done.has(r.gen_custom_id ?? '')) {
      finish(r, r.gen_attempts, 'missing from batch results');
      report.generate.retried++;
    }
  for (const part of chunks(fresh, 500)) report.generate.stored += await deps.store.insertItems(part);
  await deps.store.upsertRows(rows.map((r) => snap.rows.get(keyOf(r))!));
  return cost;
}

async function collectReview(
  deps: ExampleBulkDeps,
  b: BulkBatch,
  snap: Snapshot,
  report: CollectReport,
  problem: (p: string) => void,
): Promise<number> {
  const items = await deps.store.items(['review_sent'], { reviewBatch: b.id });
  const groups = new Map<string, ItemRow[]>();
  for (const it of items) groups.set(it.review_custom_id ?? '', [...(groups.get(it.review_custom_id ?? '') ?? []), it]);
  const done = new Set<string>();
  const save: ItemRow[] = [];
  let cost = 0;
  const retry = (list: ItemRow[], why: string, counts: boolean) => {
    for (const it of list) {
      const attempts = it.review_attempts + (counts ? 1 : 0);
      const giveUp = attempts >= MAX_ATTEMPTS;
      save.push({
        ...it,
        state: giveUp ? 'rejected' : 'kept',
        review_batch_id: null,
        review_custom_id: null,
        review_attempts: attempts,
        review_note: giveUp ? `review failed: ${why}`.slice(0, 200) : it.review_note,
      });
      report.review.retried++;
    }
  };
  for await (const res of succeeded(deps, b, (cid, why) => {
    const g = groups.get(cid);
    if (g && !done.has(cid)) {
      done.add(cid);
      retry(g, why, false);
    }
  })) {
    const group = groups.get(res.custom_id);
    if (!group || done.has(res.custom_id)) continue;
    done.add(res.custom_id);
    cost += res.cost;
    const sorted = [...group].sort(idOrder);
    const inputs = sorted.map((it) => reviewInput(it, snap));
    if (inputs.some((x) => x === null)) {
      // A sense left the bank meanwhile: those sentences are not published.
      sorted.forEach((it, k) => {
        if (!inputs[k]) save.push({ ...it, state: 'dropped', review_note: 'sense gone' });
      });
    }
    const live = sorted.filter((_, k) => inputs[k] !== null);
    const parsed = parseReviewAnswer(res.message, inputs.filter((x): x is ReviewItemInput => x !== null));
    if (parsed.kind === 'invalid') {
      problem(`review_${parsed.reason}`);
      retry(live, parsed.reason, true);
      continue;
    }
    live.forEach((it, k) => {
      const o = parsed.outcomes[k]!;
      const base = { ...it, review_batch_id: null, review_custom_id: null };
      report.review.items++;
      if (o.kind === 'approve') {
        save.push({ ...base, state: 'approved' });
        report.review.approved++;
      } else if (o.kind === 'reject') {
        save.push({ ...base, state: 'rejected', review_note: o.reason.slice(0, 200) });
        report.review.rejected++;
        if (report.samples.length < 30)
          report.samples.push({ lemma: it.lemma_norm, kind: 'reject', old: `${it.text_en} | ${it.text_tr}`, new: '', reason: o.reason });
      } else {
        save.push({
          ...base,
          state: 'approved',
          text_en: o.en,
          text_tr: o.tr,
          attribution: it.attribution && o.trEdited ? { ...it.attribution, tr_edited: true } : it.attribution,
          review_note: `fixed: ${o.reason}`.slice(0, 200),
        });
        report.review.fixed++;
        if (report.samples.length < 30)
          report.samples.push({ lemma: it.lemma_norm, kind: 'fix', old: `${it.text_en} | ${it.text_tr}`, new: `${o.en} | ${o.tr}`, reason: o.reason });
      }
    });
  }
  for (const [cid, g] of groups) if (!done.has(cid)) retry(g, 'missing from batch results', false);
  const original = new Map(items.map((i) => [i.id, i]));
  for (const part of chunks(save, 500)) {
    const failed = await deps.store.saveItems(part);
    // A fixed sentence that repeats another one of its row: rejected (as it was).
    if (failed.length > 0)
      await deps.store.saveItems(
        failed.map((id) => ({
          ...original.get(id)!,
          state: 'rejected',
          review_batch_id: null,
          review_custom_id: null,
          review_note: 'fix repeats another sentence',
        })),
      );
  }
  return cost;
}

/** Reads every finished batch of the job (any step), settles its cost and applies it. */
export async function runCollect(deps: ExampleBulkDeps): Promise<CollectReport> {
  const report: CollectReport = {
    batches: [],
    costUsd: 0,
    tag: { rows: 0, kept: 0, spare: 0, dropped: 0, retried: 0 },
    generate: { rows: 0, stored: 0, dropped: 0, retried: 0 },
    review: { items: 0, approved: 0, fixed: 0, rejected: 0, retried: 0 },
    problems: {},
    samples: [],
  };
  const problem = (p: string) => (report.problems[p] = (report.problems[p] ?? 0) + 1);
  const open = await deps.store.openBatches();
  if (open.length === 0) return report;
  let snap: Snapshot | null = null;
  for (const b of open) {
    const status = (await deps.batches.retrieve(b.id)).processing_status;
    report.batches.push({ id: b.id, step: b.step, status });
    if (status !== 'ended') continue;
    snap ??= await snapshot(deps.store);
    const cost =
      b.step === 'tag'
        ? await collectTag(deps, b, snap, report, problem)
        : b.step === 'generate'
          ? await collectGenerate(deps, b, snap, report, problem)
          : await collectReview(deps, b, snap, report, problem);
    if (b.hold_id) await deps.store.settle(b.hold_id, roundUsd(cost));
    await deps.store.closeBatch(b.id, roundUsd(cost));
    report.costUsd += cost;
    deps.log('example batch collected', { step: b.step, batch_id: b.id, cost_usd: roundUsd(cost) });
  }
  report.costUsd = roundUsd(report.costUsd);
  return report;
}

// ---------------------------------------------------------------------------
// publish (free)
// ---------------------------------------------------------------------------

export interface PublishReport {
  approved: number;
  published: number;
  duplicates: number;
  noSpan: number;
  over: number;
}

/**
 * Approved sentences into lexicon_examples, at most TARGET_PER_SENSE active ones per sense.
 * A sentence the sense already has is marked dropped; one that no longer contains the word is
 * rejected; one over the target waits as a spare.
 */
export async function runPublish(
  deps: Pick<ExampleBulkDeps, 'store' | 'log'>,
  opts: { dryRun?: boolean } = {},
): Promise<PublishReport> {
  const snap = await snapshot(deps.store);
  const approved = (await deps.store.items(['approved'])).sort(idOrder);
  const report: PublishReport = { approved: approved.length, published: 0, duplicates: 0, noSpan: 0, over: 0 };
  const room = new Map<string, number>();
  const ready: { item: ItemRow; insert: ExampleInsert }[] = [];
  const save: ItemRow[] = [];
  for (const it of approved) {
    const s = it.sense_id ? snap.senses.get(it.sense_id) : undefined;
    if (!s || !it.sense_id || !it.text_tr) {
      save.push({ ...it, state: 'dropped', review_note: 'sense gone' });
      continue;
    }
    const left = room.get(it.sense_id) ?? TARGET_PER_SENSE - (s.row.active[it.sense_id]?.length ?? 0);
    if (left <= 0) {
      save.push({ ...it, state: 'spare' });
      report.over++;
      continue;
    }
    const span = exampleSpan(it.text_en, s.row.lemma_norm);
    if (!span) {
      save.push({ ...it, state: 'rejected', review_note: 'word not found' });
      report.noSpan++;
      continue;
    }
    room.set(it.sense_id, left - 1);
    ready.push({
      item: it,
      insert: {
        sense_id: it.sense_id,
        context: it.context ?? 'daily',
        level_band: it.level_band ?? levelBand(s.row.cefr as Parameters<typeof levelBand>[0]),
        text_en: it.text_en,
        span,
        translations: { tr: it.text_tr },
        model: it.source === 'tatoeba' ? null : it.model,
        prompt_version: it.prompt_version ?? (it.source === 'tatoeba' ? TAG_PROMPT_VERSION : GEN_PROMPT_VERSION),
        source: it.source === 'tatoeba' ? 'tatoeba' : null,
        attribution: it.source === 'tatoeba' ? it.attribution : null,
      },
    });
  }
  if (opts.dryRun) {
    report.published = ready.length;
    return report;
  }
  for (const part of chunks(ready, 64)) {
    const rows = await deps.store.publish(part.map((p) => p.insert));
    const got = new Map(rows.map((r) => [`${r.sense_id}|${exampleTextKey(r.text_en)}`, r.id]));
    for (const p of part) {
      const id = got.get(`${p.insert.sense_id}|${exampleTextKey(p.insert.text_en)}`);
      if (id) {
        save.push({ ...p.item, state: 'published', example_id: id });
        report.published++;
      } else {
        save.push({ ...p.item, state: 'dropped', review_note: 'sense already has it' });
        report.duplicates++;
      }
    }
  }
  for (const part of chunks(save, 500)) await deps.store.saveItems(part);
  deps.log('examples published', { ...report });
  return report;
}
