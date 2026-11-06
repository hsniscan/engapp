// @vitest-environment node
// The bulk example job (decision 0074) against fakes: Tatoeba parsing and matching, the three
// prompts' parsers, and a whole pass match → tag → generate → review → publish with an
// in-memory database and batch API. No network, no model calls.
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { exampleTextKey } from '../../supabase/functions/_shared/sentences.ts';
import {
  jobCapUsd,
  nextContexts,
  runCollect,
  runGenerateSubmit,
  runMatch,
  runPlan,
  runPublish,
  runReviewSubmit,
  runTagSubmit,
  senseNeed,
  type BulkBatch,
  type BulkRow,
  type ExampleBulkDeps,
  type ExampleBulkStore,
  type ExampleInsert,
  type ItemRow,
  type ItemState,
  type NewItem,
  type SenseCounts,
  type TargetRow,
} from './example-bulk-jobs.ts';
import {
  parseGenAnswer,
  parseReviewAnswer,
  parseTagAnswer,
  type GenInput,
  type ReviewItemInput,
} from './example-bulk-prompt.ts';
import {
  matchRow,
  PairIndex,
  pairFeatures,
  pairScore,
  pairShapeOk,
  parseLevelIndex,
  wordRank,
} from './example-match.ts';
import type { BatchApi, BatchResult } from './image-jobs.ts';
import {
  joinPairs,
  parseDetailedLine,
  parseLinkLine,
  parseManythingsLine,
  type TatoebaPair,
} from './tatoeba.ts';

const HAIKU = 'claude-haiku-5-5';
const SONNET = 'claude-sonnet-5-5';
const S1 = '00000000-0000-4000-8000-000000000001';
const S2 = '00000000-0000-4000-8000-000000000002';

const LEVELS = parseLevelIndex(
  [
    '# test',
    'run\t5.5\tv:A1:j|n:A2:j',
    'i\t7\to:A1:j',
    'every\t6\td:A1:j',
    'day\t6\tn:A1:j',
    'to\t7\tx:A1:j',
    'school\t5.5\tn:A1:j',
    'the\t7.5\td:A1:j',
    'fast\t5\tj:A1:j',
    'she\t6.5\to:A1:j',
    'he\t6.5\to:A1:j',
    'a\t7.5\td:A1:j',
    'shop\t5\tn:A1:j',
    'they\t6.5\to:A1:j',
    'company\t5\tn:A2:j',
    'we\t6.5\to:A1:j',
    'home\t6\tn:A1:j',
    'dog\t5\tn:A1:j',
    'quantum\t3.5\tn:C2:o',
    'test\t5\tn:A2:j',
    'kill\t4.8\tv:B1:j',
    'morning\t5.5\tn:A1:j',
    'often\t5.5\tr:A1:j:A2:test',
    'rarely\t4.2\t',
  ].join('\n'),
);

let nextId = 1;
const pair = (en: string, tr: string): TatoebaPair => ({
  en,
  tr,
  en_id: nextId,
  tr_id: 1000 + nextId++,
  en_by: 'CK',
  tr_by: 'tr_user',
});

const PAIRS = [
  pair('I run every day.', 'Her gün koşarım.'),
  pair('She runs to school.', 'O okula koşar.'),
  pair('We ran home fast.', 'Eve hızlı koştuk.'),
  pair('He runs a shop.', 'Bir dükkân işletiyor.'),
  pair('They run the company.', 'Şirketi onlar yönetiyor.'),
  pair('I run quantum tests.', 'Kuantum testleri yaparım.'),
  pair('The dog runs to the shop.', 'Köpek dükkâna koşar.'),
  pair('He runs to kill the dog.', 'Köpeği öldürmeye koşar.'),
  pair('run to the shop.', 'Dükkâna koş.'),
  pair('I run every morning.', 'Her sabah koşarım.'),
];

