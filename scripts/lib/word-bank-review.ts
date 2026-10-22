// The word-bank review pass (decision 0040): a clean-up of the finished Kelime Bankası rows
// (decision 0038), with its dependencies passed in so tests run it against fakes. CLI:
// scripts/word-bank.ts review-submit / review-collect; workflow: .github/workflows/word-bank.yml.
//
//   submit   every non-retired bank row without a review is sent once, REVIEW_GROUP_SIZE rows
//            per request, as one Message Batch after its upper-bound cost is reserved on the
//            monthly Claude budget (purpose 'wordbank'). --dry-run reports counts and cost only.
//   collect  reads finished review batches: settles the real cost, checks every proposed
//            change with the generation checks, stores corrected meanings in the shared lexicon
//            and the corrected rows in the bank (server_seq moves, devices pull them again), and
//            records the review per row. A row whose change was rejected is asked again (with
//            the problem named) until REVIEW_MAX_ATTEMPTS; then its valid changes are applied.
//
// A row always keeps at least one meaning. If every meaning is dropped, the row is retired
// (devices delete it; cards users already made are their own and stay). Idempotent: a row with
// a review or a request in flight is not sent again; a row changed since it was sent is not
// overwritten (it is queued for a new review).

import { createHash } from 'node:crypto';
import {
  callCostUsd,
  reserveUsd,
  roundUsd,
  tokenBound,
} from '../../supabase/functions/_shared/image-models.ts';
import type { CalledMessage } from '../../supabase/functions/_shared/image-pipeline.ts';
import {
  glossKey,
  isCleanLexiconText,
  isDuplicateSense,
} from '../../supabase/functions/_shared/text.ts';
import type { WordBankSense } from '../../supabase/functions/_shared/wordbank-contract.ts';
import type { BatchApi, BatchResult, Log } from './image-jobs.ts';
import type { LexiconItem } from './word-bank-jobs.ts';
import { exampleProblem } from './word-bank-prompt.ts';
import {
  buildReviewRequest,
  parseReviewAnswer,
  REVIEW_GROUP_SIZE,
  REVIEW_MAX_TOKENS,
  REVIEW_PROMPT_VERSION,
  REVIEW_SYSTEM_PROMPT,
  type ReviewChange,
  type ReviewRowInput,
} from './word-bank-review-prompt.ts';

export const REVIEW_MAX_ATTEMPTS = 2;
/** Expected output tokens per request (a few changes of a 25-word group), for the estimate. */
export const EXPECTED_REVIEW_OUTPUT_TOKENS = 450;
/** Example fixes printed by collect for a person to check in the job log. */
export const REVIEW_LOG_SAMPLES = 40;

/** A bank row waiting for its review (public.word_bank_review_pending). */
export interface ReviewPending extends ReviewRowInput {
  attempt: number;
  /** Why a previous correction was rejected (sent with the retry), or null. */
  problem: string | null;
}

/** What a submitted row needs at collect (word_bank_review.input). */
export interface ReviewJobInput {
  row: ReviewRowInput;
  /** 0-based position of the row in its request. */
  n: number;
}

export interface ReviewJobRow {
  lemma_norm: string;
  pos: string;
  state: 'queued' | 'submitted' | 'done' | 'failed';
  attempt: number;
  batch_id: string | null;
  custom_id: string | null;
  last_error: string | null;
  input: ReviewJobInput | null;
}

/** One reviewed row for public.word_bank_review_apply. */
export interface ReviewApplyRow {
  lemma_norm: string;
  pos: string;
  /** The senses that were reviewed: the row is changed only if it still has them. */
  expected: WordBankSense[];
  /** New senses, or null when the row stays as it is. */
  senses: WordBankSense[] | null;
  retire: boolean;
  lexicon_term_id: string | null;
  attempt: number;
  outcome: ReviewOutcome;
  model: string;
  prompt_version: string;
  cost_usd: number;
}

export interface ReviewOutcome {
  kept: number;
  fixed: { sense: number; old: WordBankSense; new: WordBankSense; reason: string }[];
  dropped: { sense: number; old: WordBankSense; reason: string }[];
  rejected: string[];
  retired: boolean;
}

export interface ReviewBatchRow {
  id: string;
  hold_id: string | null;
  reserved_usd: number;
  requests: number;
  model: string;
  prompt_version: string;
  state: 'submitted' | 'collected';
  cost_usd: number | null;
}

