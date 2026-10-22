// @vitest-environment node
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import type { ImageRequestInput } from '../../supabase/functions/_shared/image-contract.ts';
import { callCostUsd } from '../../supabase/functions/_shared/image-models.ts';
import type { CalledMessage, Rendered } from '../../supabase/functions/_shared/image-pipeline.ts';
import type { QueuedRequest } from '../../supabase/functions/_shared/image-store.ts';
import type { VisualInput, VisualScore } from '../../supabase/functions/_shared/visual-prompt.ts';
import {
  DECLINED,
  drawing,
  PALE,
  verdict,
} from '../../supabase/functions/_shared/testing/image-fixtures.ts';
import { MemoryImageStore } from '../../supabase/functions/_shared/testing/memory-image-store.ts';
import {
  runCollect,
  runPilot,
  runSubmit,
  runVisualize,
  type BatchApi,
  type BatchResult,
  type JobDeps,
  type JobStore,
} from './image-jobs.ts';

const MODELS = { image: 'claude-opus-5-5', check: 'claude-haiku-5-5' };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const input = (n: number): ImageRequestInput => ({
  sense_id: id(n),
  lemma: `word${n}`,
  pos: 'noun',
  gloss_tr: `kelime${n}`,
  visual_hint: null,
});

type Req = QueuedRequest & { state: string; last_error?: string | null };

/** JobStore over the in-memory budget ledger and image list, with a request table. */
class FakeJobStore extends MemoryImageStore implements JobStore {
  readonly reqs = new Map<string, Req>();
  readonly statusChanges: { id: string; status: string; checks: Record<string, unknown> }[] = [];
  visual: VisualInput[] = [];
  readonly scores: VisualScore[] = [];
  autoQueued = 0;

  async releaseStale() {
    return 0;
  }
  async setImageStatus(
    imgId: string,
    status: 'review' | 'rejected',
    checks: Record<string, unknown>,
  ) {
    this.statusChanges.push({ id: imgId, status, checks });
    const img = this.images.find((i) => i.id === imgId);
    if (img) {
      img.status = status;
      img.checks = { ...img.checks, ...checks };
    }
  }
  async updateRequest(senseId: string, patch: Record<string, unknown>) {
    const r = this.reqs.get(senseId);
    if (r) this.reqs.set(senseId, { ...r, ...patch } as Req);
  }
  override async upsertRequest(
    senseId: string,
    patch: Record<string, unknown> & { state: string },
  ) {
    const base: Req = {
      sense_id: senseId,
      source: 'user',
      priority: 0,
      attempt: 1,
      problem: null,
      batch_id: null,
      hold_id: null,
      state: 'queued',
    };
    this.reqs.set(senseId, { ...base, ...this.reqs.get(senseId), ...patch } as Req);
    this.requests.set(senseId, { state: patch.state });
  }
  async queued(limit: number) {
    return [...this.reqs.values()]
      .filter((r) => r.state === 'queued')
      .sort((a, b) => b.priority - a.priority)
      .slice(0, limit);
  }
  async submitted() {
    return [...this.reqs.values()].filter((r) => r.state === 'submitted');
  }
  async queueAuto() {
    return this.autoQueued;
  }
  async pendingVision(limit: number) {
    return this.images
      .filter((i) => i.status === 'review' && i.checks.vision === 'pending')
      .slice(0, limit)
      .map((i) => ({ id: i.id, sense_id: i.sense_id, svg: i.svg, checks: i.checks }));
  }
  async visualPending(limit: number) {
    return this.visual.slice(0, limit);
  }
  async visualSet(items: VisualScore[]) {
    this.scores.push(...items);
    return items.length;
  }

  queue(n: number, o: Partial<Req> = {}) {
    this.senses.set(id(n), input(n));
    void this.upsertRequest(id(n), { state: 'queued', source: 'auto', ...o });
  }
}

/** A fake Message Batches API: create records the requests, results come from a script. */
class FakeBatches implements BatchApi {
  readonly created: { custom_id: string; params: Anthropic.MessageCreateParamsNonStreaming }[][] =
    [];
  status = 'ended';
  answers = new Map<string, BatchResult['result']>();
  failCreate = false;

  async create(
    requests: { custom_id: string; params: Anthropic.MessageCreateParamsNonStreaming }[],
  ) {
    if (this.failCreate) throw new Error('batch create failed');
    this.created.push(requests);
    return { id: `msgbatch_${this.created.length}` };
  }
  async retrieve(batchId: string) {
    return { id: batchId, processing_status: this.status };
  }
  async results(): Promise<AsyncIterable<BatchResult>> {
    const list = [...this.answers].map(([custom_id, result]) => ({ custom_id, result }));
    return (async function* () {
      yield* list;
    })();
  }
}

