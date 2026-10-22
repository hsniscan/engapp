// The nightly picture jobs (decision 0030, docs/ai-image.md), with their dependencies passed
// in so tests run them against fakes. CLI: scripts/img-batch.ts and scripts/img-pilot.ts.
//
//   visualize  visual-v1 (Haiku) for senses never scored, stored on lexicon_senses
//   submit     queue the senses scoring >= VISUAL_AUTO_MIN, then send the queued requests as
//              one Message Batch (half price), reserving each request's upper bound first
//   collect    read finished batches: settle the real cost, sanitize, render, vision check,
//              store; one redraw (next night) after a failed check; also runs the vision check
//              of pictures the instant path stored with the check pending

import type Anthropic from '@anthropic-ai/sdk';
import {
  VISUAL_AUTO_MIN,
  type ImageRequestInput,
  type LexiconImageRow,
} from '../../supabase/functions/_shared/image-contract.ts';
import {
  callCostUsd,
  reserveUsd,
  roundUsd,
  tokenBound,
  type ImageModels,
} from '../../supabase/functions/_shared/image-models.ts';
import {
  drawReserveUsd,
  drawSense,
  evaluateDrawing,
  type BudgetPurpose,
  type ClaudeCall,
  type DrawOutcome,
  type NewImage,
  type PipelineDeps,
  type Render,
} from '../../supabase/functions/_shared/image-pipeline.ts';
import {
  buildImageRequest,
  isRedrawProblem,
  parseImageResponse,
  IMAGE_PROMPT_VERSION,
  type RedrawProblem,
} from '../../supabase/functions/_shared/image-prompt.ts';
import type { QueuedRequest } from '../../supabase/functions/_shared/image-store.ts';
import {
  buildVisualRequest,
  parseVisualResponse,
  VISUAL_BATCH,
  VISUAL_MAX_TOKENS,
  VISUAL_SYSTEM_PROMPT,
  type VisualInput,
  type VisualScore,
} from '../../supabase/functions/_shared/visual-prompt.ts';

export type Log = (msg: string, data?: Record<string, unknown>) => void;

/** What the jobs need from the database (SupabaseImageStore implements it). */
export interface JobStore {
  reserve(amountUsd: number, capUsd: number, purpose: BudgetPurpose): Promise<string | null>;
  settle(holdId: string, actualUsd: number): Promise<void>;
  releaseStale(olderThan?: string): Promise<number>;
  insertImage(row: NewImage): Promise<LexiconImageRow & { cost_usd: number }>;
  setImageStatus(
    id: string,
    status: 'review' | 'rejected',
    checks: Record<string, unknown>,
  ): Promise<void>;
  senseInputs(ids: string[]): Promise<ImageRequestInput[]>;
  updateRequest(senseId: string, patch: Record<string, unknown>): Promise<void>;
  upsertRequest(senseId: string, patch: Record<string, unknown> & { state: string }): Promise<void>;
  queued(limit: number): Promise<QueuedRequest[]>;
  submitted(): Promise<QueuedRequest[]>;
  queueAuto(min: number, limit: number): Promise<number>;
  pendingVision(
    limit: number,
  ): Promise<{ id: string; sense_id: string; svg: string; checks: Record<string, unknown> }[]>;
  visualPending(limit: number): Promise<VisualInput[]>;
  visualSet(items: VisualScore[]): Promise<number>;
}

/** The Message Batches API surface the jobs use (client.messages.batches). */
export interface BatchApi {
  create(
    requests: { custom_id: string; params: Anthropic.MessageCreateParamsNonStreaming }[],
  ): Promise<{ id: string }>;
  retrieve(id: string): Promise<{ id: string; processing_status: string }>;
  results(id: string): Promise<AsyncIterable<BatchResult>>;
}

export interface BatchResult {
  custom_id: string;
  result:
    | { type: 'succeeded'; message: Anthropic.Message }
    | { type: 'errored' | 'canceled' | 'expired'; error?: unknown };
}

