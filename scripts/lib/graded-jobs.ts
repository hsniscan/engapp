// The graded library job (decision 0047, plan A.5), with its dependencies passed in so tests
// run it against fakes and recorded answers. CLI: scripts/graded-batch.ts; workflow:
// .github/workflows/graded.yml.
//
//   plan     the grid (level × topic × slot) against the slots the job already has: how many
//            texts are missing and what they would cost. No writes, no model calls.
//   submit   plans the missing slots (graded_jobs rows), then sends the queued writer
//            requests (graded-v1) and the queued checks (gradedcheck-v1) as Message Batches,
//            each after reserving its whole upper-bound cost on the monthly text budget
//            (halved until it fits; nothing is sent when nothing fits).
//   collect  reads finished batches and settles their real cost. A written text gets the
//            coverage check (graded-coverage.ts); it passes → stored as 'checking' and queued
//            for the checker; it fails → rewritten once with the words to avoid, then given up
//            (stored as 'rejected'). A checked text becomes 'approved' or 'rejected'.
//   report   counts per level, topic and status, the budget, the newest approved titles.
//
// Idempotent and resumable: a slot with a job is never planned again, a submitted request is
// read by the next collect, a batch is settled once (graded_batches.state).

import { createHash } from 'node:crypto';
import {
  callCostUsd,
  reserveUsd,
  roundUsd,
  tokenBound,
} from '../../supabase/functions/_shared/image-models.ts';
import type { CalledMessage } from '../../supabase/functions/_shared/image-pipeline.ts';
import {
  GRADED_CHECK_VERSION,
  GRADED_PROMPT_VERSION,
  gradedPlainText,
  type GradedLevel,
} from '../../supabase/functions/_shared/graded-contract.ts';
import {
  checkCoverage,
  profileObject,
  profileSentences,
  type CoverageReport,
  type LevelTable,
} from '../../supabase/functions/_shared/graded-coverage.ts';
import {
  reserveTextBudget,
  settleTextBudget,
  type TextBudget,
} from '../../supabase/functions/_shared/text-budget.ts';
import { ttsObjectPath, ttsRequest } from '../../supabase/functions/_shared/tts-contract.ts';
import type { BatchApi, BatchResult, Log } from './image-jobs.ts';
import { planMissing, type ExistingSlot, type PlanTargets } from './graded-plan.ts';
import {
  buildCheckRequest,
  buildWriterRequest,
  CHECK_MAX_TOKENS,
  CHECK_SYSTEM_PROMPT,
  GRADED_MAX_TOKENS,
  GRADED_SYSTEM_PROMPT,
  parseCheckAnswer,
  parseWriterAnswer,
  type CheckInput,
  type WriterInput,
  type WrittenText,
} from './graded-prompt.ts';

/** Writer answers per slot: the first and one rewrite (plan: regenerate once on failure). */
export const WRITER_MAX_ATTEMPTS = 2;
/** Checker answers that were not readable before the text is given up. */
export const CHECK_MAX_ATTEMPTS = 2;
/** Expected output tokens (thinking at effort low + JSON), per level, for estimates only. */
export const EXPECTED_WRITER_OUTPUT: Readonly<Record<GradedLevel, number>> = {
  A2: 1800,
  B1: 2400,
  B2: 3200,
  C1: 4200,
};
export const EXPECTED_CHECK_OUTPUT = 500;
/** Rewrite: at most this many hard words to avoid. */
const AVOID_MAX = 20;

export type Stage = 'write' | 'check';

/** graded_jobs.input */
export interface JobInput {
  item: WriterInput;
  check_attempts?: number;
}

export interface GradedJob {
  plan_key: string;
  level: string;
  topic: string;
  slot: number;
  stage: Stage;
  state: 'queued' | 'submitted' | 'done' | 'failed';
  attempt: number;
  batch_id: string | null;
  custom_id: string | null;
  input: JobInput;
  graded_id: string | null;
  last_error: string | null;
  cost_usd: number;
}

export interface BatchRow {
  id: string;
  stage: Stage;
  hold_id: string | null;
  reserved_usd: number;
  requests: number;
  model: string;
  prompt_version: string;
  state: 'submitted' | 'collected';
  cost_usd: number | null;
}

