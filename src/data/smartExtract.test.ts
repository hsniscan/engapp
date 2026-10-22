import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseClientLevels } from '../domain/level';
import type { CefrLevel, LevelSource } from '../domain/types';
import { resetDb } from '../test/db';
import { addNoteWithSenses } from './actions';
import {
  createImportJob,
  listImportCandidates,
  recordChunkResult,
  type ChunkResult,
} from './import';
import { setKnownTermsProvider, type KnownTermMarkSource } from './knownTermsProvider';
import { setLevelDataForTests } from './levelData';
import { getKnownTermKeys, listKnownTerms, markKnown } from './knownTerms';
import { markCandidateKnown, refreshKnownCandidates } from './smartExtract';

const T = Date.UTC(2026, 9, 22, 9);

interface Spec {
  term: string;
  cefr?: CefrLevel | null;
  source?: LevelSource;
  sentence?: string;
  pos?: string;
}

function result(specs: Spec[]): ChunkResult {
  return {
    prompt_version: 'extract-v4',
    level: 'B1',
    candidates: specs.map((c, i) => {
      const sentence = c.sentence ?? `We saw the ${c.term} today.`;
      const start = sentence.indexOf(c.term);
      return {
        term: c.term,
        surface: c.term,
        term_type: 'word',
        source_sentence: sentence,
        span: [start, start + c.term.length] as [number, number],
        confidence: 0.9,
        match: 'new_term',
        lexicon: {
          id: `L-${c.term}-${i}`,
          term_id: `t-${c.term}`,
          lemma: c.term,
          lemma_norm: c.term,
          term_type: 'word',
          pos: c.pos ?? 'noun',
          gloss_en: `gloss of ${c.term}`,
          meaning_tr: `anlam ${c.term}`,
          ipa: null,
          updated_at: T,
          cefr: c.cefr === undefined ? 'B1' : c.cefr,
          cefr_source: c.cefr === null ? null : (c.source ?? 'cefrj'),
        },
      };
    }),
  };
}

async function runJob(chunks: string[], results: ChunkResult[], level: CefrLevel = 'B1') {
  const job = await createImportJob({ kind: 'text', title: 'T', chunks, level }, T);
  for (const [i, r] of results.entries())
    await recordChunkResult(job.id, i, `h${i}`, r, { fromLocalCache: true }, T);
  const rows = await listImportCandidates(job.id);
  return { job, rows, by: (term: string) => rows.find((r) => r.term === term)! };
}

const marked: [string, KnownTermMarkSource][] = [];

beforeEach(async () => {
  await resetDb();
  marked.length = 0;
  setKnownTermsProvider(null);
  setLevelDataForTests(null);
});
afterEach(() => {
  setKnownTermsProvider(null);
  setLevelDataForTests(null);
});