export interface JobDeps {
  store: JobStore;
  claude: ClaudeCall;
  batches: BatchApi;
  models: ImageModels;
  capUsd: number;
  render: Render;
  log: Log;
}

// ---------------------------------------------------------------------------
// visualize
// ---------------------------------------------------------------------------

/** visual-v1 on one chunk (at most VISUAL_BATCH senses), inside the budget; stores the scores. */
export async function scoreChunk(
  deps: Pick<JobDeps, 'store' | 'claude' | 'models' | 'capUsd' | 'log'>,
  chunk: VisualInput[],
): Promise<{ scores: VisualScore[]; costUsd: number } | 'budget'> {
  const params = buildVisualRequest(chunk, { model: deps.models.check });
  const bound = reserveUsd(deps.models.check, {
    inputTokens: tokenBound(VISUAL_SYSTEM_PROMPT + JSON.stringify(params.messages)),
    maxTokens: VISUAL_MAX_TOKENS,
  });
  const hold = await deps.store.reserve(bound, deps.capUsd, 'visual');
  if (!hold) return 'budget';
  let cost = 0;
  let scores: VisualScore[] = [];
  try {
    const msg = await deps.claude(params, { fallback: false });
    cost = callCostUsd(msg.model ?? deps.models.check, msg.usage);
    scores = parseVisualResponse(msg, chunk);
  } finally {
    await deps.store.settle(hold, cost);
  }
  await deps.store.visualSet(scores);
  deps.log('visual chunk', { asked: chunk.length, scored: scores.length, cost_usd: cost });
  return { scores, costUsd: cost };
}

export async function runVisualize(
  deps: Pick<JobDeps, 'store' | 'claude' | 'models' | 'capUsd' | 'log'>,
  opts: { limit: number },
): Promise<{ scored: number; calls: number; costUsd: number; stopped: 'done' | 'budget' }> {
  const pending = await deps.store.visualPending(opts.limit);
  let scored = 0;
  let calls = 0;
  let cost = 0;
  for (let i = 0; i < pending.length; i += VISUAL_BATCH) {
    const out = await scoreChunk(deps, pending.slice(i, i + VISUAL_BATCH));
    if (out === 'budget') return { scored, calls, costUsd: roundUsd(cost), stopped: 'budget' };
    calls++;
    cost += out.costUsd;
    scored += out.scores.length;
  }
  return { scored, calls, costUsd: roundUsd(cost), stopped: 'done' };
}

// ---------------------------------------------------------------------------
// pilot
// ---------------------------------------------------------------------------

export interface PilotCandidate extends VisualInput {
  /** visual-v1 score when the sense was scored already. */
  visualizability: number | null;
}

export interface PilotLine {
  sense_id: string;
  lemma: string;
  pos: string;
  outcome: DrawOutcome['outcome'];
  attempts: number;
  problem?: string;
  image_id?: string;
  cost_usd: number;
}

export interface PilotReport {
  lines: PilotLine[];
  visualCostUsd: number;
  drawCostUsd: number;
  totalCostUsd: number;
  stopped: 'done' | 'budget' | 'few_candidates';
}

/**
 * The pilot: n random concrete senses, drawn synchronously one by one (instant path with the
 * renderer, so the vision check runs too), stored as 'review' for the owner to judge.
 * Candidates without a score are scored first; only scores >= VISUAL_AUTO_MIN are drawn.
 */