/** A text as the job stores it (public.graded_texts). */
export interface NewGradedText {
  plan_key: string;
  level: string;
  topic: string;
  title: string;
  body: string;
  sentences: { en: string; tr: string; audio_key: string | null; p: number }[];
  lemma_profile: Record<string, number>;
  coverage_by_level: Record<string, number>;
  glosses: { word: string; tr: string }[];
  target_lemmas: string[];
  words: number;
  tokens: number;
  cov_level: number;
  cov_next: number;
  above_unglossed: number;
  status: 'checking' | 'rejected';
  prompt_version: string;
  model: string;
  checks: Record<string, unknown>;
  cost_usd: number;
}

export interface TextForCheck {
  id: string;
  level: string;
  topic: string;
  title: string;
  sentences: { en: string; tr: string }[];
  checks: Record<string, unknown>;
  cost_usd: number;
}

export interface CellCounts {
  texts: { level: string; topic: string; status: string; n: number }[];
  jobs: { level: string; topic: string; stage: string; state: string; n: number }[];
}

/** What the job needs from the database (SupabaseGradedStore implements it). */
export interface GradedStore {
  jobs(): Promise<GradedJob[]>;
  upsertJobs(rows: GradedJob[]): Promise<void>;
  jobsOfBatch(batchId: string): Promise<GradedJob[]>;
  insertBatch(row: BatchRow): Promise<void>;
  openBatches(): Promise<BatchRow[]>;
  closeBatch(id: string, costUsd: number): Promise<void>;
  insertText(row: NewGradedText): Promise<string>;
  finishCheck(
    id: string,
    patch: { status: 'approved' | 'rejected'; check_model: string; checks: Record<string, unknown>; cost_usd: number },
  ): Promise<void>;
  textsForCheck(ids: string[]): Promise<TextForCheck[]>;
  cells(): Promise<CellCounts>;
  recentApproved(limit: number): Promise<{ level: string; topic: string; title: string }[]>;
}

export interface GradedModels {
  /** graded-v1 (CLAUDE_GRADED_MODEL; Sonnet by default). */
  writer: string;
  /** gradedcheck-v1 (CLAUDE_CHECK_MODEL; Haiku by default). */
  check: string;
}

export interface GradedDeps {
  store: GradedStore;
  budget: TextBudget;
  batches: BatchApi;
  models: GradedModels;
  levels: LevelTable;
  log: Log;
}

/** custom_id of a request: stable per slot, stage and attempt, within [a-zA-Z0-9_-]{1,64}. */
export function customIdOf(planKey: string, stage: Stage, attempt: number): string {
  const h = createHash('sha256').update(`${planKey}|${stage}|${attempt}`).digest('hex').slice(0, 40);
  return `${stage === 'write' ? 'gw' : 'gc'}_${h}`;
}

