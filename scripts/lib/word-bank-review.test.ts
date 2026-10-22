// @vitest-environment node
// The word-bank review pass (decision 0040) against fakes: scripted model answers in the API's
// shape, an in-memory bank and batch API. No network, no model calls.
import { readFileSync } from 'node:fs';
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { isSameMeaningTr } from '../../supabase/functions/_shared/text.ts';
import type { WordBankSense } from '../../supabase/functions/_shared/wordbank-contract.ts';
import type { BatchApi, BatchResult } from './image-jobs.ts';
import type { LexiconItem } from './word-bank-jobs.ts';
import {
  buildReviewRequest,
  parseReviewAnswer,
  REVIEW_GROUP_SIZE,
  REVIEW_PROMPT_VERSION,
  REVIEW_RESPONSE_SCHEMA,
  REVIEW_SYSTEM_PROMPT,
  reviewUserContent,
  type ReviewChange,
} from './word-bank-review-prompt.ts';
import {
  REVIEW_LOG_SAMPLES,
  REVIEW_MAX_ATTEMPTS,
  reviewBoundUsd,
  reviewCustomId,
  reviewExpectedUsd,
  reviewRow,
  runReviewCollect,
  runReviewSubmit,
  type ReviewApplyRow,
  type ReviewBatchRow,
  type ReviewDeps,
  type ReviewJobRow,
  type ReviewPending,
  type ReviewStore,
} from './word-bank-review.ts';

const MODEL = 'claude-sonnet-5-5';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S = (meaning_tr: string, example_en: string, example_tr: string, id: number | null = null) =>
  ({ meaning_tr, example_en, example_tr, sense_id: id === null ? null : uid(id) }) as WordBankSense;

interface BankRow extends ReviewPending {
  retired: boolean;
  seq: number;
}

const bank = (lemma: string, pos: string, senses: WordBankSense[], cefr = 'B1'): BankRow => ({
  lemma_norm: lemma.toLowerCase(),
  pos,
  lemma,
  cefr,
  list_source: 'cefrj',
  zipf: 4,
  lexicon_term_id: uid(900),
  senses,
  attempt: 0,
  problem: null,
  retired: false,
  seq: 1,
});

class FakeStore implements ReviewStore {
  rows = new Map<string, BankRow>();
  reviews = new Map<string, ReviewJobRow & Partial<ReviewApplyRow>>();
  batches = new Map<string, ReviewBatchRow>();
  lexicon: { term_id: string; lemma_norm: string; id: string; pos: string; meaning_tr: string }[] =
    [];
  upserts: LexiconItem[] = [];
  cap = { spent: 0, reserved: 0 };
  holds = new Map<string, number>();
  private n = 1000;
  private seq = 100;