const TARGET: TargetRow = {
  lemma_norm: 'run',
  pos: 'verb',
  lemma: 'run',
  cefr: 'A1',
  senses: [
    { sense_id: S1, meaning_tr: 'koşmak', example_en: 'I run every morning.' },
    { sense_id: S2, meaning_tr: 'yönetmek, işletmek', example_en: 'She runs a small cafe.' },
  ],
  active: {},
};

// ------------------------------------------------------------------ fakes

class FakeStore implements ExampleBulkStore {
  targetRows: TargetRow[] = [structuredClone(TARGET)];
  bulkRows = new Map<string, BulkRow>();
  itemRows = new Map<string, ItemRow>();
  batchRows = new Map<string, BulkBatch>();
  published: (ExampleInsert & { id: string })[] = [];
  cap = { spent: 0, reserved: 0 };
  holds = new Map<string, number>();
  private n = 100;

  async targets() {
    return structuredClone(this.targetRows);
  }
  async senseCounts(): Promise<SenseCounts> {
    const out: SenseCounts = new Map();
    for (const it of this.itemRows.values()) {
      if (!it.sense_id) continue;
      const c = out.get(it.sense_id) ?? {};
      c[it.state] = (c[it.state] ?? 0) + 1;
      out.set(it.sense_id, c);
    }
    return out;
  }
  async rows() {
    return [...this.bulkRows.values()].map((r) => structuredClone(r));
  }
  async upsertRows(rows: BulkRow[]) {
    for (const r of rows) this.bulkRows.set(`${r.lemma_norm}|${r.pos}`, structuredClone(r));
  }
  async items(states: readonly ItemState[], opts: { reviewBatch?: string } = {}) {
    return [...this.itemRows.values()]
      .filter((i) => states.includes(i.state) && (!opts.reviewBatch || i.review_batch_id === opts.reviewBatch))
      .map((i) => structuredClone(i));
  }
  private clash(it: Pick<ItemRow, 'lemma_norm' | 'pos' | 'text_en'>, id?: string) {
    return [...this.itemRows.values()].some(
      (o) =>
        o.id !== id &&
        o.lemma_norm === it.lemma_norm &&
        o.pos === it.pos &&
        exampleTextKey(o.text_en) === exampleTextKey(it.text_en),
    );
  }
  async insertItems(items: NewItem[]) {
    let n = 0;
    for (const it of items) {
      if (this.clash(it)) continue;
      const id = `00000000-0000-4000-9000-${String(this.n++).padStart(12, '0')}`;
      this.itemRows.set(id, { ...structuredClone(it), id });
      n++;
    }
    return n;
  }
  async saveItems(items: ItemRow[]) {
    const failed: string[] = [];
    for (const it of items) {
      if (this.clash(it, it.id)) failed.push(it.id);
      else this.itemRows.set(it.id, structuredClone(it));
    }
    return failed;
  }
  async insertBatch(b: BulkBatch) {
    this.batchRows.set(b.id, { ...b });
  }
  async openBatches() {
    return [...this.batchRows.values()].filter((b) => b.state === 'submitted');
  }
  async closeBatch(id: string, cost: number) {
    const b = this.batchRows.get(id)!;
    b.state = 'collected';
    b.cost_usd = cost;
  }
  async publish(items: ExampleInsert[]) {
    const out: { id: string; sense_id: string; text_en: string }[] = [];
    for (const it of items) {
      const dup = this.published.some(
        (p) => p.sense_id === it.sense_id && exampleTextKey(p.text_en) === exampleTextKey(it.text_en),
      );
      if (dup) continue;
      const id = `ex_${this.n++}`;
      this.published.push({ ...it, id });
      out.push({ id, sense_id: it.sense_id, text_en: it.text_en });
      const t = this.targetRows[0]!;
      t.active[it.sense_id] = [...(t.active[it.sense_id] ?? []), it.text_en];
    }
    return out;
  }
  async reserve(amount: number, capUsd: number) {
    if (this.cap.spent + this.cap.reserved + amount > capUsd) return null;
    this.cap.reserved += amount;
    const id = `hold_${this.n++}`;
    this.holds.set(id, amount);
    return id;
  }
  async settle(hold: string, actual: number) {
    this.cap.reserved -= this.holds.get(hold) ?? 0;
    this.holds.delete(hold);
    this.cap.spent += actual;
  }
  async spent() {
    let s = 0;
    for (const b of this.batchRows.values()) s += b.state === 'collected' ? (b.cost_usd ?? 0) : b.reserved_usd;
    return s;
  }
}

