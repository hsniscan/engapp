// @vitest-environment node
// The word-bank job against fakes: recorded-style model answers, an in-memory database and
// batch API. No network, no model calls (decision 0038).
import { readFileSync } from 'node:fs';
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { callCostUsd } from '../../supabase/functions/_shared/image-models.ts';
import { isSameMeaningTr } from '../../supabase/functions/_shared/text.ts';
import type { BatchApi, BatchResult } from './image-jobs.ts';
import {
  customIdOf,
  runCollect,
  runPlan,
  runSubmit,
  WORDBANK_MAX_ATTEMPTS,
  type BankRowOut,
  type BatchRow,
  type JobRow,
  type LexiconExampleHit,
  type LexiconItem,
  type LexiconTermHit,
  type PendingWord,
  type WordBankDeps,
  type WordBankStore,
} from './word-bank-jobs.ts';
import {
  parseWordAnswer,
  wordUserContent,
  WORDBANK_PROMPT_VERSION,
  WORDBANK_RESPONSE_SCHEMA,
  WORDBANK_SYSTEM_PROMPT,
  type WordInput,
} from './word-bank-prompt.ts';

const MODEL = 'claude-haiku-5-5';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const word = (
  lemma_norm: string,
  pos = 'noun',
  cefr = 'A1',
  source: 'cefrj' | 'octanove' = 'cefrj',
): PendingWord => ({
  lemma_norm,
  pos,
  cefr,
  source,
  zipf: 5,
  attempt: 0,
  problem: null,
});

class FakeStore implements WordBankStore {
  words: PendingWord[] = [];
  terms: LexiconTermHit[] = [];
  examples: LexiconExampleHit[] = [];
  rows = new Map<string, BankRowOut>();
  jobs = new Map<string, JobRow>();
  batches = new Map<string, BatchRow>();
  upserts: LexiconItem[] = [];
  cap = { spent: 0, reserved: 0 };
  holds = new Map<string, number>();
  private n = 1000;