const ok = (m: CalledMessage): BatchResult['result'] => ({
  type: 'succeeded',
  message: m as unknown as Anthropic.Message,
});

const RENDER =
  (cov = 0.3): ((svg: string) => Rendered) =>
  () => ({
    light: { png: 'iVBORw0KGgoA', coverage: cov },
    dark: { png: 'iVBORw0KGgoA', coverage: cov },
  });

/** Claude for the vision checks (and visual-v1): answers in order. */
function scripted(...answers: CalledMessage[]) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const fn: JobDeps['claude'] = async (params) => {
    calls.push(params);
    const a = answers.shift();
    if (!a) throw new Error('unexpected call');
    return a;
  };
  return { fn, calls };
}

function jobDeps(
  store: FakeJobStore,
  batches: FakeBatches,
  claude: JobDeps['claude'],
  o: Partial<JobDeps> = {},
): JobDeps {
  return {
    store,
    claude,
    batches,
    models: MODELS,
    capUsd: 80,
    render: RENDER(),
    log: () => {},
    ...o,
  };
}

describe('submit', () => {
  it('reserves each request at batch price and sends one batch keyed by sense id', async () => {
    const store = new FakeJobStore();
    const batches = new FakeBatches();
    store.queue(1, { priority: 10 });
    store.queue(2, { priority: 3000, attempt: 2, problem: 'unclear' });
    const out = await runSubmit(jobDeps(store, batches, scripted().fn), { max: 10 });
    expect(out.submitted).toBe(2);
    expect(out.batchId).toBe('msgbatch_1');
    const reqs = batches.created[0]!;
    expect(reqs.map((r) => r.custom_id)).toEqual([id(2), id(1)]);
    // Batch requests cannot use the server-side fallback.
    for (const r of reqs) expect(JSON.stringify(r.params)).not.toContain('fallbacks');
    // The redraw carries its problem.
    expect(JSON.stringify(reqs[0]!.params.messages)).toContain('previous_problem');
    expect(store.ledger.holds.size).toBe(2);
    expect(store.ledger.reserved).toBeGreaterThan(0);
    expect(store.reqs.get(id(1))).toMatchObject({ state: 'submitted', batch_id: 'msgbatch_1' });
    expect(store.reqs.get(id(1))!.hold_id).toBeTruthy();
    expect(store.purposes).toEqual(['batch', 'batch']);
  });

  it('stops when the budget is used up and leaves the rest queued', async () => {
    const store = new FakeJobStore();
    const batches = new FakeBatches();
    for (let n = 1; n <= 5; n++) store.queue(n);
    // A cap that fits two requests: measure one first.
    const probe = new FakeJobStore();
    probe.queue(1);
    await runSubmit(jobDeps(probe, new FakeBatches(), scripted().fn), { max: 1 });
    const per = probe.ledger.reserved;
    const out = await runSubmit(jobDeps(store, batches, scripted().fn, { capUsd: per * 2.5 }), {
      max: 10,
    });
    expect(out).toMatchObject({ submitted: 2, stopped: 'budget' });
    expect([...store.reqs.values()].filter((r) => r.state === 'queued')).toHaveLength(3);
    expect(store.ledger.reserved).toBeLessThanOrEqual(per * 2.5);
  });

  it('releases every hold when the batch cannot be created', async () => {
    const store = new FakeJobStore();
    const batches = new FakeBatches();
    batches.failCreate = true;
    store.queue(1);
    store.queue(2);
    await expect(runSubmit(jobDeps(store, batches, scripted().fn), { max: 10 })).rejects.toThrow();
    expect(store.ledger.holds.size).toBe(0);
    expect(store.ledger.reserved).toBe(0);
    expect(store.ledger.spent).toBe(0);
    expect(store.reqs.get(id(1))!.state).toBe('queued');
  });

  it('does nothing on an empty queue', async () => {
    const store = new FakeJobStore();
    const batches = new FakeBatches();
    expect(await runSubmit(jobDeps(store, batches, scripted().fn), { max: 10 })).toMatchObject({
      submitted: 0,
      stopped: 'empty',
    });
    expect(batches.created).toHaveLength(0);
  });
});