type Req = { custom_id: string; params: Anthropic.MessageCreateParamsNonStreaming };

class FakeBatches implements BatchApi {
  created: Req[][] = [];
  status = 'ended';
  answers = new Map<string, BatchResult['result']>();
  async create(requests: Req[]) {
    this.created.push(requests);
    return { id: `msgbatch_${this.created.length}` };
  }
  async retrieve(id: string) {
    return { id, processing_status: this.status };
  }
  async results(id: string): Promise<AsyncIterable<BatchResult>> {
    const ids = new Set(this.created[Number(id.split('_')[1]) - 1]!.map((r) => r.custom_id));
    const list = [...this.answers].filter(([c]) => ids.has(c)).map(([custom_id, result]) => ({ custom_id, result }));
    return (async function* () {
      yield* list;
    })();
  }
  /** The user turn of the last batch's only (or k-th) request. */
  userOf(k = 0): string {
    return this.created.at(-1)![k]!.params.messages[0]!.content as string;
  }
}

function answer(json: unknown, model = HAIKU): BatchResult['result'] {
  return {
    type: 'succeeded',
    message: {
      id: 'msg',
      type: 'message',
      role: 'assistant',
      model,
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(json) }],
      usage: { input_tokens: 800, output_tokens: 200 },
    } as unknown as Anthropic.Message,
  };
}

const msg = (json: unknown) =>
  ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(json) }] }) as never;

function setup(over: Partial<ExampleBulkDeps> = {}) {
  const store = new FakeStore();
  const batches = new FakeBatches();
  const deps: ExampleBulkDeps = {
    store,
    batches,
    model: HAIKU,
    reviewModel: SONNET,
    capUsd: 50,
    jobCapUsd: 15,
    log: () => {},
    ...over,
  };
  return { store, batches, deps };
}

// ------------------------------------------------------------------ Tatoeba

describe('tatoeba files', () => {
  it('reads the official exports and joins them by the links', () => {
    expect(parseDetailedLine('1276\teng\tLet\'s try  something.\tCK\t2010\t\\N')).toEqual({
      id: 1276,
      lang: 'eng',
      text: "Let's try something.",
      user: 'CK',
    });
    expect(parseDetailedLine('x\teng\tHi.')).toBeNull();
    expect(parseDetailedLine('5\ttur\tMerhaba.\t\\N')?.user).toBe('');
    expect(parseLinkLine('1276\t4567')).toEqual([1276, 4567]);
    expect(parseLinkLine('a\tb')).toBeNull();
    const eng = new Map([[1, { id: 1, lang: 'eng', text: 'Hi.', user: 'CK' }]]);
    const tur = new Map([
      [2, { id: 2, lang: 'tur', text: 'Merhaba.', user: 'x' }],
      [3, { id: 3, lang: 'tur', text: 'Selam.', user: 'y' }],
    ]);
    expect(joinPairs([[1, 2], [1, 3], [1, 2], [9, 2]], eng, tur)).toEqual([
      { en: 'Hi.', tr: 'Merhaba.', en_id: 1, tr_id: 2, en_by: 'CK', tr_by: 'x' },
      { en: 'Hi.', tr: 'Selam.', en_id: 1, tr_id: 3, en_by: 'CK', tr_by: 'y' },
    ]);
  });

  it("reads manythings' file with its attribution, and skips lines without one", () => {
    expect(
      parseManythingsLine(
        'I run every day.\tHer gün koşarım.\tCC-BY 2.0 (France) Attribution: tatoeba.org #2245 (CK) & #3456 (duran)',
      ),
    ).toEqual({ en: 'I run every day.', tr: 'Her gün koşarım.', en_id: 2245, en_by: 'CK', tr_id: 3456, tr_by: 'duran' });
    expect(parseManythingsLine('Hi.\tSelam.')).toBeNull();
  });
});

