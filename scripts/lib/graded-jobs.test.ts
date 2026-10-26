// @vitest-environment node
// The graded library job against fakes: recorded-style model answers (fixtures), an in-memory
// database, batch API and text budget. No network, no model calls (decision 0047).
import { readFileSync } from 'node:fs';
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { callCostUsd } from '../../supabase/functions/_shared/image-models.ts';
import { parseLevelTable } from '../../supabase/functions/_shared/graded-coverage.ts';
import { MemoryTextBudgetStore } from '../../supabase/functions/_shared/text-budget.ts';
import { ttsObjectPath } from '../../supabase/functions/_shared/tts-contract.ts';
import type { BatchApi, BatchResult } from './image-jobs.ts';
import {
  customIdOf,
  runCollect,
  runPlan,
  runReport,
  runSubmit,
  type BatchRow,
  type GradedDeps,
  type GradedJob,
  type GradedStore,
  type NewGradedText,
} from './graded-jobs.ts';
import { FIRST_PLAN, planItem } from './graded-plan.ts';
import {
  GRADED_SYSTEM_PROMPT,
  parseCheckAnswer,
  parseWriterAnswer,
  writerUserContent,
} from './graded-prompt.ts';

const WRITER = 'claude-sonnet-5-5';
const CHECKER = 'claude-haiku-5-5';
const levels = parseLevelTable(
  readFileSync(new URL('../../data/levels/client-levels.tsv', import.meta.url), 'utf8'),
);
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/graded/a2-travel-train.json', import.meta.url), 'utf8'),
) as { title: string; sentences: { en: string; tr: string; new_paragraph: boolean }[]; target_lemmas: string[]; glosses: [] };

/** A hard version of the fixture: well above A2. */
const hardFixture = {
  ...fixture,
  sentences: [
    ...fixture.sentences,
    {
      en: 'Nevertheless, the ubiquitous bureaucracy was an unprecedented predicament, notwithstanding their resilience and meticulous contingency arrangements.',
      tr: 'Yine de her yerde olan bürokrasi eşi görülmemiş bir çıkmazdı.',
      new_paragraph: false,
    },
  ],
};

const message = (model: string, body: unknown, usage = { input_tokens: 1500, output_tokens: 2000 }) =>
  ({
    id: 'msg_x',
    type: 'message',
    role: 'assistant',
    model,
    stop_reason: 'end_turn',
    stop_sequence: null,
    content: [{ type: 'text', text: JSON.stringify(body), citations: null }],
    usage,
  }) as unknown as Anthropic.Message;

const verdict = (over: Record<string, unknown> = {}) => ({
  natural: 5,
  level_fit: 'fits',
  translation_ok: true,
  safe: true,
  factual_ok: true,
  copyrighted: false,
  problems: [],
  ...over,
});

class FakeStore implements GradedStore {
  jobsMap = new Map<string, GradedJob>();
  batches = new Map<string, BatchRow>();
  texts = new Map<string, Omit<NewGradedText, 'status'> & { id: string; status: string; check_model?: string }>();
  private n = 0;
  async jobs() {
    return [...this.jobsMap.values()].map((j) => structuredClone(j));
  }
  async upsertJobs(rows: GradedJob[]) {
    for (const r of rows) {
      if (r.state === 'submitted' && !r.batch_id) throw new Error('a submitted job needs its batch');
      this.jobsMap.set(r.plan_key, structuredClone(r));
    }
  }
  async jobsOfBatch(id: string) {
    return [...this.jobsMap.values()].filter((j) => j.batch_id === id).map((j) => structuredClone(j));
  }
  async insertBatch(row: BatchRow) {
    this.batches.set(row.id, { ...row });
  }
  async openBatches() {
    return [...this.batches.values()].filter((b) => b.state === 'submitted');
  }
  async closeBatch(id: string, cost: number) {
    const b = this.batches.get(id)!;
    b.state = 'collected';
    b.cost_usd = cost;
  }
  async insertText(row: NewGradedText) {
    const id = `00000000-0000-4000-8000-${String(++this.n).padStart(12, '0')}`;
    this.texts.set(id, { ...structuredClone(row), id });
    return id;
  }
  async finishCheck(id: string, patch: { status: 'approved' | 'rejected'; check_model: string; checks: Record<string, unknown>; cost_usd: number }) {
    const t = this.texts.get(id)!;
    t.status = patch.status;
    t.check_model = patch.check_model;
    t.checks = { ...t.checks, ...patch.checks };
    t.cost_usd += patch.cost_usd;
  }
  async textsForCheck(ids: string[]) {
    return ids
      .map((id) => this.texts.get(id))
      .filter((t) => t && t.status === 'checking')
      .map((t) => ({ id: t!.id, level: t!.level, topic: t!.topic, title: t!.title, sentences: t!.sentences, checks: t!.checks, cost_usd: t!.cost_usd }));
  }
  async cells() {
    const texts = new Map<string, { level: string; topic: string; status: string; n: number }>();
    for (const t of this.texts.values()) {
      const k = `${t.level}|${t.topic}|${t.status}`;
      const c = texts.get(k) ?? { level: t.level, topic: t.topic, status: t.status, n: 0 };
      c.n++;
      texts.set(k, c);
    }
    return { texts: [...texts.values()], jobs: [] };
  }
  async recentApproved(limit: number) {
    return [...this.texts.values()].filter((t) => t.status === 'approved').slice(0, limit).map((t) => ({ level: t.level, topic: t.topic, title: t.title }));
  }
}