/** What the review needs from the database (SupabaseWordBankReviewStore implements it). */
export interface ReviewStore {
  reviewPending(limit: number): Promise<ReviewPending[]>;
  upsertReviews(rows: ReviewJobRow[]): Promise<void>;
  reviewsOfBatch(batchId: string): Promise<ReviewJobRow[]>;
  insertReviewBatch(row: ReviewBatchRow): Promise<void>;
  openReviewBatches(): Promise<ReviewBatchRow[]>;
  closeReviewBatch(id: string, costUsd: number): Promise<void>;
  applyReviews(
    rows: ReviewApplyRow[],
  ): Promise<{ changed: number; retired: number; stale: number }>;
  lexiconUpsert(items: LexiconItem[]): Promise<{ term_id: string; sense_id: string | null }[]>;
  reserve(amountUsd: number, capUsd: number): Promise<string | null>;
  settle(holdId: string, actualUsd: number): Promise<void>;
}

export interface ReviewDeps {
  store: ReviewStore;
  batches: BatchApi;
  model: string;
  capUsd: number;
  log: Log;
}

/** custom_id of a group: stable for its rows and within the API's [a-zA-Z0-9_-]{1,64}. */
export function reviewCustomId(rows: readonly { lemma_norm: string; pos: string }[]): string {
  const key = rows.map((r) => `${r.lemma_norm}|${r.pos}`).join('\n');
  return `wr_${createHash('sha256').update(key).digest('hex').slice(0, 40)}`;
}