export async function runPilot(
  deps: Omit<JobDeps, 'batches'>,
  candidates: PilotCandidate[],
  opts: { n: number; random?: () => number },
): Promise<PilotReport> {
  const random = opts.random ?? Math.random;
  const pool = [...candidates];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const picked: string[] = [];
  let visualCost = 0;
  let stopped: PilotReport['stopped'] = 'done';
  for (let i = 0; i < pool.length && picked.length < opts.n; i += VISUAL_BATCH) {
    const chunk = pool.slice(i, i + VISUAL_BATCH);
    const score = new Map(chunk.map((c) => [c.sense_id, c.visualizability]));
    const unscored = chunk.filter((c) => c.visualizability == null);
    if (unscored.length > 0) {
      const out = await scoreChunk(
        deps,
        unscored.map(({ sense_id, lemma, pos, gloss_tr }) => ({ sense_id, lemma, pos, gloss_tr })),
      );
      if (out === 'budget') {
        stopped = 'budget';
        break;
      }
      visualCost += out.costUsd;
      for (const s of out.scores) score.set(s.sense_id, s.score);
    }
    for (const c of chunk) {
      if (picked.length < opts.n && (score.get(c.sense_id) ?? 0) >= VISUAL_AUTO_MIN)
        picked.push(c.sense_id);
    }
  }
  if (stopped === 'done' && picked.length < opts.n) stopped = 'few_candidates';

  // Inputs after scoring, so the drawings get the fresh visual hints.
  const inputs = new Map((await deps.store.senseInputs(picked)).map((i) => [i.sense_id, i]));
  const pipeline: PipelineDeps = {
    claude: deps.claude,
    models: deps.models,
    store: deps.store,
    capUsd: deps.capUsd,
    purpose: 'pilot',
    fallback: true,
    render: deps.render,
    passStatus: 'review',
    log: deps.log,
  };
  const lines: PilotLine[] = [];
  let drawCost = 0;
  for (const senseId of picked) {
    const input = inputs.get(senseId);
    if (!input) continue;
    const out = await drawSense(input, pipeline);
    drawCost += out.costUsd;
    const line: PilotLine = {
      sense_id: senseId,
      lemma: input.lemma,
      pos: input.pos,
      outcome: out.outcome,
      attempts: out.attempts,
      cost_usd: roundUsd(out.costUsd),
      ...(out.outcome === 'failed' ? { problem: out.problem } : {}),
      ...(out.outcome === 'image' ? { image_id: out.image.id } : {}),
    };
    lines.push(line);
    deps.log('pilot image', { ...line });
    if (out.outcome === 'budget') {
      stopped = 'budget';
      break;
    }
  }
  return {
    lines,
    visualCostUsd: roundUsd(visualCost),
    drawCostUsd: roundUsd(drawCost),
    totalCostUsd: roundUsd(visualCost + drawCost),
    stopped,
  };
}

// ---------------------------------------------------------------------------
// submit
// ---------------------------------------------------------------------------

export async function runSubmit(
  deps: Pick<JobDeps, 'store' | 'batches' | 'models' | 'capUsd' | 'log'>,
  opts: { max: number; queueLimit?: number },
): Promise<{
  queued: number;
  submitted: number;
  batchId: string | null;
  reservedUsd: number;
  stopped: 'done' | 'budget' | 'empty';
}> {
  await deps.store.releaseStale('1 hour');
  const queued = await deps.store.queueAuto(VISUAL_AUTO_MIN, opts.queueLimit ?? 2000);
  const rows = await deps.store.queued(opts.max);
  if (rows.length === 0)
    return { queued, submitted: 0, batchId: null, reservedUsd: 0, stopped: 'empty' };
  const inputs = new Map(
    (await deps.store.senseInputs(rows.map((r) => r.sense_id))).map((i) => [i.sense_id, i]),
  );
  const model = deps.models.image;
  const picked: {
    row: QueuedRequest;
    hold: string;
    params: Anthropic.MessageCreateParamsNonStreaming;
  }[] = [];
  let reserved = 0;
  let stopped: 'done' | 'budget' = 'done';
  for (const row of rows) {
    const input = inputs.get(row.sense_id);
    if (!input) {
      await deps.store.updateRequest(row.sense_id, {
        state: 'skipped',
        last_error: 'sense not found',
      });
      continue;
    }
    const amount = drawReserveUsd(model, input, { batch: true });
    const hold = await deps.store.reserve(amount, deps.capUsd, 'batch');
    if (!hold) {
      stopped = 'budget';
      break;
    }
    reserved += amount;
    const problem: RedrawProblem | null = isRedrawProblem(row.problem) ? row.problem : null;
    picked.push({ row, hold, params: buildImageRequest(input, { model, problem }) });
  }
  if (picked.length === 0) return { queued, submitted: 0, batchId: null, reservedUsd: 0, stopped };
  let batch: { id: string };
  try {
    batch = await deps.batches.create(
      picked.map((p) => ({ custom_id: p.row.sense_id, params: p.params })),
    );
  } catch (e) {
    for (const p of picked) await deps.store.settle(p.hold, 0);
    throw e;
  }
  for (const p of picked) {
    await deps.store.updateRequest(p.row.sense_id, {
      state: 'submitted',
      batch_id: batch.id,
      hold_id: p.hold,
      last_error: null,
    });
  }
  deps.log('batch submitted', {
    batch_id: batch.id,
    requests: picked.length,
    reserved_usd: roundUsd(reserved),
  });
  return {
    queued,
    submitted: picked.length,
    batchId: batch.id,
    reservedUsd: roundUsd(reserved, 'up'),
    stopped,
  };
}