/** Batch API that answers each request with `answer(custom_id, params)`. */
class FakeBatches implements BatchApi {
  sent: { id: string; requests: { custom_id: string; params: Anthropic.MessageCreateParamsNonStreaming }[] }[] = [];
  status = 'ended';
  answer: (cid: string, p: Anthropic.MessageCreateParamsNonStreaming) => BatchResult['result'] = () => ({ type: 'expired' });
  async create(requests: { custom_id: string; params: Anthropic.MessageCreateParamsNonStreaming }[]) {
    const id = `msgbatch_${this.sent.length + 1}`;
    this.sent.push({ id, requests: structuredClone(requests) });
    return { id };
  }
  async retrieve(id: string) {
    return { id, processing_status: this.status };
  }
  async results(id: string): Promise<AsyncIterable<BatchResult>> {
    const b = this.sent.find((s) => s.id === id)!;
    const answer = this.answer;
    return (async function* () {
      for (const r of b.requests) yield { custom_id: r.custom_id, result: answer(r.custom_id, r.params) };
    })();
  }
}

function setup(cap = 10) {
  const store = new FakeStore();
  const batches = new FakeBatches();
  const budgetStore = new MemoryTextBudgetStore();
  const logs: string[] = [];
  const deps: GradedDeps = {
    store,
    batches,
    budget: { store: budgetStore, capUsd: cap },
    models: { writer: WRITER, check: CHECKER },
    levels,
    log: (m) => logs.push(m),
  };
  return { store, batches, budgetStore, deps };
}

/** Only A2 travel, 2 slots: small and fast. */
const SMALL = { levels: ['A2'] as const, perCell: 2, extendedPerCell: 0 };
const onlyTravel = (store: FakeStore) => {
  for (const [k, j] of store.jobsMap) if (j.topic !== 'travel') store.jobsMap.delete(k);
};

describe('graded-v1 prompt', () => {
  it('sends only the plan item: no user text (privacy snapshot)', () => {
    const w = { ...planItem('B1', 'travel', 3), avoid: ['predicament'], problem: 'at_level' };
    expect(JSON.parse(writerUserContent(w))).toEqual({
      level: 'B1',
      topic: expect.stringMatching(/^travel/),
      angle: 'a night in a strange old hotel',
      genre: w.genre,
      words: { min: 220, max: 350 },
      avoid: ['predicament'],
      note: 'A previous text was rejected because too many words were above the level. Avoid that.',
    });
    expect(GRADED_SYSTEM_PROMPT).toMatch(/no real news/);
    expect(GRADED_SYSTEM_PROMPT).toMatch(/no characters, plots/);
  });

  it('reads an answer into sentences with paragraphs and checked target words', () => {
    const p = parseWriterAnswer(message(WRITER, fixture), planItem('A2', 'travel', 0), (s) => s.join(' ').split(/\s+/).length);
    expect(p.kind).toBe('ok');
    if (p.kind !== 'ok') return;
    expect(p.text.sentences).toHaveLength(fixture.sentences.length);
    expect(new Set(p.text.sentences.map((s) => s.p))).toEqual(new Set([0, 1, 2, 3]));
    expect(p.text.target_lemmas).toContain('ticket');
  });

  it('rejects broken answers', () => {
    const w = planItem('A2', 'travel', 0);
    const words = (s: string[]) => s.join(' ').split(/\s+/).length;
    expect(parseWriterAnswer({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'nope' }] }, w, words)).toEqual({ kind: 'invalid', reason: 'not_json' });
    expect(parseWriterAnswer(message(WRITER, { ...fixture, sentences: fixture.sentences.slice(0, 3) }), w, words)).toEqual({ kind: 'invalid', reason: 'too_short' });
    expect(parseWriterAnswer(message(WRITER, { ...fixture, sentences: [{ en: 'Hello there.', tr: 'Hello there.', new_paragraph: true }] }), w, words)).toEqual({ kind: 'invalid', reason: 'not_translated' });
    expect(parseWriterAnswer({ stop_reason: 'refusal', content: [] }, w, words)).toEqual({ kind: 'invalid', reason: 'refusal' });
  });

  it('gradedcheck-v1 approves only when every check passes', () => {
    expect(parseCheckAnswer(message(CHECKER, verdict()))).toMatchObject({ kind: 'ok', approved: true });
    expect(parseCheckAnswer(message(CHECKER, verdict({ natural: 3 })))).toMatchObject({ approved: false, reasons: ['not_natural'] });
    expect(parseCheckAnswer(message(CHECKER, verdict({ copyrighted: true, level_fit: 'too_hard' })))).toMatchObject({
      approved: false,
      reasons: ['level_too_hard', 'copyrighted'],
    });
    expect(parseCheckAnswer(message(CHECKER, { natural: 5 }))).toEqual({ kind: 'invalid', reason: 'schema' });
  });
});