  async pending(limit: number) {
    return this.words
      .filter((w) => {
        const k = `${w.lemma_norm}|${w.pos}`;
        const j = this.jobs.get(k);
        return !this.rows.has(k) && (!j || j.state === 'queued');
      })
      .map((w) => {
        const j = this.jobs.get(`${w.lemma_norm}|${w.pos}`);
        return { ...w, attempt: j?.attempt ?? 0, problem: j?.last_error ?? null };
      })
      .slice(0, limit);
  }
  async lexiconFind(norms: string[]) {
    return this.terms.filter((t) => norms.includes(t.lemma_norm));
  }
  async lexiconExamples(ids: string[]) {
    return this.examples.filter((e) => ids.includes(e.sense_id));
  }
  async lexiconUpsert(items: LexiconItem[]) {
    this.upserts.push(...items);
    return items.map((it) => {
      let t = this.terms.find((x) => x.lemma_norm === it.lemma_norm);
      if (!t) {
        t = { term_id: uid(this.n++), lemma: it.lemma, lemma_norm: it.lemma_norm, senses: [] };
        this.terms.push(t);
      }
      // lexicon_upsert's guard: the same pos with an overlapping Turkish meaning is that sense.
      let s = t.senses.find(
        (x) => x.pos === it.pos && isSameMeaningTr(x.meaning_tr, it.meaning_tr),
      );
      if (!s) {
        s = { id: uid(this.n++), pos: it.pos, meaning_tr: it.meaning_tr };
        t.senses.push(s);
      }
      return { term_id: t.term_id, sense_id: s.id };
    });
  }
  async putRows(rows: BankRowOut[]) {
    for (const r of rows) {
      this.rows.set(`${r.lemma_norm}|${r.pos}`, r);
      const k = `${r.lemma_norm}|${r.pos}`;
      const j = this.jobs.get(k);
      this.jobs.set(k, {
        ...(j ?? {
          lemma_norm: r.lemma_norm,
          pos: r.pos,
          attempt: 0,
          custom_id: null,
          input: null,
        }),
        state: 'done',
        batch_id: null,
        last_error: null,
      });
    }
    return rows.length;
  }
  async upsertJobs(rows: JobRow[]) {
    for (const r of rows) this.jobs.set(`${r.lemma_norm}|${r.pos}`, structuredClone(r));
  }
  async jobsOfBatch(id: string) {
    return [...this.jobs.values()].filter((j) => j.batch_id === id).map((j) => structuredClone(j));
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

/** A Message Batch fake: answers are scripted per custom_id after "the batch ends". */
class FakeBatches implements BatchApi {
  created: { custom_id: string; params: Anthropic.MessageCreateParamsNonStreaming }[][] = [];
  status = 'in_progress';
  answers = new Map<string, BatchResult['result']>();
  async create(
    requests: { custom_id: string; params: Anthropic.MessageCreateParamsNonStreaming }[],
  ) {
    this.created.push(requests);
    return { id: `msgbatch_${this.created.length}` };
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

const USAGE = { input_tokens: 900, output_tokens: 600 };

/** A model answer in the API's shape (what a recorded batch result holds). */
function answer(json: unknown, stop_reason = 'end_turn'): BatchResult['result'] {
  return {
    type: 'succeeded',
    message: {
      id: 'msg_x',
      type: 'message',
      role: 'assistant',
      model: MODEL,
      stop_reason,
      content: [
        { type: 'thinking', thinking: '', signature: 's' },
        { type: 'text', text: typeof json === 'string' ? json : JSON.stringify(json) },
      ],
      usage: USAGE,
    } as unknown as Anthropic.Message,
  };
}

const sense = (
  given: number,
  meaning_tr: string,
  gloss_en: string,
  example_en: string,
  example_tr: string,
) => ({
  given,
  meaning_tr,
  gloss_en,
  example_en,
  example_tr,
});

function setup(cap = 80) {
  const store = new FakeStore();
  const batches = new FakeBatches();
  const logs: string[] = [];
  const deps: WordBankDeps = {
    store,
    batches,
    model: MODEL,
    capUsd: cap,
    log: (m) => logs.push(m),
  };
  return { store, batches, deps, logs };
}

/** apple: in the lexicon with a shared example; calm: in the lexicon without one; invite: new. */
function seed(store: FakeStore) {
  store.words = [
    word('apple'),
    word('calm', 'adjective', 'B1'),
    word('invitation', 'noun', 'A2'),
    word('run', 'verb'),
  ];
  store.terms = [
    {
      term_id: uid(1),
      lemma: 'apple',
      lemma_norm: 'apple',
      senses: [{ id: uid(11), pos: 'noun', meaning_tr: 'elma' }],
    },
    {
      term_id: uid(2),
      lemma: 'calm',
      lemma_norm: 'calm',
      senses: [
        { id: uid(21), pos: 'adjective', meaning_tr: 'sakin' },
        { id: uid(22), pos: 'adjective', meaning_tr: 'sakin, durgun' }, // near-duplicate: skipped
        { id: uid(23), pos: 'verb', meaning_tr: 'sakinleştirmek' }, // other pos
      ],
    },
  ];
  store.examples = [
    {
      sense_id: uid(11),
      level_band: 'A2',
      text_en: 'She eats an apple every day.',
      text_tr: 'Her gün bir elma yer.',
    },
    {
      sense_id: uid(11),
      level_band: 'C1',
      text_en: 'The apple orchard was vast.',
      text_tr: 'Elma bahçesi genişti.',
    },
  ];
}

describe('word bank plan and submit', () => {
  it('plan counts lexicon coverage and estimates the cost without writing', async () => {
    const { store, deps } = setup();
    seed(store);
    const p = await runPlan(deps, { limit: 100 });
    expect(p).toMatchObject({ pending: 4, fromLexicon: 1, examplesOnly: 1, fullAsk: 2 });
    expect(p.estimatedUsd).toBeGreaterThan(0);
    expect(p.upperBoundUsd).toBeGreaterThanOrEqual(p.estimatedUsd);
    // ~10 000 words stay within "a few dollars" at the expected size.
    expect((p.estimatedUsd / 3) * 10_000).toBeLessThan(5);
    expect(store.rows.size).toBe(0);
  });

  it('stores lexicon-covered words at once and sends the rest as one reserved batch', async () => {
    const { store, batches, deps } = setup();
    seed(store);
    const r = await runSubmit(deps, { max: 100 });
    expect(r).toMatchObject({ pending: 4, fromLexicon: 1, submitted: 3, stopped: 'done' });

    // apple: no model call; the lexicon meaning and its example closest to the level.
    const apple = store.rows.get('apple|noun')!;
    expect(apple).toMatchObject({ model: null, cost_usd: 0, lexicon_term_id: uid(1) });
    expect(apple.senses).toEqual([
      {
        meaning_tr: 'elma',
        example_en: 'She eats an apple every day.',
        example_tr: 'Her gün bir elma yer.',
        sense_id: uid(11),
      },
    ]);

    expect(batches.created).toHaveLength(1);
    const reqs = batches.created[0]!;
    expect(reqs.map((q) => q.custom_id).sort()).toEqual(
      [
        customIdOf('calm', 'adjective'),
        customIdOf('invitation', 'noun'),
        customIdOf('run', 'verb'),
      ].sort(),
    );
    for (const q of reqs) {
      expect(q.custom_id).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(q.params.model).toBe(MODEL);
    }
    // calm: the lexicon's meaning is given (rule 6), its near-duplicate and the verb are not.
    const calm = JSON.parse(
      reqs.find((q) => q.custom_id === customIdOf('calm', 'adjective'))!.params.messages[0]!
        .content as string,
    );
    expect(calm).toEqual({
      lemma: 'calm',
      pos: 'adjective',
      level: 'B1',
      given: [{ n: 1, meaning_tr: 'sakin' }],
    });
    // invitation: only the word, its part of speech and level are sent.
    const inv = JSON.parse(
      reqs.find((q) => q.custom_id === customIdOf('invitation', 'noun'))!.params.messages[0]!
        .content as string,
    );
    expect(inv).toEqual({ lemma: 'invitation', pos: 'noun', level: 'A2' });

    // One hold for the batch, recorded with it; jobs are submitted with their input.
    expect(store.cap.reserved).toBeCloseTo(r.reservedUsd, 6);
    expect(store.batches.get('msgbatch_1')).toMatchObject({
      requests: 3,
      hold_id: expect.any(String),
      state: 'submitted',
    });
    expect(store.jobs.get('calm|adjective')).toMatchObject({
      state: 'submitted',
      batch_id: 'msgbatch_1',
    });
    expect(store.jobs.get('calm|adjective')!.input!.given).toEqual([
      { sense_id: uid(21), meaning_tr: 'sakin' },
    ]);

    // Resumable and idempotent: nothing is sent twice.
    const again = await runSubmit(deps, { max: 100 });
    expect(again).toMatchObject({ pending: 0, submitted: 0, stopped: 'empty' });
    expect(batches.created).toHaveLength(1);
  });

  it('stops at the monthly cap: halves the batch until it fits, sends nothing when nothing fits', async () => {
    const one = setup(0.0015);
    one.store.words = Array.from({ length: 8 }, (_, i) => word(`word${i}`));
    const r = await runSubmit(one.deps, { max: 100 });
    expect(r.stopped).toBe('budget');
    expect(r.submitted).toBeGreaterThan(0);
    expect(r.submitted).toBeLessThan(8);
    expect(one.store.cap.reserved).toBeLessThanOrEqual(0.0015);

    const none = setup(0);
    none.store.words = [word('apple')];
    const r2 = await runSubmit(none.deps, { max: 100 });
    expect(r2).toMatchObject({ submitted: 0, stopped: 'budget', batchId: null });
    expect(none.batches.created).toHaveLength(0);
  });

  it('a dry run reserves and writes nothing', async () => {
    const { store, batches, deps } = setup();
    seed(store);
    const r = await runSubmit(deps, { max: 100, dryRun: true });
    expect(r).toMatchObject({ fromLexicon: 1, submitted: 3 });
    expect(r.reservedUsd).toBeGreaterThan(0);
    expect(store.rows.size + store.jobs.size + store.holds.size + batches.created.length).toBe(0);
  });

  it('releases the hold when the batch cannot be created', async () => {
    const { store, batches, deps } = setup();
    store.words = [word('apple')];
    batches.create = async () => {
      throw new Error('overloaded');
    };
    await expect(runSubmit(deps, { max: 10 })).rejects.toThrow('overloaded');
    expect(store.cap).toEqual({ spent: 0, reserved: 0 });
  });
});

describe('word bank collect', () => {
  async function submitted() {
    const s = setup();
    seed(s.store);
    await runSubmit(s.deps, { max: 100 });
    return s;
  }

  it('does nothing while the batch runs', async () => {
    const { store, deps } = await submitted();
    const r = await runCollect(deps);
    expect(r.batches).toEqual([{ id: 'msgbatch_1', status: 'in_progress' }]);
    expect(store.batches.get('msgbatch_1')!.state).toBe('submitted');
  });

  it('checks answers, links new meanings to the lexicon, settles the real cost', async () => {
    const { store, batches, deps } = await submitted();
    batches.status = 'ended';
    batches.answers.set(
      customIdOf('invitation', 'noun'),
      answer({
        lemma: 'invitation',
        senses: [
          sense(
            0,
            'davet, davetiye',
            'a request to come to an event',
            'Thanks for the invitation!',
            'Davet için teşekkürler!',
          ),
          sense(
            0,
            'davet',
            'asking someone to come',
            'I sent invitations to my friends.',
            'Arkadaşlarıma davetiye gönderdim.',
          ), // near-duplicate
          sense(
            0,
            'teşvik',
            'an encouragement',
            'The open door was an invitation to thieves.',
            'Açık kapı hırsızlara davetti.',
          ),
        ],
      }),
    );
    batches.answers.set(
      customIdOf('calm', 'adjective'),
      answer({
        lemma: 'calm',
        senses: [sense(1, '', '', 'The sea is calm today.', 'Deniz bugün sakin.')],
      }),
    );
    batches.answers.set(
      customIdOf('run', 'verb'),
      answer({
        lemma: 'run',
        senses: [sense(0, 'koşmak', 'to move fast on foot', 'He ran to school.', 'Okula koştu.')],
      }), // irregular form
    );
    const r = await runCollect(deps);

    const inv = store.rows.get('invitation|noun')!;
    expect(inv.lemma).toBe('invitation');
    expect(inv.senses.map((s) => s.meaning_tr)).toEqual(['davet, davetiye', 'teşvik']);
    expect(inv.senses.every((s) => s.sense_id)).toBe(true);
    expect(inv.lexicon_term_id).toEqual(expect.any(String));
    expect(inv.model).toBe(MODEL);
    expect(store.upserts.map((u) => [u.lemma_norm, u.meaning_tr, u.cefr, u.cefr_source])).toEqual([
      ['invitation', 'davet, davetiye', 'A2', 'cefrj'],
      ['invitation', 'teşvik', 'A2', 'cefrj'],
    ]);

    // calm: the lexicon's meaning and sense id, the model's example.
    expect(store.rows.get('calm|adjective')!.senses).toEqual([
      {
        meaning_tr: 'sakin',
        example_en: 'The sea is calm today.',
        example_tr: 'Deniz bugün sakin.',
        sense_id: uid(21),
      },
    ]);

    // run: "ran" does not contain the word → rejected, asked again with the reason.
    expect(store.rows.has('run|verb')).toBe(false);
    expect(store.jobs.get('run|verb')).toMatchObject({
      state: 'queued',
      attempt: 1,
      last_error: 'example_without_word',
      batch_id: null,
    });
    expect(r.problems).toMatchObject({ example_without_word: 1, duplicate_meaning: 1 });

    const per = callCostUsd(MODEL, USAGE, { batch: true });
    expect(r.costUsd).toBeCloseTo(per * 3, 6);
    expect(store.cap.reserved).toBeCloseTo(0, 9);
    expect(store.cap.spent).toBeCloseTo(per * 3, 6);
    expect(store.batches.get('msgbatch_1')).toMatchObject({ state: 'collected' });
    expect(r).toMatchObject({ stored: 2, retried: 1, failed: 0 });

    // The retry carries the reason; nothing done is sent again.
    const again = await runSubmit(deps, { max: 100 });
    expect(again.submitted).toBe(1);
    const retry = JSON.parse(batches.created[1]![0]!.params.messages[0]!.content as string);
    expect(retry.lemma).toBe('run');
    expect(retry.note).toMatch(/irregular form/);
  });

  it('gives a word up after the last attempt; errored and missing requests are asked again for free', async () => {
    const { store, batches, deps } = await submitted();
    store.jobs.get('run|verb')!.attempt = WORDBANK_MAX_ATTEMPTS - 1;
    batches.status = 'ended';
    batches.answers.set(customIdOf('run', 'verb'), answer('not json'));
    batches.answers.set(customIdOf('calm', 'adjective'), {
      type: 'errored',
      error: { type: 'overloaded_error' },
    });
    // invitation: missing from the results.
    const r = await runCollect(deps);
    expect(store.jobs.get('run|verb')).toMatchObject({ state: 'failed', last_error: 'not_json' });
    expect(store.jobs.get('calm|adjective')).toMatchObject({
      state: 'queued',
      attempt: 0,
      last_error: 'batch errored',
    });
    expect(store.jobs.get('invitation|noun')).toMatchObject({ state: 'queued', attempt: 0 });
    expect(r).toMatchObject({ failed: 1, retried: 2, stored: 0 });
    // A failed word is never pending again; the others are.
    expect((await store.pending(100)).map((w) => w.lemma_norm).sort()).toEqual([
      'calm',
      'invitation',
    ]);
    // The errored request was not billed: only the answered one is spent.
    expect(store.cap.spent).toBeCloseTo(callCostUsd(MODEL, USAGE, { batch: true }), 6);
  });

  it('keeps the lexicon meanings that had examples when the answer for the others fails', async () => {
    const { store, batches, deps } = setup();
    store.words = [word('light', 'adjective', 'A2')];
    store.terms = [
      {
        term_id: uid(3),
        lemma: 'light',
        lemma_norm: 'light',
        senses: [
          { id: uid(31), pos: 'adjective', meaning_tr: 'hafif' },
          { id: uid(32), pos: 'adjective', meaning_tr: 'aydınlık' },
        ],
      },
    ];
    store.examples = [
      {
        sense_id: uid(31),
        level_band: 'A2',
        text_en: 'This bag is light.',
        text_tr: 'Bu çanta hafif.',
      },
    ];
    await runSubmit(deps, { max: 10 });
    batches.status = 'ended';
    batches.answers.set(
      customIdOf('light', 'adjective'),
      answer({ lemma: 'light', senses: [] }, 'refusal'),
    );
    await runCollect(deps);
    expect(store.rows.get('light|adjective')!.senses).toEqual([
      {
        meaning_tr: 'hafif',
        example_en: 'This bag is light.',
        example_tr: 'Bu çanta hafif.',
        sense_id: uid(31),
      },
    ]);
  });
});

describe('wordbank-v1 answers', () => {
  const w: WordInput = { lemma_norm: 'monday', pos: 'noun', cefr: 'A1', given: [] };
  const msg = (json: unknown, stop = 'end_turn') => ({
    stop_reason: stop,
    content: [{ type: 'text', text: JSON.stringify(json) }],
  });

  it('keeps the usual capitalisation of the same word only', () => {
    const ok = parseWordAnswer(
      msg({
        lemma: 'Monday',
        senses: [
          sense(
            0,
            'pazartesi',
            'the day after Sunday',
            'See you on Monday.',
            'Pazartesi görüşürüz.',
          ),
        ],
      }),
      w,
    );
    expect(ok).toMatchObject({ kind: 'ok', lemma: 'Monday' });
    const other = parseWordAnswer(
      msg({
        lemma: 'Tuesday',
        senses: [
          sense(
            0,
            'pazartesi',
            'the day after Sunday',
            'See you on Monday.',
            'Pazartesi görüşürüz.',
          ),
        ],
      }),
      w,
    );
    expect(other).toMatchObject({ kind: 'ok', lemma: 'monday' });
  });

  it('rejects refusals, cut answers, bad JSON, empty Turkish and markup', () => {
    expect(parseWordAnswer(msg({}, 'refusal'), w)).toEqual({ kind: 'invalid', reason: 'refusal' });
    expect(parseWordAnswer(msg({}, 'max_tokens'), w)).toEqual({
      kind: 'invalid',
      reason: 'max_tokens',
    });
    expect(parseWordAnswer(msg({ lemma: 'monday' }), w)).toEqual({
      kind: 'invalid',
      reason: 'schema',
    });
    expect(
      parseWordAnswer(
        msg({
          lemma: 'monday',
          senses: [sense(0, ' ', 'a day', 'See you on Monday.', 'Görüşürüz.')],
        }),
        w,
      ),
    ).toEqual({
      kind: 'invalid',
      reason: 'meaning_tr_unfit',
    });
    expect(
      parseWordAnswer(
        msg({
          lemma: 'monday',
          senses: [sense(0, 'pazartesi', 'a day', 'See <b>Monday</b>.', 'Pazartesi.')],
        }),
        w,
      ),
    ).toEqual({ kind: 'invalid', reason: 'example_en_unfit' });
    expect(
      parseWordAnswer(
        msg({
          lemma: 'monday',
          senses: [sense(0, 'pazartesi', 'a day', 'See you on Monday.', 'See you on Monday.')],
        }),
        w,
      ),
    ).toEqual({ kind: 'invalid', reason: 'example_not_translated' });
  });

  it('accepts regular inflections and caps the meanings at three', () => {
    const v: WordInput = { lemma_norm: 'study', pos: 'verb', cefr: 'A2', given: [] };
    const res = parseWordAnswer(
      msg({
        lemma: 'study',
        senses: [
          sense(0, 'çalışmak', 'to learn', 'She studied all night.', 'Bütün gece çalıştı.'),
          sense(
            0,
            'incelemek',
            'to look at closely',
            'He is studying the map.',
            'Haritayı inceliyor.',
          ),
          sense(0, 'okumak', 'to attend school', 'I study law.', 'Hukuk okuyorum.'),
          sense(0, 'araştırmak', 'to research', 'They study bees.', 'Arıları araştırırlar.'),
        ],
      }),
      v,
    );
    expect(res.kind === 'ok' && res.senses.map((s) => s.meaning_tr)).toEqual([
      'çalışmak',
      'incelemek',
      'okumak',
    ]);
  });

  it('given meanings: only their examples, never a new meaning', () => {
    const g: WordInput = {
      lemma_norm: 'bank',
      pos: 'noun',
      cefr: 'A2',
      given: [{ sense_id: uid(5), meaning_tr: 'banka' }],
    };
    expect(wordUserContent(g)).toBe(
      '{"lemma":"bank","pos":"noun","level":"A2","given":[{"n":1,"meaning_tr":"banka"}]}',
    );
    const res = parseWordAnswer(
      msg({
        lemma: 'bank',
        senses: [
          sense(1, 'BAŞKA', '', 'I went to the bank.', 'Bankaya gittim.'),
          sense(0, 'kıyı', 'river side', 'We sat on the bank.', 'Kıyıda oturduk.'),
          sense(2, 'x', '', 'The bank is open.', 'Banka açık.'),
        ],
      }),
      g,
    );
    expect(res).toMatchObject({ kind: 'ok', dropped: ['unknown_given', 'unknown_given'] });
    expect(res.kind === 'ok' && res.senses).toEqual([
      {
        given: g.given[0],
        meaning_tr: 'banka',
        gloss_en: null,
        gloss_key: null,
        example_en: 'I went to the bank.',
        example_tr: 'Bankaya gittim.',
      },
    ]);
  });
});

describe('word bank model', () => {
  it('comes from the environment, else the check model default (never hard-coded)', async () => {
    const { wordBankModel } = await import('./word-bank-env.ts');
    const { DEFAULT_CHECK_MODEL } =
      await import('../../supabase/functions/_shared/image-models.ts');
    expect(wordBankModel(() => undefined)).toBe(DEFAULT_CHECK_MODEL);
    expect(wordBankModel((k) => (k === 'CLAUDE_CHECK_MODEL' ? 'check-x' : undefined))).toBe(
      'check-x',
    );
    expect(wordBankModel((k) => (k === 'CLAUDE_WORDBANK_MODEL' ? ' bank-y ' : 'check-x'))).toBe(
      'bank-y',
    );
  });
});

describe('docs/ai-pipeline.md', () => {
  it('documents the word bank prompt and schema verbatim', () => {
    const doc = readFileSync(new URL('../../docs/ai-pipeline.md', import.meta.url), 'utf8');
    expect(doc).toContain(`\`${WORDBANK_PROMPT_VERSION}\``);
    expect(doc).toContain(WORDBANK_SYSTEM_PROMPT);
    const blocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].flatMap((m) => {
      try {
        return [JSON.parse(m[1]!) as unknown];
      } catch {
        return [];
      }
    });
    expect(blocks).toContainEqual(WORDBANK_RESPONSE_SCHEMA);
  });
});