// ------------------------------------------------------------------ matching

describe('matching Tatoeba pairs to a bank word', () => {
  it('levels words by their easiest base form, the Turkish correction and frequency', () => {
    expect(wordRank('ran', LEVELS)).toBe(0);
    expect(wordRank('companies', LEVELS)).toBe(1);
    expect(wordRank('often', LEVELS)).toBe(1); // corrected A1 → A2
    expect(wordRank('rarely', LEVELS)).toBe(3); // Zipf 4.2 only
    expect(wordRank('zzzz', LEVELS)).toBeNull();
  });

  it('keeps tidy pairs only', () => {
    expect(pairShapeOk(pair('I run every day.', 'Her gün koşarım.'))).toBe(true);
    expect(pairShapeOk(pair('run to the shop.', 'Dükkâna koş.'))).toBe(false);
    expect(pairShapeOk(pair('Run!', 'Koş!'))).toBe(false);
    expect(pairShapeOk(pair('See http://x.org now please.', 'Şimdi bak lütfen.'))).toBe(false);
    expect(pairShapeOk(pair('I run every day.', 'I run every day.'))).toBe(false);
  });

  it('scores easy sentences and drops hard or blocked ones', () => {
    const f = pairFeatures('I run quantum tests.', [2, 5], 0, LEVELS);
    expect(f.hardest).toBe(5);
    expect(pairScore(f, 0)).toBeNull();
    const g = pairFeatures('Tom runs to school.', [4, 8], 0, LEVELS);
    expect(g.names).toBe(1);
    expect(pairScore(g, 0)).toBeGreaterThan(pairScore(pairFeatures('I run to school.', [2, 5], 0, LEVELS), 0)!);
    expect(pairScore(pairFeatures('He runs to kill the dog.', [3, 7], 0, LEVELS), 0)).toBeNull();
  });

  it('finds the inflected and irregular forms and skips the sentences a sense has', () => {
    const index = new PairIndex(PAIRS);
    const found = matchRow(index, LEVELS, TARGET, {
      want: 8,
      avoid: new Set([exampleTextKey('I run every morning.')]),
    }).map((m) => m.pair.en);
    expect(found).toContain('We ran home fast.');
    expect(found).toContain('She runs to school.');
    expect(found).not.toContain('I run every morning.');
    expect(found).not.toContain('I run quantum tests.');
    expect(found).not.toContain('He runs to kill the dog.');
    expect(found).not.toContain('run to the shop.');
  });
});

// ------------------------------------------------------------------ prompts