describe('collect', () => {
  async function submittedPair() {
    const store = new FakeJobStore();
    const batches = new FakeBatches();
    store.queue(1);
    store.queue(2);
    await runSubmit(jobDeps(store, batches, scripted().fn), { max: 10 });
    return { store, batches };
  }

  it('settles at the real batch cost, checks and stores passing pictures as review', async () => {
    const { store, batches } = await submittedPair();
    const good = drawing();
    batches.answers.set(id(1), ok(good));
    batches.answers.set(id(2), ok(good));
    const claude = scripted(verdict(), verdict());
    const report = await runCollect(jobDeps(store, batches, claude.fn));
    expect(report.stored).toBe(2);
    expect(store.images.map((i) => i.status)).toEqual(['review', 'review']);
    expect(store.ledger.holds.size).toBe(0);
    const draw = callCostUsd(good.model!, good.usage, { batch: true });
    const check = callCostUsd('claude-haiku-5-5', verdict().usage);
    expect(store.ledger.spent).toBeCloseTo(2 * (draw + check), 6);
    expect(store.reqs.get(id(1))).toMatchObject({ state: 'done', batch_id: null, hold_id: null });
    expect(claude.calls).toHaveLength(2);
  });

  it('a failed check stores the rejected picture and queues one redraw; a second failure ends', async () => {
    const { store, batches } = await submittedPair();
    batches.answers.set(id(1), ok(PALE));
    batches.answers.set(id(2), ok(drawing()));
    const report = await runCollect(
      jobDeps(store, batches, scripted(verdict({ depicts_sense: false })).fn),
    );
    expect(report).toMatchObject({ rejected: 2, redraws: 2, stored: 0 });
    expect(store.reqs.get(id(1))).toMatchObject({
      state: 'queued',
      attempt: 2,
      problem: 'low_contrast',
    });
    expect(store.reqs.get(id(2))).toMatchObject({
      state: 'queued',
      attempt: 2,
      problem: 'wrong_meaning',
    });

    // Next night: the redraws go out and fail again.
    await runSubmit(jobDeps(store, batches, scripted().fn), { max: 10 });
    batches.answers.set(id(1), ok(PALE));
    batches.answers.set(id(2), ok(PALE));
    const second = await runCollect(jobDeps(store, batches, scripted().fn));
    expect(second).toMatchObject({ rejected: 2, redraws: 0 });
    expect(store.reqs.get(id(1))!.state).toBe('done');
    expect(store.images.filter((i) => i.status === 'rejected')).toHaveLength(4);
  });

  it('a declined or refused drawing skips the sense (not visual)', async () => {
    const { store, batches } = await submittedPair();
    batches.answers.set(id(1), ok(DECLINED));
    batches.answers.set(id(2), ok({ ...DECLINED, stop_reason: 'refusal', content: [] }));
    const report = await runCollect(jobDeps(store, batches, scripted().fn));
    expect(report.skipped).toBe(2);
    expect(store.images).toHaveLength(0);
    expect(store.reqs.get(id(1))!.state).toBe('skipped');
  });

  it('errored and missing results are released (no cost) and queued again', async () => {
    const { store, batches } = await submittedPair();
    batches.answers.set(id(1), { type: 'errored', error: { type: 'overloaded_error' } });
    const report = await runCollect(jobDeps(store, batches, scripted().fn));
    expect(report.retried).toBe(2);
    expect(store.ledger.spent).toBe(0);
    expect(store.ledger.holds.size).toBe(0);
    expect(store.reqs.get(id(1))).toMatchObject({ state: 'queued', batch_id: null, hold_id: null });
    expect(store.reqs.get(id(2))!.last_error).toBe('missing from batch results');
  });

  it('leaves a batch that has not ended alone', async () => {
    const { store, batches } = await submittedPair();
    batches.status = 'in_progress';
    const report = await runCollect(jobDeps(store, batches, scripted().fn));
    expect(report.batches).toEqual([{ id: 'msgbatch_1', status: 'in_progress' }]);
    expect(store.ledger.holds.size).toBe(2);
    expect(store.reqs.get(id(1))!.state).toBe('submitted');
  });

  it('runs the deferred vision check of instant pictures; one redraw at most', async () => {
    const store = new FakeJobStore();
    store.senses.set(id(1), input(1));
    store.senses.set(id(2), input(2));
    store.senses.set(id(3), input(3));
    const svg = (drawing().content[1] as { text: string }).text;
    const pic = JSON.parse(svg).svg as string;
    for (const [n, attempt] of [
      [1, 1],
      [2, 1],
      [3, 2],
    ] as const) {
      await store.insertImage({
        sense_id: id(n),
        svg: pic,
        alt_tr: 'şemsiye',
        status: 'review',
        checks: { vision: 'pending', attempt, confidence: 0.8 },
        model: 'claude-opus-5-5',
        prompt_version: 'image-v1',
        cost_usd: 0.05,
      });
    }
    const claude = scripted(verdict(), verdict({ has_text: true }), verdict({ clutter: true }));
    const report = await runCollect(jobDeps(store, new FakeBatches(), claude.fn));
    expect(report.visionChecked).toBe(3);
    expect(store.images.map((i) => i.status)).toEqual(['review', 'rejected', 'rejected']);
    expect(store.images[0]!.checks.vision).toMatchObject({ depicts_sense: true });
    expect(store.reqs.get(id(2))).toMatchObject({
      state: 'queued',
      attempt: 2,
      problem: 'has_text',
    });
    expect(store.reqs.has(id(3))).toBe(false);
    expect(report.redraws).toBe(1);
    // The alt text is never touched by the check.
    expect(store.statusChanges.every((c) => !('alt_tr' in c.checks))).toBe(true);
  });
});