// ---------------------------------------------------------------------------
// collect
// ---------------------------------------------------------------------------

export type CollectReport = {
  batches: { id: string; status: string }[];
  stored: number;
  rejected: number;
  redraws: number;
  skipped: number;
  retried: number;
  costUsd: number;
  visionChecked: number;
};

export async function runCollect(
  deps: JobDeps,
  opts: { visionLimit?: number } = {},
): Promise<CollectReport> {
  const report: CollectReport = {
    batches: [],
    stored: 0,
    rejected: 0,
    redraws: 0,
    skipped: 0,
    retried: 0,
    costUsd: 0,
    visionChecked: 0,
  };
  const submitted = await deps.store.submitted();
  const byBatch = new Map<string, QueuedRequest[]>();
  for (const r of submitted) {
    if (!r.batch_id) continue;
    byBatch.set(r.batch_id, [...(byBatch.get(r.batch_id) ?? []), r]);
  }
  for (const [batchId, rows] of byBatch) {
    const b = await deps.batches.retrieve(batchId);
    report.batches.push({ id: batchId, status: b.processing_status });
    if (b.processing_status !== 'ended') continue;
    const bySense = new Map(rows.map((r) => [r.sense_id, r]));
    const inputs = new Map(
      (await deps.store.senseInputs(rows.map((r) => r.sense_id))).map((i) => [i.sense_id, i]),
    );
    const seen = new Set<string>();
    for await (const res of await deps.batches.results(batchId)) {
      const row = bySense.get(res.custom_id);
      if (!row) continue;
      seen.add(row.sense_id);
      await collectOne(deps, row, inputs.get(row.sense_id), res, report);
    }
    // Requests the batch never answered: release the hold and queue them again.
    for (const row of rows) {
      if (seen.has(row.sense_id)) continue;
      if (row.hold_id) await deps.store.settle(row.hold_id, 0);
      await deps.store.updateRequest(row.sense_id, {
        state: 'queued',
        batch_id: null,
        hold_id: null,
        last_error: 'missing from batch results',
      });
      report.retried++;
    }
  }
  await checkPendingVision(deps, opts.visionLimit ?? 200, report);
  report.costUsd = roundUsd(report.costUsd);
  return report;
}

