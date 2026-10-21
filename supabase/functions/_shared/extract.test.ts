// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { runExtract, sha256Hex, validateExtractOutput, type PipelineDeps } from './extract.ts';
import {
  AiError,
  createGeminiProvider,
  type AiProvider,
  type GenerateJsonRequest,
} from './ai-provider.ts';
import { extractResponse } from './contracts.ts';
import { ApiError } from './errors.ts';
import { MemoryAiStore } from './testing/memory-store.ts';
import {
  CHUNK,
  envelope,
  fakeFetch,
  GOOD_EXTRACT,
  HALLUCINATED_SENTENCE,
  knownSenseExtract,
  MISSING_FIELD,
  QUOTA_ERROR_BODY,
} from './testing/gemini-fixtures.ts';

function scripted(...outputs: (unknown | Error)[]) {
  const requests: GenerateJsonRequest[] = [];
  let i = 0;
  const provider: AiProvider = {
    name: 'fake',
    generateJson: vi.fn(async (req: GenerateJsonRequest) => {
      requests.push(req);
      const out = outputs[Math.min(i++, outputs.length - 1)];
      if (out instanceof Error) throw out;
      return { data: out, model: 'fake-model', attempts: 1, usage: null };
    }),
  };
  return { provider, requests };
}

function deps(
  store: MemoryAiStore,
  provider: AiProvider,
  over: Partial<PipelineDeps> = {},
): PipelineDeps {
  return { userId: 'user-1', store, provider: () => provider, dailyLimit: 200, ...over };
}

async function body(text = CHUNK, level = 'B1') {
  return { text, chunk_hash: await sha256Hex(text), level };
}

