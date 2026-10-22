// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { AiError, type AiProvider, type GenerateJsonRequest } from './ai-provider.ts';
import { CONTRAST_PROMPT_VERSION, contrastKey, contrastRequest, contrastResponse } from './contrast-contracts.ts';
import { runContrast, toContrastNote, validateContrastOutput } from './contrast.ts';
import { CONTRAST_AFFECT_EFFECT, CONTRAST_INVALID } from './testing/contrast-fixtures.ts';
import { MemoryAiStore } from './testing/memory-store.ts';
import { MemoryPairNoteStore } from './testing/memory-pair-note-store.ts';

function scripted(...outputs: unknown[]) {
  const requests: GenerateJsonRequest[] = [];
  let i = 0;
  const provider: AiProvider = {
    name: 'fake',
    generateJson: vi.fn(async (req: GenerateJsonRequest) => {
      requests.push(req);
      const data = outputs[Math.min(i++, outputs.length - 1)];
      if (data instanceof Error) throw data;
      return { data, model: 'fake-model', attempts: 1, usage: null };
    }),
  };
  return { provider, requests };
}

function setup(limit = 5) {
  const store = new MemoryAiStore();
  const pairNotes = new MemoryPairNoteStore();
  const affect = store.seed('affect', 'verb', 'to change or influence something', 'change influence something', 'etkilemek');
  const effect = store.seed('effect', 'noun', 'a change caused by something', 'cause change something', 'etki');
  const deps = (provider: AiProvider, userId = 'u1') => ({ userId, store, pairNotes, provider: () => provider, dailyLimit: limit });
  return { store, pairNotes, deps, affect: affect.sense_id!, effect: effect.sense_id! };
}

describe('runContrast', () => {
  it('asks the model once per pair, stores the note shared, and answers later requests from the table', async () => {
    const { deps, pairNotes, store, affect, effect } = setup();
    const { provider, requests } = scripted(CONTRAST_AFFECT_EFFECT);
    const res = await runContrast({ sense_ids: [effect, affect] }, deps(provider));
    expect(contrastResponse.parse(res)).toBeTruthy();
    const key = contrastKey(affect, effect);
    expect(res).toMatchObject({
      prompt_version: CONTRAST_PROMPT_VERSION,
      ai_called: true,
      model: 'fake-model',
      key,
      usage: { used: 1, limit: 5 },
    });
    const [first] = key.split('|');
    const aIsAffect = first === affect;
    const affectSide = aIsAffect ? res.note.a : res.note.b;
    expect(affectSide).toMatchObject({ lemma: 'affect', sentence_en: 'Lack of sleep can affect your mood.' });
    expect(affectSide.sentence_en.slice(...affectSide.span)).toBe('affect');
    expect(res.note.difference_tr).toBe(CONTRAST_AFFECT_EFFECT.difference_tr);

    // Stored once, shared, keyed by the sorted sense ids, with model and prompt version.
    expect(pairNotes.rows).toHaveLength(1);
    expect(pairNotes.rows[0]).toMatchObject({
      kind: 'contrast',
      lang_pair: 'en-tr',
      sense_id: first,
      content_key: key,
      model: 'fake-model',
      prompt_version: 'contrast-v1',
    });

    // The model saw dictionary data only: lemma, part of speech and meanings.
    expect(requests).toHaveLength(1);
    expect(requests[0]!.user).toContain('A_MEANING_TR: ');
    expect(requests[0]!.user).toMatch(/^A: (affect|effect)$/m);
    expect(requests[0]!.user.split('\n').filter(Boolean)).toHaveLength(8);

    // Same pair again, any order, any user: no model call, no budget.
    const again = await runContrast({ sense_ids: [affect, effect] }, deps(provider, 'u2'));
    expect(again).toMatchObject({ ai_called: false, model: null, usage: null, key });
    expect(again.note).toEqual(res.note);
    expect(provider.generateJson).toHaveBeenCalledTimes(1);
    expect(store.usage.get('u2') ?? 0).toBe(0);
  });

  it('does not store an unusable answer and reports ai_failed (the next request may ask again)', async () => {
    const { deps, pairNotes, affect, effect } = setup();
    const { provider } = scripted(CONTRAST_INVALID[1]!.data, CONTRAST_AFFECT_EFFECT);
    await expect(runContrast({ sense_ids: [affect, effect] }, deps(provider))).rejects.toMatchObject({ code: 'ai_failed' });
    expect(pairNotes.rows).toHaveLength(0);
    await expect(runContrast({ sense_ids: [affect, effect] }, deps(provider))).resolves.toMatchObject({ ai_called: true });
  });

  it('daily limit: refused before the model; a stored pair is still served', async () => {
    const { deps, store, affect, effect } = setup(1);
    const third = store.seed('influence', 'verb', 'to have an effect on', 'effect have', 'etkilemek').sense_id!;
    const { provider } = scripted(CONTRAST_AFFECT_EFFECT);
    await runContrast({ sense_ids: [affect, effect] }, deps(provider));
    await expect(runContrast({ sense_ids: [affect, third] }, deps(provider))).rejects.toMatchObject({ code: 'daily_limit' });
    expect(provider.generateJson).toHaveBeenCalledTimes(1);
    await expect(runContrast({ sense_ids: [effect, affect] }, deps(provider))).resolves.toMatchObject({ ai_called: false });
  });

  it('refuses bad input, unknown senses and extra fields without spending budget', async () => {
    const { deps, store, affect } = setup();
    const { provider } = scripted(CONTRAST_AFFECT_EFFECT);
    for (const body of [
      { sense_ids: [affect, affect] },
      { sense_ids: [affect] },
      { sense_ids: [affect, 'no such id!'] },
      { sense_ids: [affect, 'missing'] },
    ]) {
      await expect(runContrast(body, deps(provider))).rejects.toMatchObject({ code: 'invalid_input' });
    }
    // User text has no field to travel in: unknown keys are stripped, never sent on.
    expect(contrastRequest.parse({ sense_ids: ['a', 'b'], text: 'my sentence' })).toEqual({ sense_ids: ['a', 'b'] });
    expect(provider.generateJson).not.toHaveBeenCalled();
    expect(store.usage.size).toBe(0);
  });

  it('maps provider errors to the API error codes', async () => {
    const { deps, affect, effect } = setup();
    const { provider } = scripted(new AiError('quota_exceeded', 'busy', 30));
    await expect(runContrast({ sense_ids: [affect, effect] }, deps(provider))).rejects.toMatchObject({
      code: 'quota_exceeded',
      retryAfterS: 30,
    });
  });
});

