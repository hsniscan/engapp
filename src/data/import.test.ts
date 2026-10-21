import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../test/db';
import { hashChunk } from '../domain/chunking';
import { addNoteWithSenses } from './actions';
import { db } from './db';
import {
  confirmImport,
  createImportJob,
  getCachedChunk,
  getImportJob,
  listImportCandidates,
  recordChunkResult,
  type ChunkResult,
} from './import';

const T = Date.UTC(2026, 9, 21, 9);

const lex = (id: string, lemma: string, meaning: string) => ({
  id,
  term_id: `t-${lemma}`,
  lemma,
  lemma_norm: lemma,
  term_type: 'word' as const,
  pos: 'noun',
  gloss_en: `gloss of ${lemma}`,
  meaning_tr: meaning,
  ipa: '/x/',
  updated_at: T,
  // At the learner's level (B1), so smart extraction pre-selects every new word here.
  cefr: 'B1' as const,
  cefr_source: 'cefrj' as const,
});

function result(
  cands: { term: string; lexId: string; meaning: string; sentence?: string; conf?: number; match?: 'known_sense' | 'new_sense' | 'new_term' }[],
): ChunkResult {
  return {
    prompt_version: 'extract-v1',
    level: 'B1',
    candidates: cands.map((c) => {
      const sentence = c.sentence ?? `We saw the ${c.term} today.`;
      const start = sentence.indexOf(c.term);
      return {
        term: c.term,
        surface: c.term,
        term_type: 'word',
        source_sentence: sentence,
        span: [start, start + c.term.length] as [number, number],
        confidence: c.conf ?? 0.9,
        match: c.match ?? 'new_term',
        lexicon: lex(c.lexId, c.term, c.meaning),
      };
    }),
  };
}

beforeEach(resetDb);