  add(...rows: BankRow[]) {
    for (const r of rows) this.rows.set(`${r.lemma_norm}|${r.pos}`, structuredClone(r));
  }
  async reviewPending(limit: number) {
    return [...this.rows.values()]
      .filter((r) => {
        const v = this.reviews.get(`${r.lemma_norm}|${r.pos}`);
        return !r.retired && (!v || v.state === 'queued');
      })
      .map((r) => {
        const v = this.reviews.get(`${r.lemma_norm}|${r.pos}`);
        const { retired: _r, seq: _s, ...rest } = structuredClone(r);
        return { ...rest, attempt: v?.attempt ?? 0, problem: v?.last_error ?? null };
      })
      .slice(0, limit);
  }
  async upsertReviews(rows: ReviewJobRow[]) {
    for (const r of rows) this.reviews.set(`${r.lemma_norm}|${r.pos}`, structuredClone(r));
  }
  async reviewsOfBatch(id: string) {
    return [...this.reviews.values()]
      .filter((j) => j.batch_id === id)
      .map((j) => structuredClone(j) as ReviewJobRow);
  }
  async insertReviewBatch(row: ReviewBatchRow) {
    this.batches.set(row.id, { ...row });
  }
  async openReviewBatches() {
    return [...this.batches.values()].filter((b) => b.state === 'submitted');
  }
  async closeReviewBatch(id: string, cost: number) {
    const b = this.batches.get(id)!;
    b.state = 'collected';
    b.cost_usd = cost;
  }
  /** public.word_bank_review_apply: change only rows that still have the reviewed senses. */
  async applyReviews(rows: ReviewApplyRow[]) {
    const out = { changed: 0, retired: 0, stale: 0 };
    for (const x of rows) {
      const k = `${x.lemma_norm}|${x.pos}`;
      const cur = this.rows.get(k);
      if (!cur) continue;
      if (cur.retired || JSON.stringify(cur.senses) !== JSON.stringify(x.expected)) {
        const v = this.reviews.get(k);
        this.reviews.set(k, {
          ...(v ?? { lemma_norm: x.lemma_norm, pos: x.pos, attempt: 0 }),
          state: 'queued',
          batch_id: null,
          custom_id: null,
          input: null,
          last_error: 'stale',
        });
        out.stale++;
        continue;
      }
      if (x.retire) {
        cur.retired = true;
        cur.seq = ++this.seq;
        out.retired++;
      } else if (x.senses && JSON.stringify(x.senses) !== JSON.stringify(cur.senses)) {
        cur.senses = structuredClone(x.senses);
        cur.lexicon_term_id ??= x.lexicon_term_id;
        cur.seq = ++this.seq;
        out.changed++;
      }
      this.reviews.set(k, {
        ...structuredClone(x),
        state: 'done',
        batch_id: null,
        custom_id: null,
        last_error: null,
        input: null,
      });
    }
    return out;
  }
  async lexiconUpsert(items: LexiconItem[]) {
    this.upserts.push(...items);
    return items.map((it) => {
      let s = this.lexicon.find(
        (x) =>
          x.lemma_norm === it.lemma_norm &&
          x.pos === it.pos &&
          isSameMeaningTr(x.meaning_tr, it.meaning_tr),
      );
      if (!s) {
        s = {
          term_id: uid(900),
          lemma_norm: it.lemma_norm,
          id: uid(this.n++),
          pos: it.pos,
          meaning_tr: it.meaning_tr,
        };
        this.lexicon.push(s);
      }
      return { term_id: s.term_id, sense_id: s.id };
    });
  }
  async reserve(amount: number, capUsd: number) {
    if (this.cap.spent + this.cap.reserved + amount > capUsd) return null;
    this.cap.reserved += amount;
    const id = uid(this.n++);
    this.holds.set(id, amount);
    return id;
  }
  async settle(hold: string, actual: number) {
    this.cap.reserved -= this.holds.get(hold) ?? 0;
    this.holds.delete(hold);
    this.cap.spent += actual;
  }
}

class FakeBatches implements BatchApi {
  created: { custom_id: string; params: Anthropic.MessageCreateParamsNonStreaming }[][] = [];
  status = 'in_progress';
  answers = new Map<string, BatchResult['result']>();
  async create(
    requests: { custom_id: string; params: Anthropic.MessageCreateParamsNonStreaming }[],
  ) {
    this.created.push(requests);
    return { id: `msgbatch_r${this.created.length}` };
  }
  async retrieve(id: string) {
    return { id, processing_status: this.status };
  }
  async results(): Promise<AsyncIterable<BatchResult>> {
    const list = [...this.answers].map(([custom_id, result]) => ({ custom_id, result }));
    return (async function* () {
      yield* list;
    })();
  }
}

const USAGE = { input_tokens: 3000, output_tokens: 300 };

function answer(json: unknown, stop_reason = 'end_turn'): BatchResult['result'] {
  return {
    type: 'succeeded',
    message: {
      id: 'msg_x',
      type: 'message',
      role: 'assistant',
      model: MODEL,
      stop_reason,
      content: [{ type: 'text', text: typeof json === 'string' ? json : JSON.stringify(json) }],
      usage: USAGE,
    } as unknown as Anthropic.Message,
  };
}

const change = (
  word: number,
  meaning: number,
  action: 'fix' | 'drop',
  p: Partial<
    Record<'meaning_tr' | 'gloss_en' | 'example_en' | 'example_tr' | 'reason', string>
  > = {},
) => ({
  word,
  meaning,
  action,
  meaning_tr: p.meaning_tr ?? '',
  gloss_en: p.gloss_en ?? '',
  example_en: p.example_en ?? '',
  example_tr: p.example_tr ?? '',
  reason: p.reason ?? 'wrong',
});

