// The word-bank job (decision 0038), with its dependencies passed in so tests run it against
// fakes. CLI: scripts/word-bank.ts; workflow: .github/workflows/word-bank.yml.
//
//   plan     counts what is left: words, how many the lexicon covers (no model call), how many
//            need the model, and the estimated cost. No writes, no model calls.
//   submit   words still without a bank row: rows the lexicon covers completely are stored at
//            once; the rest go out as one Message Batch (half price) after the whole batch's
//            upper-bound cost is reserved on the monthly Claude budget.
//   collect  reads finished batches: settles the real cost, checks every answer, stores new
//            meanings in the shared lexicon and the bank rows; a rejected answer is asked again
//            (at most WORDBANK_MAX_ATTEMPTS times), then the word is given up.
//
// Idempotent and resumable: a word with a bank row or a submitted request is never sent again;
// a crashed run leaves submitted requests that the next collect reads.

import { createHash } from 'node:crypto';
import {
  callCostUsd,
  reserveUsd,
  roundUsd,
  tokenBound,
} from '../../supabase/functions/_shared/image-models.ts';
import type { CalledMessage } from '../../supabase/functions/_shared/image-pipeline.ts';
import { isDuplicateSense } from '../../supabase/functions/_shared/text.ts';
import {
  WORDBANK_MAX_SENSES,
  type WordBankSense,
} from '../../supabase/functions/_shared/wordbank-contract.ts';
import {
  buildWordRequest,
  exampleProblem,
  parseWordAnswer,
  WORDBANK_MAX_TOKENS,
  WORDBANK_PROMPT_VERSION,
  WORDBANK_SYSTEM_PROMPT,
  type GivenSense,
  type WordInput,
} from './word-bank-prompt.ts';
import type { BatchApi, BatchResult, Log } from './image-jobs.ts';

export const WORDBANK_MAX_ATTEMPTS = 3;
/** Expected output tokens per word (thinking at effort low + the JSON), for the estimate. */
export const EXPECTED_OUTPUT_TOKENS = 700;

/** A list word without a bank row (public.word_bank_pending). */
export interface PendingWord {
  lemma_norm: string;
  pos: string;
  cefr: string;
  source: 'cefrj' | 'octanove';
  zipf: number | null;
  attempt: number;
  /** Why the previous answer was rejected (sent with the retry), or null. */
  problem: string | null;
}

/** A lexicon term with its senses (public.lexicon_find). */
export interface LexiconTermHit {
  term_id: string;
  lemma: string;
  lemma_norm: string;
  senses: { id: string; pos: string; meaning_tr: string }[];
}

/** An active shared example of a lexicon sense. */
export interface LexiconExampleHit {
  sense_id: string;
  level_band: string;
  text_en: string;
  text_tr: string | null;
}

/** A complete meaning: from the lexicon with its shared example, or a checked answer. */
type CompleteSense = WordBankSense;

/** What a submitted request needs at collect (word_bank_jobs.input). */
export interface JobInput {
  word: PendingWord;
  term_id: string | null;
  lemma: string | null;
  /** Lexicon meanings that already had an example. */
  complete: CompleteSense[];
  /** Lexicon meanings sent to the model for an example (empty: the model lists meanings). */
  given: GivenSense[];
}

export interface JobRow {
  lemma_norm: string;
  pos: string;
  state: 'queued' | 'submitted' | 'done' | 'failed';
  attempt: number;
  batch_id: string | null;
  custom_id: string | null;
  last_error: string | null;
  input: JobInput | null;
}

export interface BankRowOut {
  lemma_norm: string;
  pos: string;
  lemma: string;
  cefr: string;
  list_source: string;
  zipf: number | null;
  lexicon_term_id: string | null;
  senses: WordBankSense[];
  model: string | null;
  prompt_version: string;
  cost_usd: number;
}

export interface LexiconItem {
  lemma: string;
  lemma_norm: string;
  term_type: 'word' | 'phrase';
  pos: string;
  gloss_en: string;
  gloss_key: string;
  meaning_tr: string;
  ipa: null;
  model: string;
  zipf?: number | null;
  cefr: string;
  cefr_source: string;
  cefr_list: string;
}

export interface BatchRow {
  id: string;
  hold_id: string | null;
  reserved_usd: number;
  requests: number;
  model: string;
  prompt_version: string;
  state: 'submitted' | 'collected';
  cost_usd: number | null;
}