const chunks = <T>(xs: readonly T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

const inputTokens = (rows: readonly ReviewPending[], model: string) =>
  tokenBound(REVIEW_SYSTEM_PROMPT + JSON.stringify(buildReviewRequest(rows, { model }).messages));

/** Upper bound of one group's request (reserved before sending). */
export function reviewBoundUsd(model: string, rows: readonly ReviewPending[]): number {
  return reserveUsd(model, {
    inputTokens: inputTokens(rows, model),
    maxTokens: REVIEW_MAX_TOKENS,
    batch: true,
  });
}

/** Expected cost of one group's request (for the dry run and the log). */
export function reviewExpectedUsd(model: string, rows: readonly ReviewPending[]): number {
  return callCostUsd(
    model,
    { input_tokens: inputTokens(rows, model), output_tokens: EXPECTED_REVIEW_OUTPUT_TOKENS },
    { batch: true },
  );
}

// ---------------------------------------------------------------------------
// applying one row's changes (pure)
// ---------------------------------------------------------------------------

/** A corrected meaning that needs its own lexicon sense (its Turkish meaning changed). */
export interface NewMeaning {
  /** Index in `senses` of the result. */
  index: number;
  meaning_tr: string;
  gloss_en: string;
  gloss_key: string;
}

export interface RowReview {
  /** The row's senses after the review (empty: retire the row). */
  senses: WordBankSense[];
  changed: boolean;
  newMeanings: NewMeaning[];
  outcome: ReviewOutcome;
}

const sameText = (a: string, b: string) => a.normalize('NFC') === b.normalize('NFC');

/** Checks one "fix" against the row: the generation checks. Returns the fixed sense or a problem. */
function fixSense(
  row: ReviewRowInput,
  old: WordBankSense,
  c: ReviewChange,
): { sense: WordBankSense; gloss: { en: string; key: string } | null } | { problem: string } {
  // A change of letter case only is no change.
  const meaningChanged =
    !!c.meaning_tr && !sameText(c.meaning_tr.toLowerCase(), old.meaning_tr.toLowerCase());
  const meaning = meaningChanged ? c.meaning_tr : old.meaning_tr;
  const en = c.example_en || old.example_en;
  if (c.example_en && !sameText(c.example_en, old.example_en) && !c.example_tr)
    return { problem: 'example_tr_missing' };
  const tr = c.example_tr || old.example_tr;
  if (
    meaningChanged &&
    (meaning.length > 120 || /[()[\]]/u.test(meaning) || !isCleanLexiconText(meaning, 'tr'))
  )
    return { problem: 'meaning_tr_unfit' };
  let gloss: { en: string; key: string } | null = null;
  if (meaningChanged) {
    const key = c.gloss_en ? glossKey(c.gloss_en) : null;
    if (!c.gloss_en || c.gloss_en.length > 200 || !key || !isCleanLexiconText(c.gloss_en, 'en'))
      return { problem: 'gloss_en_unfit' };
    gloss = { en: c.gloss_en, key };
  }
  const problem = exampleProblem(row.lemma_norm, en, tr);
  if (problem) return { problem };
  return {
    // A changed meaning is a different lexicon sense: its id is set after lexicon_upsert.
    sense: {
      meaning_tr: meaning,
      example_en: en,
      example_tr: tr,
      sense_id: meaningChanged ? null : old.sense_id,
    },
    gloss,
  };
}

/**
 * Applies the model's changes to one row: "fix" replaces the named parts (checked like a
 * generated answer: clean Turkish meaning, an English definition when the meaning changed, the
 * example contains the word, a Turkish translation, length limits), "drop" removes the meaning,
 * meanings not named stay. A rejected fix leaves that meaning unchanged and names the problem.
 * Afterwards near-duplicate meanings (same part of speech, overlapping Turkish meaning) are
 * removed, the later one going. An empty result means the row is retired.
 */
export function reviewRow(row: ReviewRowInput, changes: readonly ReviewChange[]): RowReview {
  const outcome: ReviewOutcome = { kept: 0, fixed: [], dropped: [], rejected: [], retired: false };
  const out: { sense: WordBankSense; from: number; gloss: { en: string; key: string } | null }[] =
    [];
  row.senses.forEach((old, i) => {
    const c = changes.find((x) => x.sense === i);
    if (!c) {
      out.push({ sense: old, from: i, gloss: null });
      return;
    }
    if (c.action === 'drop') {
      outcome.dropped.push({ sense: i, old, reason: c.reason });
      return;
    }
    const r = fixSense(row, old, c);
    if ('problem' in r) {
      outcome.rejected.push(r.problem);
      out.push({ sense: old, from: i, gloss: null });
      return;
    }
    const same =
      sameText(r.sense.meaning_tr, old.meaning_tr) &&
      sameText(r.sense.example_en, old.example_en) &&
      sameText(r.sense.example_tr, old.example_tr);
    if (same) {
      out.push({ sense: old, from: i, gloss: null });
      return;
    }
    outcome.fixed.push({ sense: i, old, new: r.sense, reason: c.reason });
    out.push({ sense: r.sense, from: i, gloss: r.gloss });
  });

  // No near-duplicate meanings within a row ("davet" ~ "davetiye, davet").
  const kept: typeof out = [];
  for (const o of out) {
    const dup = kept.some((k) =>
      isDuplicateSense(
        { pos: row.pos, meaning_tr: k.sense.meaning_tr },
        { pos: row.pos, meaning_tr: o.sense.meaning_tr },
      ),
    );
    if (dup) {
      const fixedAt = outcome.fixed.findIndex((f) => f.sense === o.from);
      if (fixedAt >= 0) outcome.fixed.splice(fixedAt, 1);
      outcome.dropped.push({
        sense: o.from,
        old: row.senses[o.from]!,
        reason: 'duplicate meaning',
      });
      continue;
    }
    kept.push(o);
  }
  outcome.kept = kept.filter((k) => k.sense === row.senses[k.from]).length;
  outcome.retired = kept.length === 0;
  return {
    senses: kept.map((k) => k.sense),
    changed: outcome.fixed.length > 0 || outcome.dropped.length > 0,
    newMeanings: kept.flatMap((k, index) =>
      k.gloss
        ? [{ index, meaning_tr: k.sense.meaning_tr, gloss_en: k.gloss.en, gloss_key: k.gloss.key }]
        : [],
    ),
    outcome,
  };
}

/** Two meanings that the lexicon matched to one sense are one meaning: the later one goes. */
export function dedupeBySenseId(r: RowReview, row: ReviewRowInput): RowReview {
  const senses: WordBankSense[] = [];
  for (const s of r.senses) {
    if (s.sense_id && senses.some((o) => o.sense_id === s.sense_id)) {
      const from = r.outcome.fixed.find((f) => f.new === s)?.sense ?? row.senses.indexOf(s);
      r.outcome.fixed = r.outcome.fixed.filter((f) => f.new !== s);
      if (from >= 0)
        r.outcome.dropped.push({
          sense: from,
          old: row.senses[from]!,
          reason: 'duplicate meaning',
        });
      continue;
    }
    senses.push(s);
  }
  r.outcome.kept = senses.filter((s) => row.senses.includes(s)).length;
  return { ...r, senses, changed: r.outcome.fixed.length > 0 || r.outcome.dropped.length > 0 };
}

// ---------------------------------------------------------------------------
// submit
// ---------------------------------------------------------------------------

export interface ReviewSubmitReport {
  pending: number;
  requests: number;
  submitted: number;
  batchId: string | null;
  reservedUsd: number;
  estimatedUsd: number;
  upperBoundUsd: number;
  stopped: 'done' | 'budget' | 'empty';
}

export async function runReviewSubmit(
  deps: Omit<ReviewDeps, 'batches'> & { batches: BatchApi | null },
  opts: { max: number; dryRun?: boolean },
): Promise<ReviewSubmitReport> {
  const rows = await deps.store.reviewPending(opts.max);
  const report: ReviewSubmitReport = {
    pending: rows.length,
    requests: 0,
    submitted: 0,
    batchId: null,
    reservedUsd: 0,
    estimatedUsd: 0,
    upperBoundUsd: 0,
    stopped: rows.length === 0 ? 'empty' : 'done',
  };
  if (rows.length === 0) return report;
  const groups = chunks(rows, REVIEW_GROUP_SIZE).map((g) => ({
    rows: g,
    custom_id: reviewCustomId(g),
    bound: reviewBoundUsd(deps.model, g),
    expected: reviewExpectedUsd(deps.model, g),
  }));
  report.estimatedUsd = roundUsd(
    groups.reduce((s, g) => s + g.expected, 0),
    'up',
  );
  report.upperBoundUsd = roundUsd(
    groups.reduce((s, g) => s + g.bound, 0),
    'up',
  );
  report.requests = groups.length;
  if (opts.dryRun || !deps.batches) {
    report.submitted = rows.length;
    report.reservedUsd = report.upperBoundUsd;
    return report;
  }

  // Reserve the whole batch's upper bound; halve until it fits the monthly budget.
  let picked = groups;
  let hold: string | null = null;
  let amount = 0;
  while (picked.length > 0) {
    amount = roundUsd(
      picked.reduce((s, g) => s + g.bound, 0),
      'up',
    );
    hold = await deps.store.reserve(amount, deps.capUsd);
    if (hold) break;
    report.stopped = 'budget';
    picked = picked.slice(0, Math.floor(picked.length / 2));
  }
  if (picked.length === 0 || !hold) {
    report.submitted = 0;
    report.requests = 0;
    report.estimatedUsd = 0;
    return report;
  }

  let batch: { id: string };
  try {
    batch = await deps.batches.create(
      picked.map((g) => ({
        custom_id: g.custom_id,
        params: buildReviewRequest(g.rows, { model: deps.model }),
      })),
    );
  } catch (e) {
    await deps.store.settle(hold, 0);
    throw e;
  }
  const n = picked.reduce((s, g) => s + g.rows.length, 0);
  await deps.store.insertReviewBatch({
    id: batch.id,
    hold_id: hold,
    reserved_usd: amount,
    requests: picked.length,
    model: deps.model,
    prompt_version: REVIEW_PROMPT_VERSION,
    state: 'submitted',
    cost_usd: null,
  });
  const jobs: ReviewJobRow[] = picked.flatMap((g) =>
    g.rows.map((r, i) => ({
      lemma_norm: r.lemma_norm,
      pos: r.pos,
      state: 'submitted' as const,
      attempt: r.attempt,
      batch_id: batch.id,
      custom_id: g.custom_id,
      last_error: null,
      input: { row: rowInput(r), n: i },
    })),
  );
  for (const part of chunks(jobs, 500)) await deps.store.upsertReviews(part);
  report.requests = picked.length;
  report.submitted = n;
  report.batchId = batch.id;
  report.reservedUsd = amount;
  report.estimatedUsd = roundUsd(
    picked.reduce((s, g) => s + g.expected, 0),
    'up',
  );
  deps.log('word bank review batch submitted', {
    batch_id: batch.id,
    requests: picked.length,
    rows: n,
    reserved_usd: amount,
    estimated_usd: report.estimatedUsd,
  });
  return report;
}

const rowInput = (r: ReviewRowInput): ReviewRowInput => ({
  lemma_norm: r.lemma_norm,
  pos: r.pos,
  lemma: r.lemma,
  cefr: r.cefr,
  list_source: r.list_source,
  zipf: r.zipf,
  lexicon_term_id: r.lexicon_term_id,
  senses: r.senses,
});

// ---------------------------------------------------------------------------
// collect
// ---------------------------------------------------------------------------

export interface ReviewSample {
  lemma: string;
  pos: string;
  kind: 'fix' | 'drop' | 'retire';
  old: string;
  new: string | null;
  reason: string;
}

export interface ReviewCollectReport {
  batches: { id: string; status: string }[];
  rows: number;
  rowsChanged: number;
  sensesKept: number;
  sensesFixed: number;
  sensesDropped: number;
  rowsRetired: number;
  fixesRejected: number;
  retried: number;
  failed: number;
  stale: number;
  newLexiconSenses: number;
  costUsd: number;
  problems: Record<string, number>;
  samples: ReviewSample[];
}

const show = (s: WordBankSense) => `${s.meaning_tr} | ${s.example_en} | ${s.example_tr}`;

export async function runReviewCollect(deps: ReviewDeps): Promise<ReviewCollectReport> {
  const report: ReviewCollectReport = {
    batches: [],
    rows: 0,
    rowsChanged: 0,
    sensesKept: 0,
    sensesFixed: 0,
    sensesDropped: 0,
    rowsRetired: 0,
    fixesRejected: 0,
    retried: 0,
    failed: 0,
    stale: 0,
    newLexiconSenses: 0,
    costUsd: 0,
    problems: {},
    samples: [],
  };
  const problem = (p: string) => (report.problems[p] = (report.problems[p] ?? 0) + 1);
  const sample = (s: ReviewSample) => {
    if (report.samples.length < REVIEW_LOG_SAMPLES) report.samples.push(s);
  };

  for (const b of await deps.store.openReviewBatches()) {
    const status = (await deps.batches.retrieve(b.id)).processing_status;
    report.batches.push({ id: b.id, status });
    if (status !== 'ended') continue;
    const groups = new Map<string, (ReviewJobRow & { input: ReviewJobInput })[]>();
    for (const j of await deps.store.reviewsOfBatch(b.id)) {
      if (j.state !== 'submitted' || !j.input || !j.custom_id) continue;
      groups.set(j.custom_id, [
        ...(groups.get(j.custom_id) ?? []),
        j as ReviewJobRow & { input: ReviewJobInput },
      ]);
    }
    for (const g of groups.values()) g.sort((x, y) => x.input.n - y.input.n);

    const retry: ReviewJobRow[] = [];
    const reviewed: {
      job: ReviewJobRow & { input: ReviewJobInput };
      r: RowReview;
      costUsd: number;
    }[] = [];
    let batchCost = 0;
    const seen = new Set<string>();
    const requeue = (j: ReviewJobRow, attempt: number, err: string) => {
      const failed = attempt >= REVIEW_MAX_ATTEMPTS;
      retry.push({
        ...j,
        state: failed ? 'failed' : 'queued',
        attempt,
        batch_id: null,
        custom_id: null,
        last_error: err,
        input: null,
      });
      if (failed) report.failed++;
      else report.retried++;
    };

    for await (const res of (await deps.batches.results(b.id)) as AsyncIterable<BatchResult>) {
      const group = groups.get(res.custom_id);
      if (!group || seen.has(res.custom_id)) continue;
      seen.add(res.custom_id);
      if (res.result.type !== 'succeeded') {
        // Not billed: ask again in a later run, without counting an attempt.
        for (const j of group) requeue(j, j.attempt, `batch ${res.result.type}`);
        continue;
      }
      const msg = res.result.message as unknown as CalledMessage;
      const cost = callCostUsd(msg.model ?? b.model, msg.usage, { batch: true });
      batchCost += cost;
      const share = cost / group.length;
      const parsed = parseReviewAnswer(
        msg,
        group.map((j) => j.input.row),
      );
      if (parsed.kind === 'invalid') {
        problem(parsed.reason);
        for (const j of group) requeue(j, j.attempt + 1, parsed.reason);
        continue;
      }
      if (parsed.unknown > 0)
        report.problems.unknown_meaning = (report.problems.unknown_meaning ?? 0) + parsed.unknown;
      group.forEach((j, i) => {
        const r = reviewRow(j.input.row, parsed.changes.get(i) ?? []);
        const attempt = j.attempt + 1;
        if (r.outcome.rejected.length > 0) {
          for (const p of r.outcome.rejected) problem(p);
          report.fixesRejected += r.outcome.rejected.length;
          // Ask again with the problem named; the last attempt applies what was valid.
          if (attempt < REVIEW_MAX_ATTEMPTS) {
            retry.push({
              ...j,
              state: 'queued',
              attempt,
              batch_id: null,
              custom_id: null,
              last_error: r.outcome.rejected[0]!,
              input: null,
            });
            report.retried++;
            return;
          }
        }
        reviewed.push({ job: { ...j, attempt }, r, costUsd: share });
      });
    }

    // Corrected meanings into the shared lexicon (insert-or-get with its near-duplicate guard).
    const flat = reviewed.flatMap((x) => x.r.newMeanings.map((m) => ({ x, m })));
    const termOf = new Map<(typeof reviewed)[number], string>();
    for (const part of chunks(flat, 100)) {
      const res = await deps.store.lexiconUpsert(
        part.map(({ x, m }) => {
          const row = x.job.input.row;
          return {
            lemma: row.lemma,
            lemma_norm: row.lemma_norm,
            term_type: row.lemma_norm.includes(' ') ? 'phrase' : 'word',
            pos: row.pos,
            gloss_en: m.gloss_en,
            gloss_key: m.gloss_key,
            meaning_tr: m.meaning_tr,
            ipa: null,
            model: b.model,
            zipf: row.zipf,
            cefr: row.cefr,
            cefr_source: row.list_source,
            cefr_list: row.cefr,
          } satisfies LexiconItem;
        }),
      );
      part.forEach(({ x, m }, k) => {
        const r = res[k];
        if (!r) return;
        // The fixed sense is a new object (shared with outcome.fixed): set its link in place.
        x.r.senses[m.index]!.sense_id = r.sense_id;
        termOf.set(x, r.term_id);
      });
      report.newLexiconSenses += part.length;
    }

    const apply: ReviewApplyRow[] = reviewed.map((x) => {
      const row = x.job.input.row;
      const r = dedupeBySenseId(x.r, row);
      const retire = r.senses.length === 0;
      return {
        lemma_norm: row.lemma_norm,
        pos: row.pos,
        expected: row.senses,
        senses: r.changed && !retire ? r.senses : null,
        retire,
        lexicon_term_id: row.lexicon_term_id ?? termOf.get(x) ?? null,
        attempt: x.job.attempt,
        outcome: { ...r.outcome, retired: retire },
        model: b.model,
        prompt_version: REVIEW_PROMPT_VERSION,
        cost_usd: roundUsd(x.costUsd),
      };
    });
    for (const part of chunks(apply, 500)) {
      const res = await deps.store.applyReviews(part);
      report.stale += res.stale;
    }
    for (const a of apply) {
      report.rows++;
      const o = a.outcome;
      report.sensesKept += o.kept;
      report.sensesFixed += o.fixed.length;
      report.sensesDropped += o.dropped.length;
      if (a.retire) report.rowsRetired++;
      if (a.senses || a.retire) report.rowsChanged++;
      const lemma = a.lemma_norm;
      for (const f of o.fixed)
        sample({
          lemma,
          pos: a.pos,
          kind: 'fix',
          old: show(f.old),
          new: show(f.new),
          reason: f.reason,
        });
      for (const d of o.dropped)
        sample({
          lemma,
          pos: a.pos,
          kind: a.retire ? 'retire' : 'drop',
          old: show(d.old),
          new: null,
          reason: d.reason,
        });
    }

    // Groups the batch never answered: ask again.
    for (const [cid, group] of groups) {
      if (seen.has(cid)) continue;
      for (const j of group) requeue(j, j.attempt, 'missing from batch results');
    }
    for (const part of chunks(retry, 500)) await deps.store.upsertReviews(part);

    if (b.hold_id) await deps.store.settle(b.hold_id, roundUsd(batchCost));
    await deps.store.closeReviewBatch(b.id, roundUsd(batchCost));
    report.costUsd += batchCost;
    deps.log('word bank review batch collected', {
      batch_id: b.id,
      cost_usd: roundUsd(batchCost),
      rows: apply.length,
    });
  }
  report.costUsd = roundUsd(report.costUsd);
  return report;
}