const fix = (sense: number, p: Partial<ReviewChange>): ReviewChange => ({
  sense,
  action: 'fix',
  meaning_tr: '',
  gloss_en: '',
  example_en: '',
  example_tr: '',
  reason: 'wrong',
  ...p,
});

function setup(cap = 80) {
  const store = new FakeStore();
  const batches = new FakeBatches();
  const logs: string[] = [];
  const deps: ReviewDeps = { store, batches, model: MODEL, capUsd: cap, log: (m) => logs.push(m) };
  return { store, batches, deps, logs };
}

/** The by-eye findings of the first bank run, plus rows that are fine. */
function seed(store: FakeStore) {
  store.add(
    bank(
      'scythe',
      'noun',
      [
        S(
          'ölüm meleği',
          'The farmer cut the grass with a scythe.',
          'Çiftçi otu tırpanla kesti.',
          1,
        ),
      ],
      'C1',
    ),
    bank('arena', 'noun', [
      S('arena', 'The concert was in a big arena.', 'Things: iş dünyasına girmek istiyor', 2),
    ]),
    bank('relative', 'noun', [
      S('akraba', 'All my relatives came to the wedding.', 'Bütün akrabalarım düğüne geldi.', 3),
      S('yakın', 'She visits her relatives every summer.', 'Her yaz akrabalarını ziyaret eder.', 4),
    ]),
    bank(
      'the',
      'determiner',
      [S('her, her bir', 'The sun rises in the east.', 'Güneş doğudan doğar.', 5)],
      'A1',
    ),
    bank(
      'mutable',
      'adjective',
      [S('değişebilir', 'Plans are mutable.', 'Planlar değişebilir.', 6)],
      'C2',
    ),
  );
}