/** What the job needs from the database (SupabaseWordBankStore implements it). */
export interface WordBankStore {
  pending(limit: number): Promise<PendingWord[]>;
  lexiconFind(norms: string[]): Promise<LexiconTermHit[]>;
  lexiconExamples(senseIds: string[]): Promise<LexiconExampleHit[]>;
  /** lexicon_upsert: per item, in order. */
  lexiconUpsert(items: LexiconItem[]): Promise<{ term_id: string; sense_id: string | null }[]>;
  putRows(rows: BankRowOut[]): Promise<number>;
  upsertJobs(rows: JobRow[]): Promise<void>;
  jobsOfBatch(batchId: string): Promise<JobRow[]>;
  insertBatch(row: BatchRow): Promise<void>;
  openBatches(): Promise<BatchRow[]>;
  closeBatch(id: string, costUsd: number): Promise<void>;
  reserve(amountUsd: number, capUsd: number): Promise<string | null>;
  settle(holdId: string, actualUsd: number): Promise<void>;
}

export interface WordBankDeps {
  store: WordBankStore;
  batches: BatchApi;
  model: string;
  capUsd: number;
  log: Log;
}

/** custom_id of a word's request: stable and within the API's [a-zA-Z0-9_-]{1,64}. */
export function customIdOf(lemmaNorm: string, pos: string): string {
  return `wb_${createHash('sha256').update(`${lemmaNorm}|${pos}`).digest('hex').slice(0, 40)}`;
}

const BAND_RANK = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/** The lexicon's example for a sense closest to the word's level, if it is fit for the bank. */
function bestExample(
  lemmaNorm: string,
  cefr: string,
  examples: LexiconExampleHit[],
): { en: string; tr: string } | null {
  const want = BAND_RANK.indexOf(cefr);
  const fit = examples
    .filter((e) => e.text_tr && !exampleProblem(lemmaNorm, e.text_en, e.text_tr))
    .sort(
      (a, b) =>
        Math.abs(BAND_RANK.indexOf(a.level_band) - want) -
          Math.abs(BAND_RANK.indexOf(b.level_band) - want) || a.text_en.length - b.text_en.length,
    );
  const e = fit[0];
  return e ? { en: e.text_en, tr: e.text_tr! } : null;
}

/**
 * The lexicon's side of a word (rule 6): its senses for the word's part of speech (oldest
 * first, near-duplicates skipped, at most WORDBANK_MAX_SENSES), split into those that already
 * have a shared example and those that need one.
 */
export function lexiconSide(
  word: PendingWord,
  hit: LexiconTermHit | undefined,
  examplesBySense: Map<string, LexiconExampleHit[]>,
): Omit<JobInput, 'word'> {
  if (!hit) return { term_id: null, lemma: null, complete: [], given: [] };
  const senses: { id: string; meaning_tr: string }[] = [];
  for (const s of hit.senses) {
    if (s.pos !== word.pos) continue;
    const me = { pos: s.pos, meaning_tr: s.meaning_tr };
    if (senses.some((o) => isDuplicateSense(me, { pos: s.pos, meaning_tr: o.meaning_tr })))
      continue;
    senses.push(s);
    if (senses.length === WORDBANK_MAX_SENSES) break;
  }
  const complete: CompleteSense[] = [];
  const given: GivenSense[] = [];
  for (const s of senses) {
    const ex = bestExample(word.lemma_norm, word.cefr, examplesBySense.get(s.id) ?? []);
    if (ex)
      complete.push({
        meaning_tr: s.meaning_tr,
        example_en: ex.en,
        example_tr: ex.tr,
        sense_id: s.id,
      });
    else given.push({ sense_id: s.id, meaning_tr: s.meaning_tr });
  }
  return { term_id: hit.term_id, lemma: hit.lemma, complete, given };
}

/** Upper bound of one word's request (reserved before sending). */
export function requestBoundUsd(model: string, w: WordInput): number {
  return reserveUsd(model, {
    inputTokens: tokenBound(
      WORDBANK_SYSTEM_PROMPT + JSON.stringify(buildWordRequest(w, { model }).messages),
    ),
    maxTokens: WORDBANK_MAX_TOKENS,
    batch: true,
  });
}

/** Expected cost of one word's request (for the plan and the log; not used by the guard). */
export function requestExpectedUsd(model: string, w: WordInput): number {
  const input = tokenBound(
    WORDBANK_SYSTEM_PROMPT + JSON.stringify(buildWordRequest(w, { model }).messages),
  );
  return callCostUsd(
    model,
    { input_tokens: input, output_tokens: EXPECTED_OUTPUT_TOKENS },
    { batch: true },
  );
}