async function collectOne(
  deps: JobDeps,
  row: QueuedRequest,
  input: ImageRequestInput | undefined,
  res: BatchResult,
  report: CollectReport,
): Promise<void> {
  if (res.result.type !== 'succeeded') {
    // Errored/expired/canceled requests are not billed: release and try again next night.
    if (row.hold_id) await deps.store.settle(row.hold_id, 0);
    await deps.store.updateRequest(row.sense_id, {
      state: 'queued',
      batch_id: null,
      hold_id: null,
      last_error: `batch ${res.result.type}`,
    });
    report.retried++;
    return;
  }
  const msg = res.result.message;
  const drawCost = callCostUsd(msg.model ?? deps.models.image, msg.usage, { batch: true });
  if (row.hold_id) await deps.store.settle(row.hold_id, drawCost);
  report.costUsd += drawCost;
  if (!input) {
    await deps.store.updateRequest(row.sense_id, {
      state: 'skipped',
      batch_id: null,
      hold_id: null,
      last_error: 'sense not found',
    });
    report.skipped++;
    return;
  }
  const ev = await evaluateDrawing(input, parseImageResponse(msg), deps);
  const done = { batch_id: null, hold_id: null };
  if (ev.kind === 'declined') {
    await deps.store.updateRequest(row.sense_id, {
      ...done,
      state: 'skipped',
      last_error: ev.reason,
    });
    report.skipped++;
    return;
  }
  if (ev.kind === 'budget') {
    // Drawn but not checkable this month: draw again when the budget is back.
    await deps.store.updateRequest(row.sense_id, {
      ...done,
      state: 'queued',
      last_error: 'budget',
    });
    report.retried++;
    return;
  }
  report.costUsd += ev.checkCostUsd;
  const base = {
    sense_id: row.sense_id,
    svg: ev.svg,
    alt_tr: ev.alt_tr,
    model: msg.model ?? deps.models.image,
    prompt_version: IMAGE_PROMPT_VERSION,
    cost_usd: roundUsd(drawCost + ev.checkCostUsd),
  };
  if (ev.kind === 'pass') {
    await deps.store.insertImage({
      ...base,
      status: 'review',
      checks: { ...ev.checks, attempt: row.attempt, batch: true },
    });
    await deps.store.updateRequest(row.sense_id, { ...done, state: 'done', last_error: null });
    report.stored++;
    return;
  }
  await deps.store.insertImage({
    ...base,
    status: 'rejected',
    checks: { ...ev.checks, attempt: row.attempt, batch: true, problem: ev.problem },
  });
  report.rejected++;
  if (row.attempt < 2) {
    await deps.store.updateRequest(row.sense_id, {
      ...done,
      state: 'queued',
      attempt: 2,
      problem: ev.problem,
      last_error: ev.problem,
    });
    report.redraws++;
  } else {
    await deps.store.updateRequest(row.sense_id, {
      ...done,
      state: 'done',
      last_error: `rejected: ${ev.problem}`,
    });
  }
}

/** Vision check of pictures the instant path stored with the check pending. */
async function checkPendingVision(
  deps: JobDeps,
  limit: number,
  report: CollectReport,
): Promise<void> {
  const rows = await deps.store.pendingVision(limit);
  if (rows.length === 0) return;
  const inputs = new Map(
    (await deps.store.senseInputs([...new Set(rows.map((r) => r.sense_id))])).map((i) => [
      i.sense_id,
      i,
    ]),
  );
  for (const r of rows) {
    const input = inputs.get(r.sense_id);
    if (!input) continue;
    const ev = await evaluateDrawing(
      input,
      // alt_tr is not re-checked (and not written back): the stored row keeps its own.
      {
        kind: 'image',
        image: { svg: r.svg, alt_tr: '-', confidence: Number(r.checks.confidence ?? 0.5) },
      },
      deps,
    );
    if (ev.kind === 'budget') return;
    if (ev.kind === 'declined') continue;
    report.visionChecked++;
    report.costUsd += ev.checkCostUsd;
    const checks = {
      vision: ev.checks.vision ?? null,
      coverage: ev.checks.coverage ?? null,
      vision_cost_usd: ev.checkCostUsd,
    };
    if (ev.kind === 'pass') {
      await deps.store.setImageStatus(r.id, 'review', checks);
    } else {
      await deps.store.setImageStatus(r.id, 'rejected', { ...checks, problem: ev.problem });
      report.rejected++;
      // One redraw per sense: a picture that already was the redraw stays rejected.
      if (Number(r.checks.attempt ?? 1) < 2) {
        await deps.store.upsertRequest(r.sense_id, {
          state: 'queued',
          attempt: 2,
          problem: ev.problem,
          batch_id: null,
          hold_id: null,
        });
        report.redraws++;
      }
    }
  }
}