describe('import jobs', () => {
  it('creates a source and a queued job with its chunks', async () => {
    const job = await createImportJob({ kind: 'text', title: 'Test', chunks: ['One. ', 'Two.'], level: 'B2' }, T);
    expect(job).toMatchObject({ status: 'queued', chunk_total: 2, chunk_done: 0, level: 'B2' });
    expect(await db.sources.get(job.source_id)).toMatchObject({ kind: 'text', title: 'Test' });
    expect(await db.outbox.where('table').equals('sources').count()).toBeGreaterThan(0);
    await expect(createImportJob({ kind: 'text', title: 'x', chunks: ['  '], level: 'B1' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('records chunks once, dedupes by lexicon sense, marks user status and fills the caches', async () => {
    await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'kıyı', lexicon_sense_id: 'L-bank-1' }] }, T);
    const job = await createImportJob({ kind: 'text', title: 'T', chunks: ['a', 'b'], level: 'B1' }, T);
    const r1 = result([
      { term: 'bank', lexId: 'L-bank-1', meaning: 'kıyı' }, // exists
      { term: 'bank', lexId: 'L-bank-2', meaning: 'banka', sentence: 'The bank lent us money.' }, // add_sense
      { term: 'cope', lexId: 'L-cope', meaning: 'başa çıkmak' }, // new
    ]);
    expect(await recordChunkResult(job.id, 0, 'h0', r1, { fromLocalCache: false, lexiconHits: 1 }, T)).toEqual({ added: 3 });
    // A repeated record of the same chunk (another tab) is ignored.
    expect(await recordChunkResult(job.id, 0, 'h0', r1, { fromLocalCache: false }, T)).toEqual({ added: 0 });
    const r2 = result([{ term: 'cope', lexId: 'L-cope', meaning: 'başa çıkmak' }]);
    await recordChunkResult(job.id, 1, 'h1', r2, { fromLocalCache: true }, T);

    // Words with a note are never pre-selected (smart extraction); the preview shows
    // "Senin için" first (rank).
    const cands = await listImportCandidates(job.id);
    expect(cands.map((c) => [c.term, c.user_status, c.selected, c.bucket, c.rank])).toEqual([
      ['bank', 'exists', false, 'known', 1],
      ['bank', 'add_sense', false, 'known', 2],
      ['cope', 'new', true, 'for_you', 0],
    ]);
    const j = (await getImportJob(job.id))!;
    expect(j).toMatchObject({ status: 'ready', chunk_done: 2, chunk_cache_hits: 1, cache_hits: 2 });
    expect(await db.lexicon_cache.count()).toBe(3);
    expect(await db.chunk_cache.get('h0')).toBeTruthy();
    expect(await db.chunk_cache.get('h1')).toBeUndefined(); // came from it, not stored again
  });

  it('chunk cache lookups respect the level and the prompt version', async () => {
    const h = await hashChunk('Some text.');
    await db.chunk_cache.put({ chunk_hash: h, result: result([]), created_at: T });
    expect(await getCachedChunk(h, 'B1')).not.toBeNull();
    expect(await getCachedChunk(h, 'C1')).toBeNull();
    expect(await getCachedChunk(h, 'B1', 'extract-v1')).not.toBeNull();
    expect(await getCachedChunk(h, 'B1', 'extract-v2')).toBeNull();
  });

  it('a re-imported list entry with the same example sentence counts as existing', async () => {
    // Added from the list before; a newer prompt words the sense differently (new lexicon id).
    const sentence = 'We saw the bad weather today.';
    await addNoteWithSenses({ term: 'bad', senses: [{ meaning_tr: 'kötü', lexicon_sense_id: 'L-old', source_sentence: sentence }] }, T);
    const job = await createImportJob({ kind: 'text', title: 'T', chunks: ['a'], level: 'B1' }, T);
    await recordChunkResult(
      job.id,
      0,
      'h0',
      result([
        { term: 'bad', lexId: 'L-new', meaning: 'fena', sentence },
        { term: 'bad', lexId: 'L-other', meaning: 'bozuk', sentence: 'The milk went bad today.' },
      ]),
      { fromLocalCache: true },
      T,
    );
    expect((await listImportCandidates(job.id)).map((c) => [c.user_status, c.selected])).toEqual([
      ['exists', false],
      ['add_sense', false],
    ]);
  });
});

describe('confirmImport', () => {
  it('creates notes, senses (lexicon-linked) and cards in one transaction and marks the job done', async () => {
    await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'kıyı', lexicon_sense_id: 'L-bank-1' }] }, T);
    const job = await createImportJob({ kind: 'text', title: 'T', chunks: ['a'], level: 'B1' }, T);
    await recordChunkResult(
      job.id,
      0,
      'h',
      result([
        { term: 'bank', lexId: 'L-bank-1', meaning: 'kıyı' },
        { term: 'bank', lexId: 'L-bank-2', meaning: 'banka', sentence: 'The bank lent us money.' },
        { term: 'cope', lexId: 'L-cope', meaning: 'başa çıkmak' },
        { term: 'thrive', lexId: 'L-thrive', meaning: 'gelişmek' },
      ]),
      { fromLocalCache: false },
      T,
    );
    const cands = await listImportCandidates(job.id);
    const byTerm = (t: string, lexId: string) => cands.find((c) => c.term === t && c.lexicon_sense_id === lexId)!;
    const choices = new Map(cands.map((c) => [c.id, { selected: c.selected, meaning_tr_edit: null as string | null }]));
    choices.set(byTerm('thrive', 'L-thrive').id, { selected: false, meaning_tr_edit: null });
    choices.set(byTerm('cope', 'L-cope').id, { selected: true, meaning_tr_edit: 'üstesinden gelmek' });
    // A new meaning of a word with cards is not pre-selected; the user picks it.
    choices.set(byTerm('bank', 'L-bank-2').id, { selected: true, meaning_tr_edit: null });

    const res = await confirmImport(job.id, { choices, now: T + 1 });
    expect(res).toMatchObject({ notesCreated: 1, sensesAdded: 2 });
    const cope = (await db.notes.where('term_norm').equals('cope').first())!;
    const copeSense = (await db.senses.where('note_id').equals(cope.id).first())!;
    expect(copeSense).toMatchObject({
      lexicon_sense_id: 'L-cope',
      meaning_tr: 'başa çıkmak',
      meaning_tr_override: 'üstesinden gelmek',
      gloss_en: 'gloss of cope',
      source_id: job.source_id,
    });
    expect(copeSense.span).not.toBeNull(); // → cloze card
    expect(await db.cards.where('note_id').equals(cope.id).count()).toBe(3); // recognition, production, cloze
    expect(cope.lexicon_term_id).toBe('t-cope');
    const bank = (await db.notes.where('term_norm').equals('bank').toArray())[0]!;
    expect(await db.senses.where('note_id').equals(bank.id).count()).toBe(2);
    expect(await db.notes.where('term_norm').equals('thrive').count()).toBe(0);
    expect((await getImportJob(job.id))!.status).toBe('done');
    await expect(confirmImport(job.id)).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('carries the sentence translation into the sense; older cached results give null', async () => {
    const job = await createImportJob({ kind: 'text', title: 'T', chunks: ['a'], level: 'B1' }, T);
    const r = result([
      { term: 'cope', lexId: 'L-cope', meaning: 'başa çıkmak' },
      { term: 'bank', lexId: 'L-bank', meaning: 'banka' },
    ]);
    r.candidates[0]!.sentence_tr = 'Bugün baş ettik.'; // the second has no sentence_tr (extract-v1 cache)
    await recordChunkResult(job.id, 0, 'h0', r, { fromLocalCache: true }, T);
    expect((await listImportCandidates(job.id)).map((c) => c.source_sentence_tr)).toEqual(['Bugün baş ettik.', null]);
    await confirmImport(job.id, { now: T + 1 });
    const senses = await db.senses.toArray();
    expect(senses.map((s) => [s.meaning_tr, s.source_sentence_tr]).sort()).toEqual([
      ['banka', null],
      ['başa çıkmak', 'Bugün baş ettik.'],
    ]);
  });

  it('rolls everything back when a write fails', async () => {
    const job = await createImportJob({ kind: 'text', title: 'T', chunks: ['a'], level: 'B1' }, T);
    await recordChunkResult(
      job.id,
      0,
      'h',
      result([
        { term: 'cope', lexId: 'L-cope', meaning: 'başa çıkmak' },
        { term: 'thrive', lexId: 'L-thrive', meaning: 'gelişmek' },
      ]),
      { fromLocalCache: false },
      T,
    );
    const notesBefore = await db.notes.count();
    const outboxBefore = await db.outbox.count();
    const orig = db.cards.hook('creating');
    let n = 0;
    const fail = () => {
      if (++n > 3) throw new Error('disk full');
    };
    orig.subscribe(fail);
    await expect(confirmImport(job.id)).rejects.toThrow('disk full');
    orig.unsubscribe(fail);
    expect(await db.notes.count()).toBe(notesBefore);
    expect(await db.outbox.count()).toBe(outboxBefore);
    expect((await getImportJob(job.id))!.status).toBe('ready');
  });
});