const chunks = <T>(xs: readonly T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/** Pending words with their lexicon side (the lexicon and its examples are read in chunks). */
async function prepare(store: WordBankStore, words: PendingWord[]): Promise<JobInput[]> {
  const hits = new Map<string, LexiconTermHit>();
  for (const part of chunks([...new Set(words.map((w) => w.lemma_norm))], 500))
    for (const h of await store.lexiconFind(part)) hits.set(h.lemma_norm, h);
  const senseIds = [...hits.values()].flatMap((h) => h.senses.map((s) => s.id));
  const examples = new Map<string, LexiconExampleHit[]>();
  for (const part of chunks(senseIds, 150))
    for (const e of await store.lexiconExamples(part))
      examples.set(e.sense_id, [...(examples.get(e.sense_id) ?? []), e]);
  return words.map((word) => ({ word, ...lexiconSide(word, hits.get(word.lemma_norm), examples) }));
}

function rowOf(
  input: JobInput,
  senses: WordBankSense[],
  opts: { lemma: string; term_id: string | null; model: string | null; costUsd: number },
): BankRowOut {
  return {
    lemma_norm: input.word.lemma_norm,
    pos: input.word.pos,
    lemma: opts.lemma,
    cefr: input.word.cefr,
    list_source: input.word.source,
    zipf: input.word.zipf,
    lexicon_term_id: opts.term_id,
    senses: senses.slice(0, WORDBANK_MAX_SENSES),
    model: opts.model,
    prompt_version: WORDBANK_PROMPT_VERSION,
    cost_usd: roundUsd(opts.costUsd),
  };
}

const isComplete = (i: JobInput) => i.given.length === 0 && i.complete.length > 0;

// ---------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------

export interface PlanReport {
  pending: number;
  fromLexicon: number;
  examplesOnly: number;
  fullAsk: number;
  estimatedUsd: number;
  upperBoundUsd: number;
}

export async function runPlan(
  deps: Pick<WordBankDeps, 'store' | 'model'>,
  opts: { limit: number },
): Promise<PlanReport> {
  const inputs = await prepare(deps.store, await deps.store.pending(opts.limit));
  const report: PlanReport = {
    pending: inputs.length,
    fromLexicon: 0,
    examplesOnly: 0,
    fullAsk: 0,
    estimatedUsd: 0,
    upperBoundUsd: 0,
  };
  for (const i of inputs) {
    if (isComplete(i)) {
      report.fromLexicon++;
      continue;
    }
    if (i.given.length > 0) report.examplesOnly++;
    else report.fullAsk++;
    const w = wordInput(i);
    report.estimatedUsd += requestExpectedUsd(deps.model, w);
    report.upperBoundUsd += requestBoundUsd(deps.model, w);
  }
  report.estimatedUsd = roundUsd(report.estimatedUsd, 'up');
  report.upperBoundUsd = roundUsd(report.upperBoundUsd, 'up');
  return report;
}

const wordInput = (i: JobInput, problem: string | null = null): WordInput => ({
  lemma_norm: i.word.lemma_norm,
  pos: i.word.pos,
  cefr: i.word.cefr,
  given: i.given,
  problem,
});

// ---------------------------------------------------------------------------
// submit
// ---------------------------------------------------------------------------

export interface SubmitReport {
  pending: number;
  fromLexicon: number;
  submitted: number;
  batchId: string | null;
  reservedUsd: number;
  estimatedUsd: number;
  stopped: 'done' | 'budget' | 'empty';
}

export async function runSubmit(
  deps: WordBankDeps,
  opts: { max: number; dryRun?: boolean },
): Promise<SubmitReport> {
  const words = await deps.store.pending(opts.max);
  const report: SubmitReport = {
    pending: words.length,
    fromLexicon: 0,
    submitted: 0,
    batchId: null,
    reservedUsd: 0,
    estimatedUsd: 0,
    stopped: words.length === 0 ? 'empty' : 'done',
  };
  if (words.length === 0) return report;
  const inputs = await prepare(deps.store, words);

  // 1. Words the lexicon covers completely: no model call at all.
  const direct = inputs.filter(isComplete);
  for (const part of chunks(direct, 500)) {
    if (!opts.dryRun)
      await deps.store.putRows(
        part.map((i) =>
          rowOf(i, i.complete, {
            lemma: i.lemma ?? i.word.lemma_norm,
            term_id: i.term_id,
            model: null,
            costUsd: 0,
          }),
        ),
      );
  }
  report.fromLexicon = direct.length;

  // 2. The rest: one Message Batch, reserved as a whole (halved until it fits the budget).
  let ask = inputs.filter((i) => !isComplete(i));
  if (ask.length === 0) return report;
  const reqs = ask.map((i) => {
    const w = wordInput(i, i.word.problem);
    return {
      input: i,
      w,
      bound: requestBoundUsd(deps.model, w),
      expected: requestExpectedUsd(deps.model, w),
    };
  });
  let picked = reqs;
  let hold: string | null = null;
  let amount = 0;
  while (picked.length > 0) {
    amount = roundUsd(
      picked.reduce((s, r) => s + r.bound, 0),
      'up',
    );
    if (opts.dryRun) break;
    hold = await deps.store.reserve(amount, deps.capUsd);
    if (hold) break;
    report.stopped = 'budget';
    picked = picked.slice(0, Math.floor(picked.length / 2));
  }
  if (picked.length === 0) return report;
  report.estimatedUsd = roundUsd(
    picked.reduce((s, r) => s + r.expected, 0),
    'up',
  );
  report.reservedUsd = amount;
  if (opts.dryRun) {
    report.submitted = picked.length;
    return report;
  }
  ask = picked.map((p) => p.input);

  let batch: { id: string };
  try {
    batch = await deps.batches.create(
      picked.map((p) => ({
        custom_id: customIdOf(p.input.word.lemma_norm, p.input.word.pos),
        params: buildWordRequest(p.w, { model: deps.model }),
      })),
    );
  } catch (e) {
    if (hold) await deps.store.settle(hold, 0);
    throw e;
  }
  await deps.store.insertBatch({
    id: batch.id,
    hold_id: hold,
    reserved_usd: amount,
    requests: picked.length,
    model: deps.model,
    prompt_version: WORDBANK_PROMPT_VERSION,
    state: 'submitted',
    cost_usd: null,
  });
  for (const part of chunks(ask, 500)) {
    await deps.store.upsertJobs(
      part.map((i) => ({
        lemma_norm: i.word.lemma_norm,
        pos: i.word.pos,
        state: 'submitted',
        attempt: i.word.attempt,
        batch_id: batch.id,
        custom_id: customIdOf(i.word.lemma_norm, i.word.pos),
        last_error: null,
        input: i,
      })),
    );
  }
  report.submitted = picked.length;
  report.batchId = batch.id;
  deps.log('word bank batch submitted', {
    batch_id: batch.id,
    requests: picked.length,
    reserved_usd: amount,
    estimated_usd: report.estimatedUsd,
  });
  return report;
}

// ---------------------------------------------------------------------------
// collect
// ---------------------------------------------------------------------------

export interface CollectReport {
  batches: { id: string; status: string }[];
  stored: number;
  newLexiconSenses: number;
  retried: number;
  failed: number;
  costUsd: number;
  problems: Record<string, number>;
}

interface Answered {
  job: JobRow & { input: JobInput };
  lemma: string;
  senses: { sense: WordBankSense; newItem: LexiconItem | null }[];
  costUsd: number;
}

export async function runCollect(deps: WordBankDeps): Promise<CollectReport> {
  const report: CollectReport = {
    batches: [],
    stored: 0,
    newLexiconSenses: 0,
    retried: 0,
    failed: 0,
    costUsd: 0,
    problems: {},
  };
  const problem = (p: string) => (report.problems[p] = (report.problems[p] ?? 0) + 1);
  for (const b of await deps.store.openBatches()) {
    const status = (await deps.batches.retrieve(b.id)).processing_status;
    report.batches.push({ id: b.id, status });
    if (status !== 'ended') continue;
    const jobs = new Map(
      (await deps.store.jobsOfBatch(b.id))
        .filter(
          (j): j is JobRow & { input: JobInput } => j.state === 'submitted' && j.input !== null,
        )
        .map((j) => [j.custom_id ?? customIdOf(j.lemma_norm, j.pos), j]),
    );
    const answered: Answered[] = [];
    const retry: JobRow[] = [];
    let batchCost = 0;
    const seen = new Set<string>();
    for await (const res of (await deps.batches.results(b.id)) as AsyncIterable<BatchResult>) {
      const job = jobs.get(res.custom_id);
      if (!job || seen.has(res.custom_id)) continue;
      seen.add(res.custom_id);
      if (res.result.type !== 'succeeded') {
        // Not billed: ask again in a later run, without counting an attempt.
        retry.push({
          ...job,
          state: 'queued',
          batch_id: null,
          last_error: `batch ${res.result.type}`,
        });
        report.retried++;
        continue;
      }
      const msg = res.result.message as unknown as CalledMessage;
      const cost = callCostUsd(msg.model ?? b.model, msg.usage, { batch: true });
      batchCost += cost;
      const attempt = job.attempt + 1;
      const parsed = parseWordAnswer(msg, wordInput(job.input));
      if (parsed.kind === 'invalid' && job.input.complete.length === 0) {
        problem(parsed.reason);
        const failed = attempt >= WORDBANK_MAX_ATTEMPTS;
        retry.push({
          ...job,
          state: failed ? 'failed' : 'queued',
          attempt,
          batch_id: null,
          last_error: parsed.reason,
        });
        if (failed) report.failed++;
        else report.retried++;
        continue;
      }
      const good =
        parsed.kind === 'ok'
          ? parsed
          : { lemma: job.input.lemma ?? job.lemma_norm, senses: [], dropped: [parsed.reason] };
      for (const d of good.dropped) problem(d);
      const w = job.input.word;
      answered.push({
        job,
        lemma: job.input.lemma ?? good.lemma,
        costUsd: cost,
        senses: [
          ...job.input.complete.map((s) => ({ sense: s, newItem: null })),
          ...good.senses.map((s) => ({
            sense: {
              meaning_tr: s.meaning_tr,
              example_en: s.example_en,
              example_tr: s.example_tr,
              sense_id: s.given?.sense_id ?? null,
            },
            newItem: s.given
              ? null
              : ({
                  lemma: good.lemma,
                  lemma_norm: w.lemma_norm,
                  term_type: w.lemma_norm.includes(' ') ? 'phrase' : 'word',
                  pos: w.pos,
                  gloss_en: s.gloss_en!,
                  gloss_key: s.gloss_key!,
                  meaning_tr: s.meaning_tr,
                  ipa: null,
                  model: msg.model ?? b.model,
                  zipf: w.zipf,
                  cefr: w.cefr,
                  cefr_source: w.source,
                  cefr_list: w.cefr,
                } satisfies LexiconItem),
          })),
        ],
      });
    }

    // New meanings into the shared lexicon (insert-or-get with its near-duplicate guard).
    const rows: BankRowOut[] = [];
    const flat = answered.flatMap((a) => a.senses.filter((s) => s.newItem).map((s) => ({ a, s })));
    const termOf = new Map<Answered, string>();
    for (const part of chunks(flat, 100)) {
      const res = await deps.store.lexiconUpsert(part.map((p) => p.s.newItem!));
      part.forEach((p, k) => {
        const r = res[k];
        if (!r) return;
        p.s.sense.sense_id = r.sense_id;
        termOf.set(p.a, r.term_id);
      });
      report.newLexiconSenses += part.length;
    }
    for (const a of answered) {
      // Two answers that the lexicon matched to one sense are one meaning.
      const senses: WordBankSense[] = [];
      for (const { sense } of a.senses)
        if (!sense.sense_id || !senses.some((s) => s.sense_id === sense.sense_id))
          senses.push(sense);
      rows.push(
        rowOf(a.job.input, senses, {
          lemma: a.lemma,
          term_id: a.job.input.term_id ?? termOf.get(a) ?? null,
          model: b.model,
          costUsd: a.costUsd,
        }),
      );
    }
    for (const part of chunks(rows, 500)) report.stored += await deps.store.putRows(part);

    // Requests the batch never answered: ask again.
    for (const [cid, job] of jobs) {
      if (seen.has(cid)) continue;
      retry.push({
        ...job,
        state: 'queued',
        batch_id: null,
        last_error: 'missing from batch results',
      });
      report.retried++;
    }
    for (const part of chunks(retry, 500))
      await deps.store.upsertJobs(
        part.map((j) => ({ ...j, input: j.state === 'failed' ? j.input : null })),
      );

    if (b.hold_id) await deps.store.settle(b.hold_id, roundUsd(batchCost));
    await deps.store.closeBatch(b.id, roundUsd(batchCost));
    report.costUsd += batchCost;
    deps.log('word bank batch collected', {
      batch_id: b.id,
      cost_usd: roundUsd(batchCost),
      stored: rows.length,
    });
  }
  report.costUsd = roundUsd(report.costUsd);
  return report;
}