describe('smart extraction on the device', () => {
  it('classifies only when the last chunk is in, then follows the level rule', async () => {
    const job = await createImportJob(
      { kind: 'text', title: 'T', chunks: ['one', 'two'], level: 'B1' },
      T,
    );
    await recordChunkResult(
      job.id,
      0,
      'h0',
      result([{ term: 'cope' }, { term: 'subsidy', cefr: 'C1' }]),
      { fromLocalCache: true },
      T,
    );
    let rows = await listImportCandidates(job.id);
    expect(rows.map((r) => r.bucket)).toEqual([null, null]);
    await recordChunkResult(
      job.id,
      1,
      'h1',
      result([
        { term: 'house', cefr: 'A1' },
        { term: 'thrive', cefr: 'B2' },
        { term: 'gadget', cefr: null },
      ]),
      { fromLocalCache: true },
      T,
    );
    rows = await listImportCandidates(job.id);
    const view = Object.fromEntries(rows.map((r) => [r.term, [r.bucket, r.selected, r.cefr]]));
    expect(view).toEqual({
      cope: ['for_you', true, 'B1'],
      house: ['easy', false, 'A1'], // one B1 word: a second (lower) word would be 50 % < 55 %
      thrive: ['for_you', false, 'B2'], // L+1 only from 10 selected words on
      gadget: ['for_you', false, null], // unknown level counts as L+1
      subsidy: ['too_hard', false, 'C1'],
    });
  });

  it('never pre-selects words the learner knows; the known list comes from the provider', async () => {
    setKnownTermsProvider({
      getKnownTermKeys: () => Promise.resolve(new Set(['cope'])),
      markKnown: () => Promise.resolve(),
    });
    await addNoteWithSenses(
      { term: 'Thrive', senses: [{ meaning_tr: 'gelişmek', lexicon_sense_id: 'other' }] },
      T,
    );
    const { by } = await runJob(
      ['x'],
      [
        result([
          { term: 'cope' },
          { term: 'thrive', sentence: 'Plants thrive here.' },
          { term: 'tackle' },
        ]),
      ],
    );
    expect([by('cope').bucket, by('cope').selected]).toEqual(['known', false]);
    expect([by('thrive').bucket, by('thrive').selected, by('thrive').user_status]).toEqual([
      'known',
      false,
      'add_sense',
    ]);
    expect([by('tackle').bucket, by('tackle').selected]).toEqual(['for_you', true]);
  });

  it('a failing known-terms provider does not stop the import', async () => {
    setKnownTermsProvider({
      getKnownTermKeys: () => Promise.reject(new Error('no table')),
      markKnown: () => Promise.resolve(),
    });
    const { by } = await runJob(['x'], [result([{ term: 'cope' }])]);
    expect(by('cope').bucket).toBe('for_you');
  });

  it('levels missing in the lexicon come from the client level file', async () => {
    setLevelDataForTests(
      parseClientLevels(
        ['# @min_zipf 3', 'gadget\t2.5\t', 'cope\t4.0\tv:B1:j', 'house\t6.0\tn:A1:j'].join('\n'),
      ),
    );
    const { by } = await runJob(
      ['The house. A gadget. We cope. We cope again.'],
      [
        result([
          { term: 'gadget', cefr: null },
          { term: 'cope', cefr: null, pos: 'verb' },
          { term: 'house', cefr: null },
        ]),
      ],
    );
    expect([by('cope').cefr, by('cope').cefr_source]).toEqual(['B1', 'cefrj']);
    expect([by('gadget').cefr, by('gadget').cefr_source]).toEqual(['C1', 'freq']);
    expect(by('gadget').bucket).toBe('too_hard');
    // Ranked: "cope" occurs twice and comes first.
    expect(by('cope').rank).toBe(0);
  });

  it('a vocabulary list keeps every entry: harder entries are listed (not dropped), in list order', async () => {
    const list = Array.from({ length: 12 }, (_, i) => `${i + 1} word${i} This is word${i}.`).join(
      ' ',
    );
    const specs: Spec[] = [
      { term: 'alpha', cefr: 'B1', sentence: 'alpha one.' },
      { term: 'beta', cefr: 'C2', sentence: 'beta two.' },
      { term: 'gamma', cefr: 'A1', sentence: 'gamma three.' },
      { term: 'delta', cefr: 'B1', sentence: 'delta four.' },
    ];
    const { rows, by } = await runJob([list], [result(specs)]);
    expect(rows.every((r) => r.from_list)).toBe(true);
    expect([by('beta').bucket, by('beta').selected]).toEqual(['too_hard', false]);
    expect(rows.filter((r) => r.selected).map((r) => r.term)).toEqual(['alpha', 'gamma', 'delta']);
    // Inside "Senin için" the list's own order.
    expect(['alpha', 'gamma', 'delta'].map((t) => by(t).rank)).toEqual([0, 1, 2]);
  });

  it('"Biliyorum" moves every candidate of the term to "Biliyorsun" and tells the provider', async () => {
    setKnownTermsProvider({
      getKnownTermKeys: () => Promise.resolve(new Set()),
      markKnown: (term, source) => {
        marked.push([term, source]);
        return Promise.resolve();
      },
    });
    const { job } = await runJob(
      ['x'],
      [
        result([
          { term: 'bank' },
          { term: 'bank', sentence: 'The bank of the river.' },
          { term: 'cope' },
        ]),
      ],
    );
    const first = (await listImportCandidates(job.id)).find((r) => r.term === 'bank')!;
    const moved = await markCandidateKnown(first.id);
    expect(moved).toHaveLength(2);
    const rows = await listImportCandidates(job.id);
    expect(rows.map((r) => [r.term, r.bucket, r.selected])).toEqual([
      ['bank', 'known', false],
      ['bank', 'known', false],
      ['cope', 'for_you', true],
    ]);
    expect(marked).toEqual([['bank', 'preview']]);
    expect(await markCandidateKnown('missing')).toEqual([]);
  });

  it('by default "Biliyorum" is an İP3 known word, and a later import does not offer it', async () => {
    const first = await runJob(['x'], [result([{ term: 'Cope' }, { term: 'widespread' }])]);
    await markCandidateKnown(first.by('Cope').id);
    expect((await listKnownTerms()).map((k) => [k.term_norm, k.source])).toEqual([
      ['cope', 'preview'],
    ]);
    // Same key as the import uses (normalizeTerm): the next text's "cope" starts known.
    const next = await runJob(['y'], [result([{ term: 'cope' }, { term: 'reluctant' }])]);
    expect([next.by('cope').bucket, next.by('cope').selected]).toEqual(['known', false]);
    expect(next.by('reluctant').bucket).toBe('for_you');
  });

  it('opening the preview moves words marked known since the job ran', async () => {
    const { job, by } = await runJob(['x'], [result([{ term: 'cope' }, { term: 'thrive' }])]);
    expect([by('cope').bucket, by('cope').selected]).toEqual(['for_you', true]);
    await markKnown('cope', 'manual', T + 1);
    expect(await getKnownTermKeys()).toEqual(new Set(['cope']));
    expect(await refreshKnownCandidates(job.id)).toEqual([by('cope').id]);
    const rows = await listImportCandidates(job.id);
    expect(rows.map((r) => [r.term, r.bucket, r.selected])).toEqual([
      ['cope', 'known', false],
      ['thrive', 'for_you', true],
    ]);
    expect(await refreshKnownCandidates(job.id)).toEqual([]);
  });
});