describe('graded job', () => {
  it('plan reads only and estimates the first 360 texts within the monthly cap', async () => {
    const { deps, store, batches } = setup();
    const r = await runPlan(deps, FIRST_PLAN);
    expect(r.missing).toBe(360);
    expect(r.byLevel).toEqual({ A2: 90, B1: 90, B2: 90, C1: 90 });
    expect(r.estimatedUsd).toBeGreaterThan(1);
    expect(r.estimatedUsd).toBeLessThan(10);
    expect(r.upperBoundUsd).toBeGreaterThan(r.estimatedUsd);
    expect(store.jobsMap.size).toBe(0);
    expect(batches.sent).toHaveLength(0);
  });

  it('a dry run sends nothing and reserves nothing', async () => {
    const { deps, store, batches, budgetStore } = setup();
    const r = await runSubmit(deps, { targets: FIRST_PLAN, max: 120, dryRun: true });
    expect(r.planned).toBe(360);
    expect(r.write.submitted).toBe(120);
    expect(batches.sent).toHaveLength(0);
    expect(store.jobsMap.size).toBe(0);
    expect(budgetStore.reserved).toBe(0);
  });

  it('submit reserves the batch on the text budget and halves it until it fits', async () => {
    const { deps, store, batches, budgetStore } = setup(1);
    const r = await runSubmit(deps, { targets: FIRST_PLAN, max: 120 });
    expect(r.planned).toBe(360);
    expect(r.write.stopped).toBe('budget');
    expect(r.write.submitted).toBeGreaterThan(0);
    expect(r.write.submitted).toBeLessThan(120);
    expect(budgetStore.reserved).toBe(r.write.reservedUsd);
    expect(budgetStore.reserved).toBeLessThanOrEqual(1);
    expect([...budgetStore.holds.values()][0]).toMatchObject({ purpose: 'graded', batch: true });
    expect(batches.sent[0]!.requests).toHaveLength(r.write.submitted);
    expect([...store.jobsMap.values()].filter((j) => j.state === 'submitted')).toHaveLength(r.write.submitted);
    // Model id from the deps (env), never hard-coded in the request builder.
    expect(batches.sent[0]!.requests[0]!.params.model).toBe(WRITER);
  });

  it('sends nothing when not even one request fits', async () => {
    const { deps, batches, budgetStore } = setup(10);
    budgetStore.spent = 9.999;
    const r = await runSubmit(deps, { targets: SMALL, max: 10 });
    expect(r.write).toMatchObject({ stopped: 'budget', submitted: 0 });
    expect(batches.sent).toHaveLength(0);
  });

  it('write → coverage → check → approved, settling the real cost', async () => {
    const { deps, store, batches, budgetStore } = setup();
    await runSubmit(deps, { targets: SMALL, max: 50 });
    expect(batches.sent[0]!.requests).toHaveLength(SMALL.perCell * 10);
    batches.answer = () => ({ type: 'succeeded', message: message(WRITER, fixture) });
    const c1 = await runCollect(deps);
    expect(c1.written).toBe(20);
    const real = callCostUsd(WRITER, { input_tokens: 1500, output_tokens: 2000 }, { batch: true });
    expect(budgetStore.spent).toBeCloseTo(real * 20, 6);
    expect(budgetStore.reserved).toBe(0);
    const text = [...store.texts.values()][0]!;
    expect(text.status).toBe('checking');
    expect(text.sentences[0]!.audio_key).toBe(await ttsObjectPath('en-US', fixture.sentences[0]!.en));
    expect(text.body.split('\n\n')).toHaveLength(4);
    expect(text.cov_level).toBeGreaterThanOrEqual(0.95);
    expect(text.lemma_profile.station).toBeGreaterThan(0);
    expect(text.lemma_profile.maria).toBeUndefined();
    expect([...store.jobsMap.values()].every((j) => j.stage === 'check' && j.state === 'queued')).toBe(true);

    const s2 = await runSubmit(deps, { targets: SMALL, max: 50 });
    expect(s2.planned).toBe(0);
    expect(s2.write.queued).toBe(0);
    expect(s2.check.submitted).toBe(20);
    expect(batches.sent[1]!.requests[0]!.params.model).toBe(CHECKER);
    const checkBody = JSON.parse(String(batches.sent[1]!.requests[0]!.params.messages[0]!.content));
    expect(Object.keys(checkBody).sort()).toEqual(['level', 'sentences', 'title', 'topic']);

    batches.answer = (cid) =>
      ({ type: 'succeeded', message: message(CHECKER, cid === customIdOf('A2|travel|1', 'check', 0) ? verdict({ safe: false }) : verdict(), { input_tokens: 2000, output_tokens: 300 }) });
    const c2 = await runCollect(deps);
    expect(c2.approved).toBe(19);
    expect(c2.rejected).toBe(1);
    expect([...store.texts.values()].filter((t) => t.status === 'approved')).toHaveLength(19);
    expect(store.jobsMap.get('A2|travel|1')).toMatchObject({ state: 'failed', last_error: 'unsafe' });
    expect(store.jobsMap.get('A2|travel|0')).toMatchObject({ state: 'done' });
    expect(budgetStore.reserved).toBe(0);
    expect(budgetStore.holds.size).toBe(0);

    const report = await runReport(deps);
    expect(report.approved).toBe(19);
    expect(report.topics).toBe(10);

    // The failed slot is planned again (next free slot number).
    const s3 = await runSubmit(deps, { targets: SMALL, max: 50, dryRun: true });
    expect(s3.planned).toBe(1);
  });

  it('a text that fails the coverage check is rewritten once with the words to avoid, then rejected', async () => {
    const { deps, store, batches } = setup();
    await runSubmit(deps, { targets: SMALL, max: 50 });
    onlyTravel(store);
    batches.answer = () => ({ type: 'succeeded', message: message(WRITER, hardFixture) });
    const c1 = await runCollect(deps);
    expect(c1.rewrites).toBe(2);
    expect(Object.keys(c1.problems).some((k) => k.startsWith('coverage_'))).toBe(true);
    const job = store.jobsMap.get('A2|travel|0')!;
    expect(job).toMatchObject({ stage: 'write', state: 'queued', attempt: 1 });
    expect(job.input.item.avoid).toEqual(expect.arrayContaining(['ubiquitous', 'bureaucracy']));
    expect(store.texts.size).toBe(0);

    await runSubmit(deps, { targets: { ...SMALL, levels: [] }, max: 50 });
    const rewrite = batches.sent[1]!.requests[0]!;
    expect(rewrite.custom_id).toBe(customIdOf('A2|travel|0', 'write', 1));
    expect(JSON.parse(String(rewrite.params.messages[0]!.content)).avoid).toContain('ubiquitous');
    const c2 = await runCollect(deps);
    expect(c2.rejected).toBe(2);
    expect(store.jobsMap.get('A2|travel|0')).toMatchObject({ state: 'failed', attempt: 2 });
    const stored = [...store.texts.values()];
    expect(stored).toHaveLength(2);
    expect(stored.every((t) => t.status === 'rejected')).toBe(true);
  });

  it('requests the batch did not answer are asked again without counting an attempt', async () => {
    const { deps, store, batches, budgetStore } = setup();
    await runSubmit(deps, { targets: SMALL, max: 50 });
    batches.answer = () => ({ type: 'errored' });
    const c = await runCollect(deps);
    expect(c.retried).toBe(20);
    expect([...store.jobsMap.values()].every((j) => j.state === 'queued' && j.attempt === 0)).toBe(true);
    expect(budgetStore.spent).toBe(0);
    expect(budgetStore.reserved).toBe(0);
  });

  it('leaves a batch that is still running for the next collect', async () => {
    const { deps, store, batches, budgetStore } = setup();
    await runSubmit(deps, { targets: SMALL, max: 50 });
    batches.status = 'in_progress';
    const c = await runCollect(deps);
    expect(c.batches[0]!.status).toBe('in_progress');
    expect(budgetStore.reserved).toBeGreaterThan(0);
    expect([...store.jobsMap.values()].every((j) => j.state === 'submitted')).toBe(true);
  });
});