describe('visualize', () => {
  it('scores in chunks of 50 inside the budget and stores the scores', async () => {
    const store = new FakeJobStore();
    store.visual = Array.from({ length: 60 }, (_, i) => ({
      sense_id: id(i + 1),
      lemma: `w${i}`,
      pos: 'noun',
      gloss_tr: `k${i}`,
    }));
    const answer = (count: number): CalledMessage => ({
      model: 'claude-haiku-5-5',
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            items: Array.from({ length: count }, (_, i) => ({
              n: i + 1,
              score: 3,
              hint: 'a thing',
            })),
          }),
        },
      ],
      usage: { input_tokens: 2000, output_tokens: 900 },
    });
    const claude = scripted(answer(50), answer(10));
    const out = await runVisualize(jobDeps(store, new FakeBatches(), claude.fn), { limit: 500 });
    expect(out).toMatchObject({ scored: 60, calls: 2, stopped: 'done' });
    expect(store.scores).toHaveLength(60);
    expect(store.purposes).toEqual(['visual', 'visual']);
    // Only lemma, pos and gloss go out: no sense ids.
    expect(JSON.stringify(claude.calls[0]!.messages)).not.toContain(id(1));
    expect(store.ledger.holds.size).toBe(0);
  });

  it('stops at the budget', async () => {
    const store = new FakeJobStore();
    store.visual = [{ sense_id: id(1), lemma: 'apple', pos: 'noun', gloss_tr: 'elma' }];
    const out = await runVisualize(
      jobDeps(store, new FakeBatches(), scripted().fn, { capUsd: 0.000001 }),
      {
        limit: 10,
      },
    );
    expect(out.stopped).toBe('budget');
    expect(store.scores).toHaveLength(0);
  });
});

describe('pilot', () => {
  it('scores unscored candidates, draws only visual ones synchronously and reports the cost', async () => {
    const store = new FakeJobStore();
    const cands = [1, 2, 3, 4].map((n) => {
      store.senses.set(id(n), input(n));
      return {
        sense_id: id(n),
        lemma: `word${n}`,
        pos: 'noun',
        gloss_tr: `kelime${n}`,
        visualizability: n === 1 ? 3 : null,
      };
    });
    const scores: CalledMessage = {
      model: 'claude-haiku-5-5',
      stop_reason: 'end_turn',
      // The three unscored ones, in the shuffled order (identity shuffle below): 2, 3, 4.
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            items: [
              { n: 1, score: 0, hint: '' },
              { n: 2, score: 3, hint: 'x' },
              { n: 3, score: 1, hint: '' },
            ],
          }),
        },
      ],
      usage: { input_tokens: 500, output_tokens: 100 },
    };
    // Picked: 1 (scored 3 before) and 3 (scored 3 now). Each: one drawing + one vision check.
    const claude = scripted(scores, drawing(), verdict(), drawing(), verdict());
    const calls: boolean[] = [];
    const wrapped: JobDeps['claude'] = (p, o) => {
      calls.push(o.fallback);
      return claude.fn(p, o);
    };
    const report = await runPilot(
      { store, claude: wrapped, models: MODELS, capUsd: 80, render: RENDER(), log: () => {} },
      cands,
      { n: 2, random: () => 0.999 },
    );
    expect(report.lines.map((l) => [l.lemma, l.outcome])).toEqual([
      ['word1', 'image'],
      ['word3', 'image'],
    ]);
    expect(store.images.map((i) => i.status)).toEqual(['review', 'review']);
    // Drawings use the server-side fallback; Haiku calls do not.
    expect(calls).toEqual([false, true, false, true, false]);
    expect(store.purposes).toEqual(['visual', 'pilot', 'check', 'pilot', 'check']);
    expect(report.totalCostUsd).toBeCloseTo(report.visualCostUsd + report.drawCostUsd, 6);
    expect(report.totalCostUsd).toBeCloseTo(store.ledger.spent, 6);
    expect(report.stopped).toBe('done');
  });
});