const chunks = <T>(xs: readonly T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

// ---------------------------------------------------------------------------
// costs
// ---------------------------------------------------------------------------

export function writerBoundUsd(model: string, w: WriterInput): number {
  return reserveUsd(model, {
    inputTokens: tokenBound(GRADED_SYSTEM_PROMPT + JSON.stringify(buildWriterRequest(w, { model }).messages)),
    maxTokens: GRADED_MAX_TOKENS[w.level],
    batch: true,
  });
}

export function writerExpectedUsd(model: string, w: WriterInput): number {
  const input = tokenBound(GRADED_SYSTEM_PROMPT + JSON.stringify(buildWriterRequest(w, { model }).messages));
  return callCostUsd(model, { input_tokens: input, output_tokens: EXPECTED_WRITER_OUTPUT[w.level] }, { batch: true });
}

export function checkBoundUsd(model: string, c: CheckInput): number {
  return reserveUsd(model, {
    inputTokens: tokenBound(CHECK_SYSTEM_PROMPT + JSON.stringify(buildCheckRequest(c, { model }).messages)),
    maxTokens: CHECK_MAX_TOKENS,
    batch: true,
  });
}

/** A check request's expected cost, from the text's length (the text is not written yet). */
export function checkExpectedUsd(model: string, level: GradedLevel): number {
  const input = Math.ceil((CHECK_SYSTEM_PROMPT.length + EXPECTED_WRITER_OUTPUT[level] * 3) / 3);
  return callCostUsd(model, { input_tokens: input, output_tokens: EXPECTED_CHECK_OUTPUT }, { batch: true });
}

// ---------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------

export interface PlanReport {
  /** Slots the grid wants that have no job yet. */
  missing: number;
  byLevel: Record<string, number>;
  /** Slots already planned, by state. */
  existing: Record<string, number>;
  estimatedUsd: number;
  upperBoundUsd: number;
}

const slotsOf = (jobs: readonly GradedJob[]): ExistingSlot[] =>
  jobs.map((j) => ({ plan_key: j.plan_key, level: j.level, topic: j.topic, slot: j.slot, state: j.state }));

export async function runPlan(
  deps: Pick<GradedDeps, 'store' | 'models'>,
  targets: PlanTargets,
): Promise<PlanReport> {
  const jobs = await deps.store.jobs();
  const missing = planMissing(targets, slotsOf(jobs));
  const report: PlanReport = {
    missing: missing.length,
    byLevel: {},
    existing: {},
    estimatedUsd: 0,
    upperBoundUsd: 0,
  };
  for (const j of jobs) {
    const k = `${j.stage}:${j.state}`;
    report.existing[k] = (report.existing[k] ?? 0) + 1;
  }
  for (const item of missing) {
    report.byLevel[item.level] = (report.byLevel[item.level] ?? 0) + 1;
    report.estimatedUsd += writerExpectedUsd(deps.models.writer, item) + checkExpectedUsd(deps.models.check, item.level);
    report.upperBoundUsd += writerBoundUsd(deps.models.writer, item);
  }
  report.estimatedUsd = roundUsd(report.estimatedUsd, 'up');
  report.upperBoundUsd = roundUsd(report.upperBoundUsd, 'up');
  return report;
}

// ---------------------------------------------------------------------------
// submit
// ---------------------------------------------------------------------------

export interface StageSubmit {
  queued: number;
  submitted: number;
  batchId: string | null;
  reservedUsd: number;
  estimatedUsd: number;
  stopped: 'done' | 'budget' | 'empty';
}

export interface SubmitReport {
  planned: number;
  write: StageSubmit;
  check: StageSubmit;
}

const emptyStage = (): StageSubmit => ({
  queued: 0,
  submitted: 0,
  batchId: null,
  reservedUsd: 0,
  estimatedUsd: 0,
  stopped: 'empty',
});

interface Prepared {
  job: GradedJob;
  params: ReturnType<typeof buildWriterRequest>;
  bound: number;
  expected: number;
}

/**
 * Reserves the whole batch on the text budget (halving the batch until it fits), sends it and
 * marks its jobs submitted. A failed send releases the hold at 0 (not billed).
 */
async function sendStage(
  deps: GradedDeps,
  stage: Stage,
  reqs: Prepared[],
  opts: { dryRun?: boolean },
): Promise<StageSubmit> {
  const out = emptyStage();
  out.queued = reqs.length;
  if (reqs.length === 0) return out;
  out.stopped = 'done';
  let picked = reqs;
  let hold: string | null = null;
  let amount = 0;
  while (picked.length > 0) {
    amount = roundUsd(
      picked.reduce((s, r) => s + r.bound, 0),
      'up',
    );
    if (opts.dryRun) break;
    hold = await reserveTextBudget(deps.budget, amount, stage === 'write' ? 'graded' : 'gradedcheck', {
      batch: true,
    });
    if (hold) break;
    out.stopped = 'budget';
    picked = picked.slice(0, Math.floor(picked.length / 2));
  }
  if (picked.length === 0) return out;
  out.reservedUsd = amount;
  out.estimatedUsd = roundUsd(
    picked.reduce((s, r) => s + r.expected, 0),
    'up',
  );
  out.submitted = picked.length;
  if (opts.dryRun) return out;

  const model = stage === 'write' ? deps.models.writer : deps.models.check;
  let batch: { id: string };
  try {
    batch = await deps.batches.create(
      picked.map((p) => ({ custom_id: p.job.custom_id!, params: p.params })),
    );
  } catch (e) {
    if (hold) await settleTextBudget(deps.budget, hold, 0);
    throw e;
  }
  await deps.store.insertBatch({
    id: batch.id,
    stage,
    hold_id: hold,
    reserved_usd: amount,
    requests: picked.length,
    model,
    prompt_version: stage === 'write' ? GRADED_PROMPT_VERSION : GRADED_CHECK_VERSION,
    state: 'submitted',
    cost_usd: null,
  });
  for (const part of chunks(picked, 500))
    await deps.store.upsertJobs(part.map((p) => ({ ...p.job, state: 'submitted', batch_id: batch.id })));
  out.batchId = batch.id;
  deps.log('graded batch submitted', {
    stage,
    batch_id: batch.id,
    requests: picked.length,
    reserved_usd: amount,
    estimated_usd: out.estimatedUsd,
  });
  return out;
}

const bySlot = (a: GradedJob, b: GradedJob) =>
  a.level.localeCompare(b.level) || a.topic.localeCompare(b.topic) || a.slot - b.slot;

export async function runSubmit(
  deps: GradedDeps,
  opts: { targets: PlanTargets; max: number; dryRun?: boolean },
): Promise<SubmitReport> {
  const jobs = await deps.store.jobs();
  const fresh: GradedJob[] = planMissing(opts.targets, slotsOf(jobs)).map((item) => ({
    plan_key: item.plan_key,
    level: item.level,
    topic: item.topic,
    slot: item.slot,
    stage: 'write',
    state: 'queued',
    attempt: 0,
    batch_id: null,
    custom_id: null,
    input: { item },
    graded_id: null,
    last_error: null,
    cost_usd: 0,
  }));
  if (!opts.dryRun) for (const part of chunks(fresh, 500)) await deps.store.upsertJobs(part);
  const all = [...jobs, ...fresh];

  const writes: Prepared[] = all
    .filter((j) => j.stage === 'write' && j.state === 'queued')
    .sort(bySlot)
    .slice(0, opts.max)
    .map((j) => {
      const job = { ...j, custom_id: customIdOf(j.plan_key, 'write', j.attempt) };
      const w = j.input.item;
      return {
        job,
        params: buildWriterRequest(w, { model: deps.models.writer }),
        bound: writerBoundUsd(deps.models.writer, w),
        expected: writerExpectedUsd(deps.models.writer, w),
      };
    });
  const write = await sendStage(deps, 'write', writes, opts);

  const checkJobs = all
    .filter((j) => j.stage === 'check' && j.state === 'queued' && j.graded_id)
    .sort(bySlot)
    .slice(0, opts.max);
  const texts = new Map(
    (checkJobs.length ? await deps.store.textsForCheck(checkJobs.map((j) => j.graded_id!)) : []).map((t) => [
      t.id,
      t,
    ]),
  );
  const checks: Prepared[] = [];
  for (const j of checkJobs) {
    const t = texts.get(j.graded_id!);
    if (!t) continue;
    const c: CheckInput = { level: t.level, topic: t.topic, title: t.title, sentences: t.sentences };
    const params = buildCheckRequest(c, { model: deps.models.check });
    checks.push({
      job: { ...j, custom_id: customIdOf(j.plan_key, 'check', j.input.check_attempts ?? 0) },
      params,
      bound: checkBoundUsd(deps.models.check, c),
      expected: callCostUsd(
        deps.models.check,
        { input_tokens: tokenBound(CHECK_SYSTEM_PROMPT + JSON.stringify(params.messages)), output_tokens: EXPECTED_CHECK_OUTPUT },
        { batch: true },
      ),
    });
  }
  const check = await sendStage(deps, 'check', checks, opts);
  return { planned: fresh.length, write, check };
}

// ---------------------------------------------------------------------------
// collect
// ---------------------------------------------------------------------------

export interface CollectReport {
  batches: { id: string; stage: Stage; status: string }[];
  /** Texts that passed the coverage check (now waiting for the checker). */
  written: number;
  rewrites: number;
  approved: number;
  rejected: number;
  retried: number;
  costUsd: number;
  problems: Record<string, number>;
}

/** Plain-text audio key of a sentence: the en-US clip the pre-generation makes (null: too long). */
export async function audioKeyOf(en: string): Promise<string | null> {
  return ttsRequest.safeParse({ text: en, voice: 'en-US' }).success ? ttsObjectPath('en-US', en) : null;
}

const countWords = (levels: LevelTable) => (sentences: string[]) => profileSentences(sentences, levels).words;

/** The stored row of a written text and its coverage report. */
export async function textRowOf(
  job: GradedJob,
  text: WrittenText,
  report: CoverageReport,
  profile: ReturnType<typeof profileSentences>,
  opts: { model: string; costUsd: number; status: 'checking' | 'rejected'; extra?: Record<string, unknown> },
): Promise<NewGradedText> {
  const sentences = await Promise.all(
    text.sentences.map(async (s) => ({ en: s.en, tr: s.tr, audio_key: await audioKeyOf(s.en), p: s.p })),
  );
  return {
    plan_key: job.plan_key,
    level: job.level,
    topic: job.topic,
    title: text.title,
    body: gradedPlainText(sentences),
    sentences,
    lemma_profile: profileObject(profile),
    coverage_by_level: report.byLevel,
    glosses: text.glosses,
    target_lemmas: text.target_lemmas,
    words: report.words,
    tokens: report.tokens,
    cov_level: report.covLevel,
    cov_next: report.covNext,
    above_unglossed: report.aboveUnglossed.length,
    status: opts.status,
    prompt_version: GRADED_PROMPT_VERSION,
    model: opts.model,
    checks: {
      coverage: {
        ok: report.ok,
        problems: report.problems,
        offenders: report.offenders.slice(0, 30),
        above_unglossed: report.aboveUnglossed.slice(0, 30),
        proper_nouns: profile.properNouns.slice(0, 30),
      },
      attempt: job.attempt + 1,
      ...opts.extra,
    },
    cost_usd: roundUsd(opts.costUsd),
  };
}

export async function runCollect(deps: GradedDeps): Promise<CollectReport> {
  const report: CollectReport = {
    batches: [],
    written: 0,
    rewrites: 0,
    approved: 0,
    rejected: 0,
    retried: 0,
    costUsd: 0,
    problems: {},
  };
  const problem = (p: string) => (report.problems[p] = (report.problems[p] ?? 0) + 1);

  for (const b of await deps.store.openBatches()) {
    const status = (await deps.batches.retrieve(b.id)).processing_status;
    report.batches.push({ id: b.id, stage: b.stage, status });
    if (status !== 'ended') continue;
    const jobs = new Map(
      (await deps.store.jobsOfBatch(b.id))
        .filter((j) => j.state === 'submitted' && j.stage === b.stage)
        .map((j) => [j.custom_id ?? '', j]),
    );
    const updates: GradedJob[] = [];
    const seen = new Set<string>();
    let batchCost = 0;
    for await (const res of (await deps.batches.results(b.id)) as AsyncIterable<BatchResult>) {
      const job = jobs.get(res.custom_id);
      if (!job || seen.has(res.custom_id)) continue;
      seen.add(res.custom_id);
      const back = { ...job, batch_id: null, state: 'queued' as const };
      if (res.result.type !== 'succeeded') {
        // Not billed: asked again in a later run, without counting an attempt.
        updates.push({ ...back, last_error: `batch ${res.result.type}` });
        report.retried++;
        continue;
      }
      const msg = res.result.message as unknown as CalledMessage;
      const cost = callCostUsd(msg.model ?? b.model, msg.usage, { batch: true });
      batchCost += cost;
      const model = msg.model ?? b.model;

      if (b.stage === 'write') {
        const attempt = job.attempt + 1;
        const w = job.input.item;
        const parsed = parseWriterAnswer(msg, w, countWords(deps.levels));
        let failure: string;
        let avoid: string[] = [];
        if (parsed.kind === 'ok') {
          const profile = profileSentences(
            parsed.text.sentences.map((s) => s.en),
            deps.levels,
          );
          const cov = checkCoverage(profile, w.level, new Set(parsed.text.glosses.map((g) => g.word)));
          if (cov.ok) {
            const id = await deps.store.insertText(
              await textRowOf(job, parsed.text, cov, profile, { model, costUsd: cost + job.cost_usd, status: 'checking' }),
            );
            updates.push({
              ...back,
              stage: 'check',
              attempt,
              graded_id: id,
              last_error: null,
              cost_usd: roundUsd(job.cost_usd + cost),
              input: { ...job.input, check_attempts: 0 },
            });
            report.written++;
            continue;
          }
          failure = cov.problems[0] ?? 'at_level';
          for (const p of cov.problems) problem(`coverage_${p}`);
          avoid = cov.offenders.slice(0, AVOID_MAX);
          if (attempt >= WRITER_MAX_ATTEMPTS) {
            await deps.store.insertText(
              await textRowOf(job, parsed.text, cov, profile, {
                model,
                costUsd: cost + job.cost_usd,
                status: 'rejected',
                extra: { rejected: 'coverage' },
              }),
            );
          }
        } else {
          failure = parsed.reason;
          problem(parsed.reason);
        }
        if (attempt >= WRITER_MAX_ATTEMPTS) {
          updates.push({ ...back, state: 'failed', attempt, last_error: failure, cost_usd: roundUsd(job.cost_usd + cost) });
          report.rejected++;
        } else {
          updates.push({
            ...back,
            attempt,
            last_error: failure,
            cost_usd: roundUsd(job.cost_usd + cost),
            input: { item: { ...w, avoid: [...new Set([...(w.avoid ?? []), ...avoid])].slice(0, AVOID_MAX), problem: failure } },
          });
          report.rewrites++;
        }
        continue;
      }

      // stage 'check'
      const parsed = parseCheckAnswer(msg);
      const tries = (job.input.check_attempts ?? 0) + 1;
      if (parsed.kind === 'invalid') {
        problem(`check_${parsed.reason}`);
        if (tries < CHECK_MAX_ATTEMPTS) {
          updates.push({
            ...back,
            last_error: `check ${parsed.reason}`,
            cost_usd: roundUsd(job.cost_usd + cost),
            input: { ...job.input, check_attempts: tries },
          });
          report.retried++;
          continue;
        }
        await deps.store.finishCheck(job.graded_id!, {
          status: 'rejected',
          check_model: model,
          checks: { checker: { invalid: parsed.reason } },
          cost_usd: cost,
        });
        updates.push({ ...back, state: 'failed', last_error: `check ${parsed.reason}`, cost_usd: roundUsd(job.cost_usd + cost) });
        report.rejected++;
        continue;
      }
      await deps.store.finishCheck(job.graded_id!, {
        status: parsed.approved ? 'approved' : 'rejected',
        check_model: model,
        checks: { checker: parsed.verdict, reasons: parsed.reasons },
        cost_usd: cost,
      });
      for (const r of parsed.reasons) problem(`check_${r}`);
      updates.push({
        ...back,
        state: parsed.approved ? 'done' : 'failed',
        last_error: parsed.approved ? null : parsed.reasons.join(',').slice(0, 500),
        cost_usd: roundUsd(job.cost_usd + cost),
        input: { ...job.input, check_attempts: tries },
      });
      if (parsed.approved) report.approved++;
      else report.rejected++;
    }

    // Requests the batch never answered: asked again.
    for (const [cid, job] of jobs) {
      if (seen.has(cid)) continue;
      updates.push({ ...job, state: 'queued', batch_id: null, last_error: 'missing from batch results' });
      report.retried++;
    }
    for (const part of chunks(updates, 500)) await deps.store.upsertJobs(part);
    if (b.hold_id) await settleTextBudget(deps.budget, b.hold_id, roundUsd(batchCost));
    await deps.store.closeBatch(b.id, roundUsd(batchCost));
    report.costUsd += batchCost;
    deps.log('graded batch collected', { stage: b.stage, batch_id: b.id, cost_usd: roundUsd(batchCost) });
  }
  report.costUsd = roundUsd(report.costUsd);
  return report;
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

export interface LibraryReport {
  byLevel: Record<string, { approved: number; checking: number; rejected: number }>;
  topics: number;
  approved: number;
  jobs: Record<string, number>;
  newest: { level: string; topic: string; title: string }[];
}

export async function runReport(deps: Pick<GradedDeps, 'store'>): Promise<LibraryReport> {
  const cells = await deps.store.cells();
  const byLevel: LibraryReport['byLevel'] = {};
  const topics = new Set<string>();
  let approved = 0;
  for (const c of cells.texts) {
    const l = (byLevel[c.level] ??= { approved: 0, checking: 0, rejected: 0 });
    if (c.status === 'approved' || c.status === 'checking' || c.status === 'rejected') l[c.status] += c.n;
    if (c.status === 'approved') {
      approved += c.n;
      topics.add(c.topic);
    }
  }
  const jobs: Record<string, number> = {};
  for (const j of cells.jobs) jobs[`${j.stage}:${j.state}`] = (jobs[`${j.stage}:${j.state}`] ?? 0) + j.n;
  return { byLevel, topics: topics.size, approved, jobs, newest: await deps.store.recentApproved(10) };
}
