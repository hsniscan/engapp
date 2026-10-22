// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { WordRefs } from './level.ts';
import {
  buildLevelGuessUserPrompt,
  buildLevelTrUserPrompt,
  cleanTrReason,
  LEVEL_GUESS_RESPONSE_SCHEMA,
  LEVEL_JOB_BATCH,
  LEVEL_TR_PROMPT_VERSION,
  LEVEL_TR_RESPONSE_SCHEMA,
  levelGuessResults,
  levelTrResults,
  looksBorrowed,
  needsGuess,
  planLevels,
  type LevelSenseRow,
  type TrPendingItem,
} from './level-job.ts';

const items: TrPendingItem[] = [
  { lemma_norm: 'television', pos: 'noun', source: 'cefrj', cefr: 'A2' },
  { lemma_norm: 'actually', pos: 'adverb', source: 'cefrj', cefr: 'A2' },
  { lemma_norm: 'lend', pos: 'verb', source: 'cefrj', cefr: 'A2' },
  { lemma_norm: 'calendar', pos: 'noun', source: 'cefrj', cefr: 'A2' },
  { lemma_norm: 'house', pos: 'noun', source: 'cefrj', cefr: 'A1' },
];

describe('level-tr-v1', () => {
  it('asks for about 100 words per call, with refs', () => {
    expect(LEVEL_JOB_BATCH).toBe(100);
    expect(buildLevelTrUserPrompt(items.slice(0, 2))).toBe(
      'WORDS:\nw1 | television | noun | A2\nw2 | actually | adverb | A2',
    );
    expect(LEVEL_TR_RESPONSE_SCHEMA.properties.changes.items.required).toEqual([
      'ref',
      'kind',
      'level',
      'reason_tr',
    ]);
  });

  it('keeps valid changes, one result per word, and clamps to one step', () => {
    const out = levelTrResults(
      items,
      {
        changes: [
          { ref: 'w1', kind: 'loanword', level: 'A1', reason_tr: "Türkçede 'televizyon'." },
          // Two steps: clamped to one.
          { ref: 'w2', kind: 'false_friend', level: 'B2', reason_tr: "'aktüel' ile karışır" },
          { ref: 'w3', kind: 'one_turkish_word', level: 'B1', reason_tr: "Türkçede ikisi de 'ödünç'" },
          // A translation, not a loanword.
          { ref: 'w4', kind: 'loanword', level: 'A1', reason_tr: "Türkçede 'takvim'" },
          // A1 cannot get easier; and an unknown ref.
          { ref: 'w5', kind: 'loanword', level: 'A1', reason_tr: "Türkçede 'hause'" },
          { ref: 'w9', kind: 'loanword', level: 'A1', reason_tr: "Türkçede 'x'" },
        ],
      },
      'm',
    );
    expect(out).toHaveLength(items.length);
    expect(out.map((r) => [r.lemma_norm, r.base_cefr, r.cefr, r.reason])).toEqual([
      ['television', 'A2', 'A1', "Türkçede 'televizyon'"],
      ['actually', 'A2', 'B1', "'aktüel' ile karışır"],
      ['lend', 'A2', 'B1', "Türkçede ikisi de 'ödünç'"],
      ['calendar', 'A2', null, null],
      ['house', 'A1', null, null],
    ]);
    expect(out.every((r) => r.model === 'm' && r.prompt_version === LEVEL_TR_PROMPT_VERSION)).toBe(true);
  });

  it('rejects changes against their kind, without a reason, or with an unsafe reason', () => {
    const out = levelTrResults(
      items,
      {
        changes: [
          { ref: 'w1', kind: 'loanword', level: 'B1', reason_tr: "Türkçede 'televizyon'" }, // harder
          { ref: 'w2', kind: 'false_friend', level: 'A1', reason_tr: "'aktüel' ile karışır" }, // easier
          { ref: 'w3', kind: 'one_turkish_word', level: 'B1', reason_tr: '' },
          { ref: 'w4', kind: 'mystery', level: 'B1', reason_tr: 'x' },
          { ref: 'w2', kind: 'false_friend', level: 'B1', reason_tr: 'https://evil.example' },
        ],
      },
      'm',
    );
    expect(out.every((r) => r.cefr === null && r.reason === null)).toBe(true);
    expect(levelTrResults(items, { nope: 1 }, 'm').every((r) => r.cefr === null)).toBe(true);
  });

  it('cleanTrReason normalises quotes and length', () => {
    expect(cleanTrReason('  Türkçede “televizyon”. ')).toBe("Türkçede 'televizyon'");
    expect(cleanTrReason('x'.repeat(81))).toBeNull();
    expect(cleanTrReason('Türkçede <b>x</b>')).toBeNull();
    expect(cleanTrReason(5)).toBeNull();
  });

  it('looksBorrowed tells loanwords from translations', () => {
    expect(looksBorrowed('television', "Türkçede 'televizyon'")).toBe(true);
    expect(looksBorrowed('certificate', "Türkçede 'sertifika'")).toBe(true);
    expect(looksBorrowed('psychology', "Türkçede 'psikoloji'")).toBe(true);
    expect(looksBorrowed('actually', "'aktüel' ile karışır, anlamı 'aslında'")).toBe(true);
    expect(looksBorrowed('calendar', "Türkçede 'takvim'")).toBe(false);
    expect(looksBorrowed('lifestyle', "Türkçede 'yaşam tarzı'")).toBe(false);
    expect(looksBorrowed('television', 'Türkçede televizyon')).toBe(false);
  });
});