describe('one sense per note and sentence ("invitation": "davetiye, davet" / "davet")', () => {
  const S = 'Thank you very much for the invitation.';

  it('keeps one candidate per term and sentence across chunks: known sense first, then confidence', async () => {
    const job = await createImportJob({ kind: 'text', title: 'T', chunks: ['a', 'b'], level: 'B1' }, T);
    await recordChunkResult(
      job.id,
      0,
      'h0',
      result([
        { term: 'invitation', lexId: 'L-go', meaning: 'davet', sentence: S, conf: 0.99 },
        { term: 'invitation', lexId: 'L-go2', meaning: 'çağrı', sentence: S, conf: 0.5 },
        { term: 'party', lexId: 'L-party', meaning: 'parti', sentence: 'We had a party.' },
      ]),
      { fromLocalCache: true },
      T,
    );
    expect((await listImportCandidates(job.id)).map((c) => c.lexicon_sense_id)).toEqual(['L-go', 'L-party']);
    await recordChunkResult(
      job.id,
      1,
      'h1',
      result([{ term: 'invitation', lexId: 'L-attend', meaning: 'davetiye, davet', sentence: S, conf: 0.8, match: 'known_sense' }]),
      { fromLocalCache: true },
      T,
    );
    const cands = await listImportCandidates(job.id);
    expect(cands.map((c) => c.lexicon_sense_id)).toEqual(['L-attend', 'L-party']); // in the twin's place
    await confirmImport(job.id, { now: T + 1 });
    const note = (await db.notes.where('term_norm').equals('invitation').first())!;
    expect((await db.senses.where('note_id').equals(note.id).toArray()).map((s) => s.meaning_tr)).toEqual(['davetiye, davet']);
  });

  it('prefers the sense the user already has', async () => {
    await addNoteWithSenses({ term: 'invitation', senses: [{ meaning_tr: 'davet', pos: 'noun', lexicon_sense_id: 'L-go', source_sentence: S }] }, T);
    const job = await createImportJob({ kind: 'text', title: 'T', chunks: ['a'], level: 'B1' }, T);
    await recordChunkResult(
      job.id,
      0,
      'h0',
      result([
        { term: 'invitation', lexId: 'L-attend', meaning: 'davetiye, davet', sentence: S, conf: 0.99, match: 'known_sense' },
        { term: 'invitation', lexId: 'L-go', meaning: 'davet', sentence: S, conf: 0.6 },
      ]),
      { fromLocalCache: true },
      T,
    );
    expect((await listImportCandidates(job.id)).map((c) => [c.lexicon_sense_id, c.user_status])).toEqual([['L-go', 'exists']]);
  });

  it('a re-import never adds a second sense for the same sentence, even when the user selects it', async () => {
    await addNoteWithSenses(
      { term: 'invitation', senses: [{ meaning_tr: 'davetiye, davet', pos: 'noun', lexicon_sense_id: 'L-attend', source_sentence: S }] },
      T,
    );
    const job = await createImportJob({ kind: 'text', title: 'T', chunks: ['a'], level: 'B1' }, T);
    await recordChunkResult(job.id, 0, 'h0', result([{ term: 'invitation', lexId: 'L-go', meaning: 'çağrı', sentence: S }]), { fromLocalCache: true }, T);
    const [cand] = await listImportCandidates(job.id);
    expect(cand!.user_status).toBe('exists'); // same sentence
    const res = await confirmImport(job.id, { choices: new Map([[cand!.id, { selected: true, meaning_tr_edit: null }]]), now: T + 1 });
    expect(res).toMatchObject({ sensesAdded: 0, skipped: 1 });
    expect(await db.senses.count()).toBe(1);
  });

  it('an overlapping Turkish meaning with the same part of speech counts as existing and is not added', async () => {
    await addNoteWithSenses(
      {
        term: 'invitation',
        senses: [{ meaning_tr: 'davetiye, davet', pos: 'noun', lexicon_sense_id: 'L-attend', source_sentence: 'I got an invitation.' }],
      },
      T,
    );
    const job = await createImportJob({ kind: 'text', title: 'T', chunks: ['a'], level: 'B1' }, T);
    await recordChunkResult(
      job.id,
      0,
      'h0',
      result([
        { term: 'invitation', lexId: 'L-go', meaning: 'davet', sentence: S },
        { term: 'invitation', lexId: 'L-lure', meaning: 'teşvik', sentence: 'It was an invitation to thieves.' },
      ]),
      { fromLocalCache: true },
      T,
    );
    const cands = await listImportCandidates(job.id);
    expect(cands.map((c) => [c.lexicon_sense_id, c.user_status])).toEqual([
      ['L-go', 'exists'],
      ['L-lure', 'add_sense'],
    ]);
    const res = await confirmImport(job.id, { choices: new Map(cands.map((c) => [c.id, { selected: true, meaning_tr_edit: null }])), now: T + 1 });
    expect(res).toMatchObject({ sensesAdded: 1, skipped: 1 });
    expect((await db.senses.toArray()).map((s) => s.meaning_tr).sort()).toEqual(['davetiye, davet', 'teşvik']);
  });
});