describe('review prompt', () => {
  it('sends only the words, their part of speech, level and meanings, numbered', () => {
    const rows = [
      bank('scythe', 'noun', [S('ölüm meleği', 'A scythe.', 'Bir tırpan.', 1)], 'C1'),
      bank('relative', 'noun', [
        S('akraba', 'My relatives.', 'Akrabalarım.'),
        S('yakın', 'A relative.', 'Bir akraba.'),
      ]),
    ];
    expect(reviewUserContent(rows)).toBe(
      [
        '1. scythe (noun, C1)',
        '  1) ölüm meleği | A scythe. | Bir tırpan.',
        '2. relative (noun, B1)',
        '  1) akraba | My relatives. | Akrabalarım.',
        '  2) yakın | A relative. | Bir akraba.',
      ].join('\n'),
    );
    expect(reviewUserContent([{ ...rows[0]!, problem: 'example_without_word' }])).toContain(
      'note: a previous correction was rejected because a corrected example did not contain the word',
    );
    // No ids, no bookkeeping, no user data in the request.
    const req = buildReviewRequest(rows, { model: MODEL });
    expect(JSON.stringify(req.messages)).not.toContain(uid(1));
    expect(req).toMatchObject({
      model: MODEL,
      thinking: { type: 'between_tools' },
      output_config: { effort: 'low', format: { type: 'json_schema' } },
    });
    expect(req.system).toEqual([
      { type: 'text', text: REVIEW_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ]);
    expect(buildReviewRequest(rows, { model: 'claude-opus-5-5' }).thinking).toEqual({
      type: 'adaptive',
    });
    // The schema the API enforces matches the parser.
    expect(REVIEW_RESPONSE_SCHEMA.properties.changes.items.required).toContain('reason');
    expect(REVIEW_SYSTEM_PROMPT).toContain('davet, davetiye');
  });

  it('parses changes, ignores unknown words and meanings and repeated changes', () => {
    const rows = [{ senses: [1, 2] }, { senses: [1] }];
    const msg = answer({
      changes: [
        change(1, 2, 'drop', { reason: ' same  as 1 ' }),
        change(1, 2, 'fix', { meaning_tr: 'x' }),
        change(2, 1, 'fix', { meaning_tr: 'tırpan ,  orak', gloss_en: 'a tool' }),
        change(3, 1, 'drop'),
        change(2, 2, 'drop'),
      ],
    });
    const p = parseReviewAnswer((msg as unknown as { message: never }).message, rows);
    expect(p.kind).toBe('ok');
    if (p.kind !== 'ok') return;
    expect(p.unknown).toBe(2);
    expect(p.changes.get(0)).toEqual([
      {
        sense: 1,
        action: 'drop',
        meaning_tr: '',
        gloss_en: '',
        example_en: '',
        example_tr: '',
        reason: 'same as 1',
      },
    ]);
    expect(p.changes.get(1)![0]!.meaning_tr).toBe('tırpan, orak');
  });

  it('rejects broken answers', () => {
    const m = (j: unknown, stop?: string) =>
      (answer(j, stop) as unknown as { message: never }).message;
    expect(parseReviewAnswer(m('not json'), [])).toEqual({ kind: 'invalid', reason: 'not_json' });
    expect(parseReviewAnswer(m({ changes: [{ word: 1 }] }), [])).toEqual({
      kind: 'invalid',
      reason: 'schema',
    });
    expect(parseReviewAnswer(m({ changes: [] }, 'max_tokens'), [])).toEqual({
      kind: 'invalid',
      reason: 'max_tokens',
    });
    expect(parseReviewAnswer(m({ changes: [] }, 'refusal'), [])).toEqual({
      kind: 'invalid',
      reason: 'refusal',
    });
    expect(parseReviewAnswer(m({ changes: [] }), [])).toEqual({
      kind: 'ok',
      changes: new Map(),
      unknown: 0,
    });
  });
});

describe('reviewRow (apply one row)', () => {
  const scythe = bank('scythe', 'noun', [
    S('ölüm meleği', 'The farmer cut the grass with a scythe.', 'Çiftçi otu tırpanla kesti.', 1),
  ]);

  it('keeps a row without changes', () => {
    const r = reviewRow(scythe, []);
    expect(r).toMatchObject({ changed: false, senses: scythe.senses, newMeanings: [] });
    expect(r.outcome).toMatchObject({
      kept: 1,
      fixed: [],
      dropped: [],
      rejected: [],
      retired: false,
    });
  });

  it('a changed meaning needs an English definition and becomes a new lexicon sense', () => {
    const r = reviewRow(scythe, [
      fix(0, { meaning_tr: 'tırpan', gloss_en: 'a tool with a long curved blade' }),
    ]);
    expect(r.changed).toBe(true);
    expect(r.senses[0]).toEqual({ ...scythe.senses[0], meaning_tr: 'tırpan', sense_id: null });
    expect(r.newMeanings).toEqual([
      {
        index: 0,
        meaning_tr: 'tırpan',
        gloss_en: 'a tool with a long curved blade',
        gloss_key: expect.any(String),
      },
    ]);
    expect(reviewRow(scythe, [fix(0, { meaning_tr: 'tırpan' })]).outcome.rejected).toEqual([
      'gloss_en_unfit',
    ]);
  });

  it('an example fix keeps the lexicon link; the generation checks apply', () => {
    const arena = bank('arena', 'noun', [
      S('arena', 'The concert was in a big arena.', 'Things: iş dünyasına girmek istiyor', 2),
    ]);
    const ok = reviewRow(arena, [fix(0, { example_tr: 'Konser büyük bir arenadaydı.' })]);
    expect(ok.senses[0]).toEqual({
      ...arena.senses[0],
      example_tr: 'Konser büyük bir arenadaydı.',
    });
    expect(ok.newMeanings).toEqual([]);
    const bad = (p: Partial<ReviewChange>) => reviewRow(arena, [fix(0, p)]).outcome.rejected;
    expect(bad({ example_en: 'The concert hall was big.', example_tr: 'Salon büyüktü.' })).toEqual([
      'example_without_word',
    ]);
    expect(bad({ example_en: 'We went to the arena.' })).toEqual(['example_tr_missing']);
    expect(bad({ example_tr: 'The concert was in a big arena.' })).toEqual([
      'example_not_translated',
    ]);
    expect(bad({ meaning_tr: 'arena (spor)', gloss_en: 'a place for sports' })).toEqual([
      'meaning_tr_unfit',
    ]);
    // A rejected fix leaves the meaning as it was.
    expect(reviewRow(arena, [fix(0, { example_tr: '<b>x</b>' })]).senses).toEqual(arena.senses);
  });

  it('a fix that changes nothing counts as kept', () => {
    const r = reviewRow(scythe, [fix(0, { meaning_tr: 'Ölüm meleği' })]);
    expect(r).toMatchObject({ changed: false, outcome: { kept: 1, fixed: [] } });
  });

  it('drops redundant meanings, also near-duplicates a fix creates', () => {
    const inv = bank('invitation', 'noun', [
      S('davet, davetiye', 'Thanks for the invitation.', 'Davet için teşekkürler.', 7),
      S('çağrı', 'I got an invitation to the party.', 'Partiye bir davetiye aldım.', 8),
    ]);
    const r = reviewRow(inv, [fix(1, { meaning_tr: 'davet', gloss_en: 'a request to come' })]);
    expect(r.senses).toEqual([inv.senses[0]]);
    expect(r.outcome.fixed).toEqual([]);
    expect(r.outcome.dropped).toEqual([
      { sense: 1, old: inv.senses[1], reason: 'duplicate meaning' },
    ]);
    expect(r.newMeanings).toEqual([]);
  });

  it('a row with every meaning dropped is retired', () => {
    const r = reviewRow(scythe, [{ ...fix(0, {}), action: 'drop' }]);
    expect(r).toMatchObject({ senses: [], changed: true, outcome: { retired: true } });
  });
});

describe('review submit', () => {
  it('dry run: counts, groups and cost, nothing reserved or sent', async () => {
    const { store, batches, deps } = setup();
    seed(store);
    const r = await runReviewSubmit(deps, { max: 100, dryRun: true });
    expect(r).toMatchObject({ pending: 5, requests: 1, submitted: 5, batchId: null });
    expect(r.estimatedUsd).toBeGreaterThan(0);
    expect(r.upperBoundUsd).toBeGreaterThan(r.estimatedUsd);
    expect(batches.created).toHaveLength(0);
    expect(store.cap.reserved).toBe(0);
    expect(store.reviews.size).toBe(0);
    // Without a batch API (no Claude key) it is a dry run too.
    expect((await runReviewSubmit({ ...deps, batches: null }, { max: 100 })).batchId).toBeNull();
  });

  it('the whole bank (~9,545 rows) stays within about $2 expected with Sonnet at batch price', () => {
    const typical = (i: number): ReviewPending => ({
      ...bank(`reminiscent${i}`, 'adjective', [
        S(
          'geçmişi andıran, nostaljik',
          'The song was reminiscent of my childhood.',
          'Şarkı çocukluğumu hatırlatıyordu.',
          1,
        ),
        ...(i % 2
          ? [S('hatırlatan', 'The smell is reminiscent of rain.', 'Koku yağmuru hatırlatıyor.', 2)]
          : []),
      ]),
    });
    let expected = 0;
    let bound = 0;
    const rows = Array.from({ length: 9545 }, (_, i) => typical(i));
    for (let i = 0; i < rows.length; i += REVIEW_GROUP_SIZE) {
      const g = rows.slice(i, i + REVIEW_GROUP_SIZE);
      expected += reviewExpectedUsd(MODEL, g);
      bound += reviewBoundUsd(MODEL, g);
    }
    expect(expected).toBeGreaterThan(0.5);
    expect(expected).toBeLessThan(2.2);
    expect(bound).toBeLessThan(20);
  });

  it('sends groups of 25 as one reserved batch and records every row', async () => {
    const { store, batches, deps, logs } = setup();
    for (let i = 0; i < 30; i++)
      store.add(bank(`word${i}`, 'noun', [S('kelime', `A word${i} here.`, 'Burada bir kelime.')]));
    const r = await runReviewSubmit(deps, { max: 100 });
    expect(r).toMatchObject({ pending: 30, requests: 2, submitted: 30, stopped: 'done' });
    expect(batches.created).toHaveLength(1);
    const reqs = batches.created[0]!;
    expect(reqs).toHaveLength(2);
    for (const q of reqs) expect(q.custom_id).toMatch(/^wr_[a-f0-9]{40}$/);
    expect(
      (reqs[0]!.params.messages[0]!.content as string).split('\n').filter((l) => /^\d+\./.test(l)),
    ).toHaveLength(25);
    expect(store.batches.get(r.batchId!)).toMatchObject({
      requests: 2,
      prompt_version: REVIEW_PROMPT_VERSION,
      model: MODEL,
    });
    expect(store.cap.reserved).toBeCloseTo(r.reservedUsd, 6);
    const j = store.reviews.get('word26|noun')!;
    expect(j).toMatchObject({
      state: 'submitted',
      batch_id: r.batchId,
      custom_id: reqs[1]!.custom_id,
      input: { n: 1 },
    });
    // In flight: not sent again.
    expect((await runReviewSubmit(deps, { max: 100 })).stopped).toBe('empty');
    expect(logs).toContain('word bank review batch submitted');
  });

  it('halves the batch until it fits the budget; sends nothing when nothing fits', async () => {
    const { store, deps } = setup();
    for (let i = 0; i < 100; i++)
      store.add(bank(`word${i}`, 'noun', [S('kelime', `A word${i} here.`, 'Burada bir kelime.')]));
    const all = (await runReviewSubmit(deps, { max: 200, dryRun: true })).upperBoundUsd;
    const { store: s2, deps: d2, batches: b2 } = setup(all * 0.6);
    for (const r of store.rows.values()) s2.add(r);
    const r = await runReviewSubmit(d2, { max: 200 });
    expect(r.stopped).toBe('budget');
    expect(r.submitted).toBe(50);
    expect(b2.created[0]).toHaveLength(2);
    const { store: s3, deps: d3, batches: b3 } = setup(0.000001);
    for (const x of store.rows.values()) s3.add(x);
    expect(await runReviewSubmit(d3, { max: 200 })).toMatchObject({
      submitted: 0,
      batchId: null,
      stopped: 'budget',
    });
    expect(b3.created).toHaveLength(0);
  });
});

describe('review collect', () => {
  async function submitted() {
    const ctx = setup();
    seed(ctx.store);
    const r = await runReviewSubmit(ctx.deps, { max: 100 });
    ctx.batches.status = 'ended';
    const cid = ctx.batches.created[0]![0]!.custom_id;
    // Order in the request: easiest level first (fake: insertion order).
    const order = ctx.batches.created[0]![0]!.params.messages[0]!.content as string;
    const num = (lemma: string) =>
      Number(
        order
          .split('\n')
          .find((l) => l.includes(` ${lemma} (`))!
          .split('.')[0],
      );
    return { ...ctx, batchId: r.batchId!, cid, num };
  }

  it('waits for a batch that has not ended', async () => {
    const { deps, batches, store } = setup();
    seed(store);
    await runReviewSubmit(deps, { max: 100 });
    const r = await runReviewCollect(deps);
    expect(r.batches[0]!.status).toBe('in_progress');
    expect(r.rows).toBe(0);
    expect(batches.created).toHaveLength(1);
  });

  it('applies fixes and drops, links new meanings in the lexicon, settles the cost', async () => {
    const { store, batches, deps, cid, num, batchId } = await submitted();
    const seqBefore = new Map([...store.rows].map(([k, v]) => [k, v.seq]));
    batches.answers.set(
      cid,
      answer({
        changes: [
          change(num('scythe'), 1, 'fix', {
            meaning_tr: 'tırpan',
            gloss_en: 'a tool with a long curved blade',
            reason: 'wrong sense',
          }),
          change(num('arena'), 1, 'fix', {
            example_tr: 'Konser büyük bir arenadaydı.',
            reason: 'junk in translation',
          }),
          change(num('relative'), 2, 'drop', { reason: 'example shows akraba' }),
          change(num('the'), 1, 'fix', {
            meaning_tr: 'belirli tanımlık',
            gloss_en: 'definite article',
            reason: 'not her',
          }),
        ],
      }),
    );
    const r = await runReviewCollect(deps);
    expect(r).toMatchObject({
      rows: 5,
      rowsChanged: 4,
      sensesFixed: 3,
      sensesDropped: 1,
      sensesKept: 2,
      rowsRetired: 0,
      retried: 0,
      failed: 0,
      stale: 0,
      newLexiconSenses: 2,
    });

    const scythe = store.rows.get('scythe|noun')!;
    expect(scythe.senses).toHaveLength(1);
    expect(scythe.senses[0]).toMatchObject({
      meaning_tr: 'tırpan',
      example_en: 'The farmer cut the grass with a scythe.',
    });
    expect(scythe.senses[0]!.sense_id).not.toBe(uid(1));
    expect(scythe.senses[0]!.sense_id).toBe(
      store.lexicon.find((l) => l.meaning_tr === 'tırpan')!.id,
    );
    expect(store.upserts.find((u) => u.meaning_tr === 'tırpan')).toMatchObject({
      lemma_norm: 'scythe',
      pos: 'noun',
      gloss_en: 'a tool with a long curved blade',
      cefr: 'C1',
      cefr_source: 'cefrj',
      model: MODEL,
    });
    expect(store.rows.get('arena|noun')!.senses[0]).toMatchObject({
      example_tr: 'Konser büyük bir arenadaydı.',
      sense_id: uid(2),
    });
    expect(store.rows.get('relative|noun')!.senses.map((s) => s.meaning_tr)).toEqual(['akraba']);
    // Changed rows move past the devices' cursors; an unchanged row keeps its place.
    for (const k of ['scythe|noun', 'arena|noun', 'relative|noun', 'the|determiner'])
      expect(store.rows.get(k)!.seq).toBeGreaterThan(seqBefore.get(k)!);
    expect(store.rows.get('mutable|adjective')!.seq).toBe(seqBefore.get('mutable|adjective'));

    // Every row is recorded as reviewed, with what was done.
    const v = store.reviews.get('scythe|noun')!;
    expect(v).toMatchObject({
      state: 'done',
      prompt_version: REVIEW_PROMPT_VERSION,
      model: MODEL,
      attempt: 1,
    });
    expect(v.outcome!.fixed[0]).toMatchObject({
      old: { meaning_tr: 'ölüm meleği' },
      new: { meaning_tr: 'tırpan' },
      reason: 'wrong sense',
    });
    expect(store.reviews.get('mutable|adjective')).toMatchObject({ state: 'done', senses: null });

    // The real cost is settled on the hold and the batch is closed.
    expect(store.holds.size).toBe(0);
    expect(store.cap.spent).toBeCloseTo(r.costUsd, 6);
    expect(store.batches.get(batchId)).toMatchObject({ state: 'collected', cost_usd: r.costUsd });
    // Samples for the log: "lemma: old → new".
    expect(r.samples.find((s) => s.lemma === 'scythe')).toMatchObject({
      kind: 'fix',
      old: expect.stringContaining('ölüm meleği'),
      new: expect.stringContaining('tırpan'),
    });
    expect(r.samples.find((s) => s.lemma === 'relative')).toMatchObject({
      kind: 'drop',
      new: null,
    });
    // Nothing left to review.
    expect((await runReviewSubmit(deps, { max: 100 })).stopped).toBe('empty');
  });

  it('asks again with the problem named when a fix is rejected; the last attempt applies what is valid', async () => {
    const { store, batches, deps, cid, num } = await submitted();
    const bad = change(num('arena'), 1, 'fix', {
      example_en: 'The hall was full.',
      example_tr: 'Salon doluydu.',
    });
    batches.answers.set(cid, answer({ changes: [bad] }));
    const r1 = await runReviewCollect(deps);
    expect(r1).toMatchObject({
      rows: 4,
      retried: 1,
      fixesRejected: 1,
      problems: { example_without_word: 1 },
    });
    expect(store.reviews.get('arena|noun')).toMatchObject({
      state: 'queued',
      attempt: 1,
      last_error: 'example_without_word',
    });

    const s2 = await runReviewSubmit(deps, { max: 100 });
    expect(s2.submitted).toBe(1);
    const req = batches.created[1]![0]!;
    expect(req.params.messages[0]!.content).toContain('note: a previous correction was rejected');
    batches.answers = new Map([[req.custom_id, answer({ changes: [{ ...bad, word: 1 }] })]]);
    const r2 = await runReviewCollect(deps);
    expect(REVIEW_MAX_ATTEMPTS).toBe(2);
    expect(r2).toMatchObject({ rows: 1, retried: 0, rowsChanged: 0, sensesKept: 1 });
    expect(store.reviews.get('arena|noun')).toMatchObject({ state: 'done', attempt: 2 });
    expect(store.rows.get('arena|noun')!.senses[0]!.example_tr).toBe(
      'Things: iş dünyasına girmek istiyor',
    );
  });

  it('retires a row whose every meaning is dropped', async () => {
    const { store, batches, deps, cid, num } = await submitted();
    batches.answers.set(cid, answer({ changes: [change(num('mutable'), 1, 'drop')] }));
    const r = await runReviewCollect(deps);
    expect(r).toMatchObject({ rowsRetired: 1, rowsChanged: 1 });
    const m = store.rows.get('mutable|adjective')!;
    expect(m.retired).toBe(true);
    expect(m.senses).toHaveLength(1); // the content stays for the record; devices delete it
    expect(r.samples.find((s) => s.lemma === 'mutable')!.kind).toBe('retire');
  });

  it('does not overwrite a row that changed after it was sent', async () => {
    const { store, batches, deps, cid, num } = await submitted();
    store.rows.get('scythe|noun')!.senses = [
      S('tırpan', 'A scythe is sharp.', 'Tırpan keskindir.', 9),
    ];
    batches.answers.set(cid, answer({ changes: [change(num('scythe'), 1, 'drop')] }));
    const r = await runReviewCollect(deps);
    expect(r.stale).toBe(1);
    expect(store.rows.get('scythe|noun')!.senses[0]!.meaning_tr).toBe('tırpan');
    expect(store.reviews.get('scythe|noun')).toMatchObject({
      state: 'queued',
      last_error: 'stale',
    });
  });

  it('a broken answer asks the whole group again, then gives up; an errored request is free', async () => {
    const { store, batches, deps, cid } = await submitted();
    batches.answers.set(cid, answer('oops'));
    const r1 = await runReviewCollect(deps);
    expect(r1).toMatchObject({ rows: 0, retried: 5, problems: { not_json: 1 } });
    expect(r1.costUsd).toBeGreaterThan(0);

    await runReviewSubmit(deps, { max: 100 });
    const cid2 = batches.created[1]![0]!.custom_id;
    batches.answers = new Map([[cid2, { type: 'errored' }]]);
    const r2 = await runReviewCollect(deps);
    expect(r2).toMatchObject({ retried: 5, costUsd: 0 });
    expect(store.reviews.get('scythe|noun')).toMatchObject({ state: 'queued', attempt: 1 });

    await runReviewSubmit(deps, { max: 100 });
    const cid3 = batches.created[2]![0]!.custom_id;
    batches.answers = new Map([[cid3, answer({ changes: [] }, 'max_tokens')]]);
    const r3 = await runReviewCollect(deps);
    expect(r3).toMatchObject({ failed: 5, retried: 0 });
    expect(store.reviews.get('scythe|noun')!.state).toBe('failed');
    expect((await runReviewSubmit(deps, { max: 100 })).stopped).toBe('empty');
  });

  it('asks again for groups the batch did not answer', async () => {
    const { store, deps } = await submitted();
    const r = await runReviewCollect(deps);
    expect(r).toMatchObject({ retried: 5, costUsd: 0 });
    expect(store.reviews.get('the|determiner')).toMatchObject({ state: 'queued', attempt: 0 });
  });

  it('prints at most 40 example changes', async () => {
    const { store, batches, deps } = setup();
    for (let i = 0; i < 50; i++)
      store.add(bank(`word${i}`, 'noun', [S('kelime', `A word${i} here.`, 'Burada bir kelime.')]));
    await runReviewSubmit(deps, { max: 100 });
    batches.status = 'ended';
    for (const q of batches.created[0]!) {
      const n = (q.params.messages[0]!.content as string).split('\n').length;
      batches.answers.set(
        q.custom_id,
        answer({
          changes: Array.from({ length: n }, (_, i) =>
            change(i + 1, 1, 'fix', { example_tr: 'Burada bir kelime var.' }),
          ),
        }),
      );
    }
    const r = await runReviewCollect(deps);
    expect(r.sensesFixed).toBe(50);
    expect(r.samples).toHaveLength(REVIEW_LOG_SAMPLES);
    expect(reviewCustomId([{ lemma_norm: 'a', pos: 'noun' }])).toMatch(/^wr_/);
  });
});

describe('docs/ai-pipeline.md', () => {
  it('documents the review prompt and schema verbatim', () => {
    const doc = readFileSync(new URL('../../docs/ai-pipeline.md', import.meta.url), 'utf8');
    expect(doc).toContain(`\`${REVIEW_PROMPT_VERSION}\``);
    expect(doc).toContain(REVIEW_SYSTEM_PROMPT);
    const blocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].flatMap((m) => {
      try {
        return [JSON.parse(m[1]!) as unknown];
      } catch {
        return [];
      }
    });
    expect(blocks).toContainEqual(REVIEW_RESPONSE_SCHEMA);
  });
});