describe('answers', () => {
  it('tag: one verdict per candidate; no meaning means not ok', () => {
    const x = { senses: [{ meaning_tr: 'koşmak' }], candidates: [{ en: 'a', tr: 'b' }, { en: 'c', tr: 'd' }] };
    const r = parseTagAnswer(
      msg({ items: [{ i: 1, sense: 1, ok: true, context: 'work' }, { i: 1, sense: 1, ok: true, context: 'daily' }, { i: 2, sense: 3, ok: true, context: 'daily' }, { i: 7, sense: 1, ok: true, context: 'daily' }] }),
      x,
    );
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.verdicts.get(0)).toEqual({ sense: 0, ok: true, context: 'work' });
    expect(r.verdicts.get(1)).toEqual({ sense: null, ok: false, context: 'daily' });
    expect(r.verdicts.size).toBe(2);
    expect(parseTagAnswer({ stop_reason: 'max_tokens', content: [] } as never, x)).toEqual({ kind: 'invalid', reason: 'max_tokens' });
  });

  it('generate: the word in the sentence, a translation, at most the count', () => {
    const x: GenInput = {
      lemma_norm: 'run',
      pos: 'verb',
      cefr: 'A1',
      senses: [{ sense_id: S2, meaning_tr: 'yönetmek', count: 2, contexts: ['daily', 'work'], avoid: ['She runs a small cafe.'] }],
    };
    const r = parseGenAnswer(
      msg({
        sentences: [
          { sense: 1, context: 'work', example_en: 'My uncle ran a bakery for years.', example_tr: 'Amcam yıllarca bir fırın işletti.' },
          { sense: 1, context: 'daily', example_en: 'She runs a small cafe.', example_tr: 'Küçük bir kafe işletiyor.' },
          { sense: 1, context: 'daily', example_en: 'She manages a hotel.', example_tr: 'Bir otel yönetiyor.' },
          { sense: 2, context: 'daily', example_en: 'They run a club.', example_tr: 'Bir kulüp yönetiyorlar.' },
          { sense: 1, context: 'daily', example_en: 'They run a small club together.', example_tr: 'Birlikte küçük bir kulüp yönetiyorlar.' },
          { sense: 1, context: 'daily', example_en: 'We run a shop on Main Street.', example_tr: 'Ana caddede bir dükkân işletiyoruz.' },
        ],
      }),
      x,
    );
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.sentences.map((s) => s.en)).toEqual(['My uncle ran a bakery for years.', 'They run a small club together.']);
    expect(r.dropped).toEqual(['repeat', 'example_without_word', 'unknown_sense', 'too_many']);
  });

  it('review: unlisted items pass, fixes are checked, fixed English is never changed', () => {
    const base = { lemma_norm: 'run', pos: 'verb', cefr: 'A1', meaning_tr: 'koşmak' };
    const items: ReviewItemInput[] = [
      { ...base, en: 'I run every day.', tr: 'Her gün koşuyorum ben.', fixedEnglish: true },
      { ...base, en: 'She runs to school.', tr: 'O okula koşar.', fixedEnglish: true },
      { ...base, en: 'We ran home fast.', tr: 'Eve hızlı koştuk.', fixedEnglish: false },
      { ...base, en: 'Kids run in the park.', tr: 'Çocuklar parkta koşar.', fixedEnglish: false },
      { ...base, en: 'He runs fast.', tr: 'Hızlı koşar.', fixedEnglish: false },
    ];
    const r = parseReviewAnswer(
      msg({
        changes: [
          { item: 1, action: 'fix', example_en: '', example_tr: 'Her gün koşarım.', reason: 'unnatural' },
          { item: 2, action: 'fix', example_en: 'She runs to work.', example_tr: 'İşe koşar.', reason: 'x' },
          { item: 3, action: 'fix', example_en: 'We walked home.', example_tr: 'Eve yürüdük.', reason: 'x' },
          { item: 4, action: 'reject', example_en: '', example_tr: '', reason: 'forced' },
          { item: 9, action: 'reject', example_en: '', example_tr: '', reason: 'x' },
        ],
      }),
      items,
    );
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.outcomes[0]).toMatchObject({ kind: 'fix', tr: 'Her gün koşarım.', trEdited: true, enEdited: false });
    expect(r.outcomes[1]).toMatchObject({ kind: 'reject' });
    expect(r.outcomes[2]).toMatchObject({ kind: 'reject' }); // the fix lost the word
    expect(r.outcomes[3]).toEqual({ kind: 'reject', reason: 'forced' });
    expect(r.outcomes[4]).toEqual({ kind: 'approve' });
  });
});

// ------------------------------------------------------------------ the job