describe('level-guess-v1', () => {
  const targets = [
    { id: 'a', lemma_norm: 'bank', pos: 'noun', gloss_en: 'the land beside a river' },
    { id: 'b', lemma_norm: 'give up', pos: 'phrasal verb', gloss_en: 'stop  trying' },
  ];

  it('builds the prompt and reads the answer in order', () => {
    expect(buildLevelGuessUserPrompt(targets)).toBe(
      'SENSES:\ns1 | bank | noun | the land beside a river\ns2 | give up | phrasal verb | stop trying',
    );
    expect(LEVEL_GUESS_RESPONSE_SCHEMA.required).toEqual(['levels']);
    expect(
      levelGuessResults(targets, {
        levels: [
          { ref: 's2', level: 'a2' },
          { ref: 's1', level: 'B1' },
          { ref: 's1', level: 'C2' },
          { ref: 's7', level: 'C2' },
        ],
      }),
    ).toEqual(['B1', 'A2']);
    expect(levelGuessResults(targets, { levels: [{ ref: 's1', level: 'X' }] })).toEqual([null, null]);
    expect(levelGuessResults(targets, null)).toEqual([null, null]);
  });
});

describe('planLevels', () => {
  const refs: Record<string, WordRefs> = {
    abandon: {
      refs: [{ pos: 'verb', cefr: 'B1', source: 'cefrj', tr_cefr: 'B2', tr_reason: 'Türkçede soyut' }],
      zipf: 3.9,
    },
    mitigate: { refs: [], zipf: 3.1 },
  };
  const lookup = (l: string) => refs[l];
  const row = (over: Partial<LevelSenseRow>): LevelSenseRow => ({
    id: 's1',
    term_id: 't1',
    lemma_norm: 'abandon',
    term_type: 'word',
    pos: 'verb',
    gloss_en: 'leave',
    zipf: 3.9,
    cefr: null,
    cefr_source: null,
    cefr_list: null,
    cefr_reason_tr: null,
    cefr_guess: null,
    cefr_guess_at: null,
    ...over,
  });

  it('writes only senses whose level changes, and term frequencies that differ', () => {
    const stale = row({});
    const current = row({
      id: 's2',
      cefr: 'B2',
      cefr_source: 'cefrj',
      cefr_list: 'B1',
      cefr_reason_tr: 'Türkçede soyut',
    });
    const mitigate = row({ id: 's3', term_id: 't3', lemma_norm: 'mitigate', zipf: null });
    const plan = planLevels([stale, current, mitigate], lookup, { minZipf: 3 });
    expect(plan.senses).toEqual([
      { id: 's1', cefr: 'B2', cefr_source: 'cefrj', cefr_list: 'B1', cefr_reason_tr: 'Türkçede soyut' },
      { id: 's3', cefr: 'B2', cefr_source: 'freq', cefr_list: null, cefr_reason_tr: null },
    ]);
    expect(plan.terms).toEqual([{ id: 't3', zipf: 3.1 }]);
  });

  it('writes every asked guess, even when the level stays', () => {
    const r = row({ id: 's3', lemma_norm: 'mitigate', zipf: 3.1, cefr: 'B2', cefr_source: 'freq' });
    const plan = planLevels([r], lookup, { minZipf: 3 }, new Map([['s3', 'C1']]));
    expect(plan.senses).toEqual([
      { id: 's3', cefr: 'C1', cefr_source: 'ai', cefr_list: null, cefr_reason_tr: null, cefr_guess: 'C1', guess_asked: true },
    ]);
    const none = planLevels([r], lookup, { minZipf: 3 }, new Map([['s3', null]]));
    expect(none.senses[0]).toMatchObject({ cefr: 'B2', cefr_guess: null, guess_asked: true });
  });

  it('needsGuess: senses outside the lists that were never asked', () => {
    expect(needsGuess(row({}), lookup)).toBe(false); // in the list
    expect(needsGuess(row({ lemma_norm: 'mitigate' }), lookup)).toBe(true);
    expect(needsGuess(row({ lemma_norm: 'mitigate', cefr_guess_at: '2026-10-21' }), lookup)).toBe(false);
    expect(needsGuess(row({ lemma_norm: 'mitigate', cefr_guess: 'B2' }), lookup)).toBe(false);
  });
});