describe('validateContrastOutput', () => {
  it('accepts a good answer with the spans computed by the server', () => {
    const v = validateContrastOutput(CONTRAST_AFFECT_EFFECT, { a: 'affect', b: 'effect' });
    expect(typeof v).toBe('object');
    if (typeof v === 'string') return;
    expect(v.a.sentence_en.slice(...v.a.span)).toBe('affect');
    expect(v.b.sentence_en.slice(...v.b.span)).toBe('effect');
    expect(v.a.sentence_tr).toBe('Uykusuzluk ruh halini etkileyebilir.');
  });

  it.each(CONTRAST_INVALID)('refuses: $reason', ({ reason, data }) => {
    expect(validateContrastOutput(data, { a: 'affect', b: 'effect' })).toBe(reason);
  });

  it('drops only a bad translation, not the answer', () => {
    const v = validateContrastOutput({ ...CONTRAST_AFFECT_EFFECT, a_sentence_tr: '<i>x</i>' }, { a: 'affect', b: 'effect' });
    expect(typeof v === 'object' && v.a.sentence_tr).toBeNull();
  });

  it('never turns another kind or a malformed row into a contrast note', () => {
    const row = {
      id: 'x',
      term_norm: 'affect',
      sense_id: 'a',
      lang_pair: 'en-tr' as const,
      kind: 'contrast' as const,
      content_key: 'a|b',
      content: { a: { lemma: 'affect' }, difference_tr: 'x' },
      curated: false,
      status: 'active' as const,
      updated_at: 1,
    };
    expect(toContrastNote(row)).toBeNull();
    expect(toContrastNote({ ...row, kind: 'mnemonic_suggestion' })).toBeNull();
    expect(toContrastNote({ ...row, content_key: 'b|a' })).toBeNull();
  });
});