describe('the bulk example job', () => {
  it('needs three per sense, counting what is on the way, and rotates contexts', () => {
    expect(senseNeed(0, undefined)).toBe(3);
    expect(senseNeed(1, { kept: 1, rejected: 5, spare: 2 })).toBe(1);
    expect(senseNeed(2, { approved: 2 })).toBe(0);
    expect(nextContexts(1, 3)).toEqual(['conversation', 'work', 'formal']);
    expect(jobCapUsd(() => '12.5')).toBe(12.5);
    expect(jobCapUsd(() => 'lots')).toBe(15);
    expect(jobCapUsd(() => undefined)).toBe(15);
  });

  it('match → tag → generate → review → publish, with Tatoeba credited', async () => {
    const { store, batches, deps } = setup();

    const m = await runMatch(deps, new PairIndex(PAIRS), LEVELS);
    expect(m).toMatchObject({ rows: 1, rowsWithPairs: 1 });
    const candidates = await store.items(['candidate']);
    expect(candidates.length).toBeGreaterThanOrEqual(4);
    expect(candidates.every((c) => c.attribution?.license === 'CC BY 2.0 FR' && c.level_band === 'A2')).toBe(true);
    // Matching twice adds nothing.
    expect((await runMatch(deps, new PairIndex(PAIRS), LEVELS)).rows).toBe(0);

    // Tagging: generation waits for it.
    const tag = await runTagSubmit(deps, { max: 100 });
    expect(tag).toMatchObject({ step: 'tag', submitted: 1 });
    expect((await runGenerateSubmit(deps, { max: 100 })).submitted).toBe(0);
    const user = batches.userOf();
    expect(user).toContain('word: run (pos: verb, level: A1)');
    expect(user).toContain('2) yönetmek, işletmek');
    const order = user
      .split('\n')
      .filter((l) => /^ {2}\d+\) .+ \| /.test(l))
      .map((l) => l.replace(/^ {2}\d+\) /, '').split(' | ')[0]!);
    const verdict = (en: string) =>
      en.includes('shop') && en.startsWith('He')
        ? { sense: 2, ok: true, context: 'work' }
        : en.includes('company')
          ? { sense: 2, ok: false, context: 'work' }
          : { sense: 1, ok: true, context: 'daily' };
    batches.answers.set(tag.batchId ? batches.created[0]![0]!.custom_id : '', answer({ items: order.map((en, k) => ({ i: k + 1, ...verdict(en) })) }));
    const c1 = await runCollect(deps);
    const koşmak = order.filter((en) => verdict(en).sense === 1).length;
    expect(c1.tag).toMatchObject({ rows: 1, kept: Math.min(3, koşmak) + 1, spare: Math.max(0, koşmak - 3) });
    expect((await store.items(['kept'])).filter((i) => i.sense_id === S2).map((i) => i.text_en)).toEqual(['He runs a shop.']);

    // Generation: only what is missing (two more for "yönetmek").
    const gen = await runGenerateSubmit(deps, { max: 100 });
    expect(gen.submitted).toBe(1);
    const genUser = JSON.parse(batches.userOf()) as { meanings: { n: number; count: number; avoid: string[] }[] };
    expect(genUser.meanings).toEqual([
      expect.objectContaining({ n: 1, count: 2, avoid: expect.arrayContaining(['She runs a small cafe.', 'He runs a shop.']) }),
    ]);
    batches.answers.set(
      batches.created.at(-1)![0]!.custom_id,
      answer({
        sentences: [
          { sense: 1, context: 'conversation', example_en: 'My uncle ran a bakery for years.', example_tr: 'Amcam yıllarca bir fırın işletti.' },
          { sense: 1, context: 'work', example_en: 'Who runs this office?', example_tr: 'Bu ofisi kim yönetiyor?' },
        ],
      }),
    );
    const c2 = await runCollect(deps);
    expect(c2.generate).toMatchObject({ rows: 1, stored: 2 });

    // Review: one group with every kept sentence.
    const kept = await store.items(['kept']);
    const rev = await runReviewSubmit(deps, { max: 100 });
    expect(rev).toMatchObject({ step: 'review', submitted: 1 });
    const req = batches.created.at(-1)![0]!;
    expect(req.params.model).toBe(SONNET);
    const lines = (req.params.messages[0]!.content as string).split('\n').filter((l) => /^\d+\. /.test(l));
    expect(lines).toHaveLength(kept.length);
    const n = (needle: string) =>
      (req.params.messages[0]!.content as string).split('\n').findIndex((l) => l.includes(needle));
    const reviewText = req.params.messages[0]!.content as string;
    const itemNo = (en: string) => {
      const blocks = reviewText.split(/\n(?=\d+\. )/);
      return blocks.findIndex((b) => b.includes(`EN: ${en}`)) + 1;
    };
    expect(n('[fixed English]')).toBeGreaterThanOrEqual(0);
    batches.answers.set(
      req.custom_id,
      answer(
        {
          changes: [
            { item: itemNo('He runs a shop.'), action: 'fix', example_en: '', example_tr: 'Bir dükkânı var, onu işletiyor.', reason: 'clearer' },
            { item: itemNo('Who runs this office?'), action: 'reject', example_en: '', example_tr: '', reason: 'odd' },
          ],
        },
        SONNET,
      ),
    );
    const c3 = await runCollect(deps);
    expect(c3.review).toMatchObject({ items: kept.length, fixed: 1, rejected: 1, approved: kept.length - 2 });

    // Publish: Tatoeba sentences keep their credit; a corrected translation says so.
    const pub = await runPublish(deps);
    expect(pub.published).toBe(kept.length - 1);
    const shop = store.published.find((p) => p.text_en === 'He runs a shop.')!;
    expect(shop).toMatchObject({
      source: 'tatoeba',
      model: null,
      level_band: 'A2',
      context: 'work',
      translations: { tr: 'Bir dükkânı var, onu işletiyor.' },
      attribution: { license: 'CC BY 2.0 FR', en_by: 'CK', tr_by: 'tr_user', tr_edited: true },
    });
    expect(shop.text_en.slice(...shop.span)).toBe('runs');
    const bakery = store.published.find((p) => p.text_en.includes('bakery'))!;
    expect(bakery).toMatchObject({ source: null, attribution: null, model: HAIKU });
    expect(bakery.text_en.slice(...bakery.span)).toBe('ran');

    // The rejected one is replaced by a new generation request (count 1).
    const again = await runGenerateSubmit(deps, { max: 100 });
    expect(again.submitted).toBe(1);
    expect((JSON.parse(batches.userOf()) as { meanings: { count: number }[] }).meanings[0]!.count).toBe(1);

    const plan = await runPlan(deps);
    expect(plan).toMatchObject({ bankRows: 1, senses: 2 });
    expect(plan.spentUsd).toBeGreaterThan(0);
  });

  it('stops at the job cap and at the monthly budget, and dry runs send nothing', async () => {
    const { store, batches, deps } = setup({ jobCapUsd: 0.000001 });
    await runMatch(deps, new PairIndex(PAIRS), LEVELS);
    const dry = await runTagSubmit(deps, { max: 10, dryRun: true });
    expect(dry).toMatchObject({ stopped: 'dry_run', submitted: 1 });
    expect(dry.reservedUsd).toBeGreaterThan(0);
    expect(batches.created).toHaveLength(0);
    expect(await runTagSubmit(deps, { max: 10 })).toMatchObject({ stopped: 'cap', submitted: 0 });
    expect(batches.created).toHaveLength(0);
    const monthly = setup({ capUsd: 0 });
    await runMatch(monthly.deps, new PairIndex(PAIRS), LEVELS);
    expect(await runTagSubmit(monthly.deps, { max: 10 })).toMatchObject({ stopped: 'budget', submitted: 0 });
    expect(store.holds.size).toBe(0);
  });

  it('a failed or unanswered request is asked again; rows without Tatoeba pairs go to generation', async () => {
    const { store, batches, deps } = setup();
    await runMatch(deps, new PairIndex([]), LEVELS);
    expect(store.bulkRows.size).toBe(1);
    const gen = await runGenerateSubmit(deps, { max: 10 });
    expect(gen.submitted).toBe(1);
    const cid = batches.created[0]![0]!.custom_id;
    batches.answers.set(cid, { type: 'errored' });
    const c = await runCollect(deps);
    expect(c.generate.retried).toBe(1);
    const row = store.bulkRows.get('run|verb')!;
    expect(row).toMatchObject({ gen_batch_id: null, gen_attempts: 0 });
    // Asked again with the same id (an errored request is not billed or counted).
    expect((await runGenerateSubmit(deps, { max: 10 })).submitted).toBe(1);
    expect(batches.created[1]![0]!.custom_id).toBe(cid);
  });
});
