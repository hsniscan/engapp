// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { lemmaAcceptable, runEnrich } from './enrich.ts';
import type { AiProvider, GenerateJsonRequest } from './ai-provider.ts';
import { enrichResponse } from './contracts.ts';
import { MemoryAiStore } from './testing/memory-store.ts';
import { ENRICH_BANK, ENRICH_INVALID } from './testing/gemini-fixtures.ts';

function scripted(output: unknown) {
  const requests: GenerateJsonRequest[] = [];
  const provider: AiProvider = {
    name: 'fake',
    generateJson: vi.fn(async (req: GenerateJsonRequest) => {
      requests.push(req);
      return { data: output, model: 'fake-model', attempts: 1, usage: null };
    }),
  };
  return { provider, requests };
}

const deps = (store: MemoryAiStore, provider: AiProvider) => ({
  userId: 'u',
  store,
  provider: () => provider,
  dailyLimit: 5,
});

describe('runEnrich', () => {
  it('answers from the lexicon without calling the model', async () => {
    const store = new MemoryAiStore();
    store.seed('bank', 'noun', 'the land beside a river', 'beside land river', 'kıyı');
    const { provider } = scripted(ENRICH_BANK);
    const res = await runEnrich({ term: 'Banks' }, deps(store, provider));
    expect(enrichResponse.parse(res)).toBeTruthy();
    expect(res).toMatchObject({ ai_called: false, model: null, new_sense_ids: [], usage: null });
    expect(res.senses.map((s) => s.meaning_tr)).toEqual(['kıyı']);
    expect(provider.generateJson).not.toHaveBeenCalled();
    expect(store.usage.size).toBe(0);
  });

  it('"Başka anlam ara" sends existing glosses and adds only new senses', async () => {
    const store = new MemoryAiStore();
    store.seed('bank', 'noun', 'the land beside a river', 'beside land river', 'kıyı');
    const { provider, requests } = scripted(ENRICH_BANK);
    const res = await runEnrich({ term: 'bank', more: true }, deps(store, provider));
    expect(requests[0]!.user).toContain('e1 | noun | the land beside a river');
    expect(res.ai_called).toBe(true);
    expect(res.senses.map((s) => s.meaning_tr)).toEqual(['kıyı', 'banka', 'bankaya yatırmak']);
    expect(res.new_sense_ids).toHaveLength(2); // "Land beside rivers." was a duplicate
    expect(store.senses.size).toBe(3);
  });

  it('calls the model for an unknown term and stores its senses', async () => {
    const store = new MemoryAiStore();
    const { provider } = scripted(ENRICH_BANK);
    const res = await runEnrich(
      { term: 'bank', sentence: 'I went to the bank.' },
      deps(store, provider),
    );
    expect(res.term?.lemma).toBe('bank');
    expect(res.senses).toHaveLength(3);
    expect(store.terms.size).toBe(1);
    // the sentence goes to the model but never into the lexicon
    expect(JSON.stringify([...store.senses.values()])).not.toContain('I went to the bank');
  });

  it('returns no term for something that is not English', async () => {
    const store = new MemoryAiStore();
    const { provider } = scripted(ENRICH_INVALID);
    const res = await runEnrich({ term: 'asdfqwer' }, deps(store, provider));
    expect(res).toMatchObject({ term: null, senses: [], ai_called: true });
    expect(store.terms.size).toBe(0);
  });

  it('keeps the typed term when the model proposes an unrelated lemma', async () => {
    const store = new MemoryAiStore();
    const { provider } = scripted({ ...ENRICH_BANK, lemma: 'finance' });
    const res = await runEnrich({ term: 'bank' }, deps(store, provider));
    expect(res.term?.lemma).toBe('bank');
  });

  it('respects the daily limit', async () => {
    const store = new MemoryAiStore();
    store.usage.set('u', 5);
    const { provider } = scripted(ENRICH_BANK);
    await expect(runEnrich({ term: 'bank' }, deps(store, provider))).rejects.toMatchObject({
      code: 'daily_limit',
    });
  });

  it('validates input', async () => {
    const { provider } = scripted(ENRICH_BANK);
    await expect(
      runEnrich({ term: '' }, deps(new MemoryAiStore(), provider)),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      runEnrich({ term: '1234' }, deps(new MemoryAiStore(), provider)),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('lemmaAcceptable', () => {
  it('accepts base forms and dictionary forms of phrases', () => {
    expect(lemmaAcceptable('gave up', 'give up')).toBe(true);
    expect(lemmaAcceptable('children', 'child')).toBe(true);
    expect(lemmaAcceptable('made up her mind', "make up one's mind")).toBe(true);
    expect(lemmaAcceptable('bank', 'finance')).toBe(false);
    expect(lemmaAcceptable('paris', 'Paris')).toBe(false);
  });
});