describe('runExtract', () => {
  it('returns validated candidates with lexicon data and inserts new senses', async () => {
    const store = new MemoryAiStore();
    const { provider } = scripted(GOOD_EXTRACT);
    const res = await runExtract(await body(), deps(store, provider));

    expect(() => extractResponse.parse(res)).not.toThrow();
    expect(res).toMatchObject({
      cache_hit: false,
      ai_called: true,
      model: 'fake-model',
      usage: { used: 1, limit: 200 },
    });
    expect(res.candidates.map((c) => [c.term, c.surface, c.match])).toEqual([
      ['give up', 'gave up', 'new_term'],
      ['bank', 'bank', 'new_term'],
      ['turn down', 'turned her application down', 'new_term'],
    ]);
    const bank = res.candidates[1]!;
    expect(bank.source_sentence.slice(bank.span[0], bank.span[1])).toBe('bank');
    expect(bank.lexicon).toMatchObject({
      lemma: 'bank',
      pos: 'noun',
      gloss_en: 'the land beside a river',
      meaning_tr: 'kıyı',
    });
    expect(store.senses.size).toBe(3);
  });

  it('never calls the model twice for the same chunk (server chunk cache)', async () => {
    const store = new MemoryAiStore();
    const { provider } = scripted(GOOD_EXTRACT);
    const first = await runExtract(await body(), deps(store, provider));
    store.calls = [];
    const second = await runExtract(await body(), deps(store, provider));

    expect(provider.generateJson).toHaveBeenCalledTimes(1);
    expect(store.calls).not.toContain('consumeAi'); // cache hits are free
    expect(second.cache_hit).toBe(true);
    expect(second.ai_called).toBe(false);
    expect(second.candidates.map((c) => c.lexicon.id)).toEqual(
      first.candidates.map((c) => c.lexicon.id),
    );
    expect(second.candidates.every((c) => c.lexicon_hit)).toBe(true);
  });

  it('a different level is a different cache entry', async () => {
    const store = new MemoryAiStore();
    const { provider } = scripted(GOOD_EXTRACT);
    await runExtract(await body(CHUNK, 'B1'), deps(store, provider));
    await runExtract(await body(CHUNK, 'C1'), deps(store, provider));
    expect(provider.generateJson).toHaveBeenCalledTimes(2);
  });

  it('offers existing senses to the model and does not regenerate them', async () => {
    const store = new MemoryAiStore();
    const river = store.seed(
      'bank',
      'noun',
      'the land beside a river',
      'beside land river',
      'kıyı',
      '/bæŋk/',
    );
    const { provider, requests } = scripted(knownSenseExtract('s1'));
    const res = await runExtract(await body(), deps(store, provider));

    expect(requests[0]!.user).toContain('s1 | bank | noun | the land beside a river');
    expect(res.candidates[0]).toMatchObject({ match: 'known_sense', lexicon_hit: true });
    expect(res.candidates[0]!.lexicon.id).toBe(river.sense_id);
    expect(res.candidates[1]).toMatchObject({ match: 'new_sense', lexicon_hit: false });
    expect(res.candidates[1]!.lexicon.meaning_tr).toBe('banka');
    expect(res.candidates[1]!.lexicon.ipa).toBe('/bæŋk/'); // copied from the known term
    expect(store.terms.size).toBe(1);
    expect(store.senses.size).toBe(2);
  });

  it('reuses an existing sense when the model rewrites the same gloss (no duplicate)', async () => {
    const store = new MemoryAiStore();
    store.seed('bank', 'noun', 'the land beside a river', 'beside land river', 'kıyı');
    const reworded = structuredClone(GOOD_EXTRACT);
    reworded.candidates[1]!.gloss_en = 'Land beside rivers';
    reworded.candidates[1]!.meaning_tr = 'nehir kenarı';
    const { provider } = scripted(reworded);
    const res = await runExtract(await body(), deps(store, provider));
    expect(res.candidates[1]).toMatchObject({ match: 'known_sense', lexicon_hit: true });
    expect(res.candidates[1]!.lexicon.meaning_tr).toBe('kıyı');
    expect(
      [...store.senses.values()].filter((s) => s.gloss_key === 'beside land river'),
    ).toHaveLength(1);
  });

  it('drops a hallucinated sentence and keeps the rest', async () => {
    const store = new MemoryAiStore();
    const { provider } = scripted(HALLUCINATED_SENTENCE);
    const res = await runExtract(await body(), deps(store, provider));
    expect(res.candidates.map((c) => c.term)).toEqual(['give up']);
    expect(res.counts.dropped).toEqual({ sentence_not_in_text: 1 });
    expect([...store.terms.values()].map((t) => t.lemma)).not.toContain('quit');
  });

  it('drops candidates with missing fields', async () => {
    const store = new MemoryAiStore();
    const { provider } = scripted(MISSING_FIELD);
    const res = await runExtract(await body(), deps(store, provider));
    expect(res.candidates.map((c) => c.term)).toEqual(['bank']);
    expect(res.counts.dropped).toEqual({ incomplete_new_sense: 1, invalid_shape: 1 });
  });

  it('enforces the daily limit before calling the model', async () => {
    const store = new MemoryAiStore();
    const { provider } = scripted(GOOD_EXTRACT);
    const err = await runExtract(await body(), deps(store, provider, { dailyLimit: 0 })).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('daily_limit');
    expect((err as ApiError).status).toBe(429);
    expect(provider.generateJson).not.toHaveBeenCalled();
  });

  it('maps provider quota errors (recorded 429) to quota_exceeded and caches nothing', async () => {
    const store = new MemoryAiStore();
    const f = fakeFetch([{ status: 429, body: QUOTA_ERROR_BODY }]);
    const provider = createGeminiProvider({
      apiKey: 'k',
      model: 'm',
      fallbackModel: null,
      fetch: f.fetch,
      sleep: async () => {},
    });
    const err = await runExtract(await body(), deps(store, provider)).catch((e: unknown) => e);
    expect((err as ApiError).code).toBe('quota_exceeded');
    expect(store.cache.size).toBe(0);
  });

  it('end to end with the recorded Gemini envelope', async () => {
    const store = new MemoryAiStore();
    const f = fakeFetch([{ status: 200, body: envelope(GOOD_EXTRACT) }]);
    const provider = createGeminiProvider({ apiKey: 'k', model: 'm', fetch: f.fetch });
    const res = await runExtract(await body(), deps(store, provider));
    expect(res.candidates).toHaveLength(3);
    expect(res.model).toBe('m');
  });

  it('maps a generic AiError to ai_failed', async () => {
    const { provider } = scripted(new AiError('ai_failed', 'boom'));
    await expect(
      runExtract(await body(), deps(new MemoryAiStore(), provider)),
    ).rejects.toMatchObject({ code: 'ai_failed', status: 502 });
  });

  it('rejects a chunk_hash that does not match the text', async () => {
    const { provider } = scripted(GOOD_EXTRACT);
    const b = await body();
    await expect(
      runExtract({ ...b, chunk_hash: 'a'.repeat(64) }, deps(new MemoryAiStore(), provider)),
    ).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(
      runExtract({ text: '' }, deps(new MemoryAiStore(), provider)),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('never writes user sentences into the lexicon', async () => {
    const store = new MemoryAiStore();
    const { provider } = scripted(GOOD_EXTRACT);
    await runExtract(await body(), deps(store, provider));
    const lexiconText = JSON.stringify([...store.terms.values(), ...store.senses.values()]);
    for (const c of GOOD_EXTRACT.candidates) expect(lexiconText).not.toContain(c.source_sentence);
    expect(lexiconText).not.toContain('Maria');
  });
});

describe('validateExtractOutput', () => {
  const known = new Map([['s1', { senseId: 'sense-river', lemmaNorm: 'bank' }]]);
  const base = GOOD_EXTRACT.candidates[1]!;

  it('caps at 30 candidates and removes duplicates', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      ...base,
      gloss_en: `meaning number ${i} unique${i}`,
    }));
    const r = validateExtractOutput({ candidates: [base, base, ...many] }, CHUNK, known);
    expect(r.candidates).toHaveLength(30);
    expect(r.dropped.duplicate).toBe(1);
    expect(r.dropped.over_limit).toBe(11);
  });

  it('drops proper nouns and bad span', () => {
    const r = validateExtractOutput(
      {
        candidates: [
          {
            ...base,
            term: 'Maria',
            surface: 'Maria',
            source_sentence: 'After years of trying, Maria finally gave up smoking.',
          },
          { ...base, surface: 'riverbank' },
        ],
      },
      CHUNK,
      known,
    );
    expect(r.candidates).toHaveLength(0);
    expect(r.dropped).toEqual({ proper_noun: 1, surface_not_in_sentence: 1 });
  });

  it('accepts a known ref only for the same term', () => {
    const ok = validateExtractOutput(
      { candidates: [{ ...base, known_sense: 's1', pos: null, gloss_en: null, meaning_tr: null }] },
      CHUNK,
      known,
    );
    expect(ok.candidates[0]!.known).toEqual({ senseId: 'sense-river', lemmaNorm: 'bank' });
    const wrongTerm = validateExtractOutput(
      {
        candidates: [
          {
            ...GOOD_EXTRACT.candidates[0]!,
            known_sense: 's1',
            pos: null,
            gloss_en: null,
            meaning_tr: null,
          },
        ],
      },
      CHUNK,
      known,
    );
    expect(wrongTerm.dropped).toEqual({ unknown_sense_ref: 1 });
  });

  it('widens a verb-only surface of a separable phrasal verb', () => {
    const r = validateExtractOutput(
      { candidates: [{ ...GOOD_EXTRACT.candidates[2]!, surface: 'turned' }] },
      CHUNK,
      known,
    );
    expect(r.candidates[0]!.surface).toBe('turned her application down');
  });

  it('accepts an inflection mismatch in the surface', () => {
    const r = validateExtractOutput(
      { candidates: [{ ...GOOD_EXTRACT.candidates[0]!, surface: 'give up' }] },
      CHUNK,
      known,
    );
    expect(r.candidates[0]!.surface).toBe('gave up');
  });

  it('cleans model fields', () => {
    const r = validateExtractOutput(
      {
        candidates: [
          {
            ...base,
            gloss_en: ' The land beside a river. ',
            meaning_tr: '"kıyı, sahil, kenar"',
            ipa: 'bæŋk',
            confidence: 7,
          },
        ],
      },
      CHUNK,
      known,
    );
    expect(r.candidates[0]!.newSense).toMatchObject({
      gloss_en: 'The land beside a river',
      meaning_tr: 'kıyı, sahil',
      ipa: '/bæŋk/',
    });
    expect(r.candidates[0]!.confidence).toBe(1);
  });

  it('rejects output that is not the schema', () => {
    expect(validateExtractOutput({ words: [] }, CHUNK, known)).toEqual({
      candidates: [],
      dropped: { invalid_shape: 1 },
    });
  });
});
