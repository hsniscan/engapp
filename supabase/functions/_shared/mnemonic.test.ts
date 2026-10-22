// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { AiError, type AiProvider, type GenerateJsonRequest } from './ai-provider.ts';
import { ApiError } from './errors.ts';
import {
  MAX_MNEMONICS_PER_SENSE,
  MNEMONIC_PROMPT_VERSION,
  mnemonicResponse,
} from './mnemonic-contracts.ts';
import { isTurkishText, mentionsTerm, runMnemonic, toSuggestion, validateMnemonicOutput } from './mnemonic.ts';
import { MemoryAiStore } from './testing/memory-store.ts';
import { MemoryPairNoteStore } from './testing/memory-pair-note-store.ts';
import {
  MNEMONIC_INVALID,
  MNEMONIC_NONE,
  MNEMONIC_RELUCTANT,
  MNEMONIC_RELUCTANT_MORE,
} from './testing/v03-fixtures.ts';

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
  const reluctant = store.seed('reluctant', 'adjective', 'not willing to do something', 'not something willing', 'isteksiz', '/rɪˈlʌktənt/');
  const deps = (provider: AiProvider, userId = 'u1') => ({
    userId,
    store,
    pairNotes,
    provider: () => provider,
    dailyLimit: limit,
  });
  return { store, pairNotes, deps, sense: reluctant.sense_id! };
}

describe('runMnemonic', () => {
  it('asks the model once, stores the suggestions and serves the next request from the table (0 calls)', async () => {
    const { deps, pairNotes, store, sense } = setup();
    const { provider, requests } = scripted(MNEMONIC_RELUCTANT);
    const res = await runMnemonic({ sense_id: sense }, deps(provider));
    expect(mnemonicResponse.parse(res)).toBeTruthy();
    expect(res).toMatchObject({
      prompt_version: MNEMONIC_PROMPT_VERSION,
      ai_called: true,
      model: 'fake-model',
      none: false,
      exhausted: false,
      usage: { used: 1, limit: 5 },
      counts: { generated: 2, dropped: {} },
    });
    expect(res.suggestions.map((s) => s.type)).toEqual(['sound', 'image']);
    expect(res.new_ids).toEqual(res.suggestions.map((s) => s.id));
    expect(res.suggestions[0]!.why).toBe('reluctant ile rölanti aynı seslerle başlar.');
    expect(pairNotes.rows.every((r) => r.kind === 'mnemonic_suggestion' && r.lang_pair === 'en-tr')).toBe(true);
    expect(pairNotes.rows.every((r) => r.model === 'fake-model' && r.prompt_version === 'mnemonic-v1')).toBe(true);
    expect(pairNotes.rows.every((r) => r.term_norm === 'reluctant' && r.sense_id === sense)).toBe(true);

    // The model saw dictionary data only.
    expect(requests).toHaveLength(1);
    expect(requests[0]!.user).toBe(
      'TERM: reluctant\nPART_OF_SPEECH: adjective\nGLOSS: not willing to do something\nMEANING_TR: isteksiz\nIPA: /rɪˈlʌktənt/\n\nAVOID:\n(none)',
    );

    // Same sense again, by the same or another user: no model call, no budget.
    const again = await runMnemonic({ sense_id: sense }, deps(provider, 'u2'));
    expect(again).toMatchObject({ ai_called: false, model: null, usage: null, new_ids: [] });
    expect(again.suggestions).toEqual(res.suggestions);
    expect(provider.generateJson).toHaveBeenCalledTimes(1);
    expect(store.usage.get('u2') ?? 0).toBe(0);
  });

  it('"Başka öner" passes the stored suggestions as AVOID and appends only new ones', async () => {
    const { deps, sense } = setup();
    const { provider, requests } = scripted(MNEMONIC_RELUCTANT, MNEMONIC_RELUCTANT_MORE);
    const first = await runMnemonic({ sense_id: sense }, deps(provider));
    const more = await runMnemonic({ sense_id: sense, more: true }, deps(provider));
    expect(requests[1]!.user).toContain(
      'AVOID:\n- Rölantide kalan motor gibi isteksiz: reluctant biri harekete geçmek istemez.\n- Yataktan çıkmak',
    );
    expect(more.ai_called).toBe(true);
    expect(more.new_ids).toHaveLength(1);
    expect(more.counts.dropped).toEqual({ duplicate: 1 });
    expect(more.suggestions.map((s) => s.id).slice(0, 2)).toEqual(first.suggestions.map((s) => s.id));
    expect(more.suggestions[2]).toMatchObject({ type: 'story' });
  });

  it('an empty answer is honest and remembered: the next request costs nothing', async () => {
    const { deps, pairNotes, sense } = setup();
    const { provider } = scripted(MNEMONIC_NONE, MNEMONIC_RELUCTANT);
    const res = await runMnemonic({ sense_id: sense }, deps(provider));
    expect(res).toMatchObject({ ai_called: true, none: true, suggestions: [], new_ids: [] });
    expect(pairNotes.rows).toHaveLength(1); // the marker
    const again = await runMnemonic({ sense_id: sense }, deps(provider));
    expect(again).toMatchObject({ ai_called: false, none: true, suggestions: [] });
    expect(provider.generateJson).toHaveBeenCalledTimes(1);
    // "Başka öner" may still find something; the marker is never shown.
    const more = await runMnemonic({ sense_id: sense, more: true }, deps(provider));
    expect(more).toMatchObject({ ai_called: true, none: false });
    expect(more.suggestions).toHaveLength(2);
  });

  it('stops asking the model when the sense has the maximum number of suggestions', async () => {
    const { deps, pairNotes, sense } = setup();
    await pairNotes.insertNotes(
      Array.from({ length: MAX_MNEMONICS_PER_SENSE }, (_, i) => ({
        term_norm: 'reluctant',
        sense_id: sense,
        lang_pair: 'en-tr' as const,
        kind: 'mnemonic_suggestion' as const,
        content_key: `k${i}`,
        content: { type: 'story', text_tr: `Hikâye ${i}: reluctant, yani isteksiz bir çocuk.`, why: null },
        model: 'm',
        prompt_version: 'mnemonic-v1',
      })),
    );
    const { provider } = scripted(MNEMONIC_RELUCTANT);
    const res = await runMnemonic({ sense_id: sense, more: true }, deps(provider));
    expect(res).toMatchObject({ ai_called: false, exhausted: true });
    expect(res.suggestions).toHaveLength(MAX_MNEMONICS_PER_SENSE);
    expect(provider.generateJson).not.toHaveBeenCalled();
  });

  it('daily limit: refused before the model; a cached sense is still served', async () => {
    const { deps, sense } = setup(1);
    const { provider } = scripted(MNEMONIC_RELUCTANT);
    await runMnemonic({ sense_id: sense }, deps(provider));
    await expect(runMnemonic({ sense_id: sense, more: true }, deps(provider))).rejects.toMatchObject({
      code: 'daily_limit',
    });
    expect(provider.generateJson).toHaveBeenCalledTimes(1);
    await expect(runMnemonic({ sense_id: sense }, deps(provider))).resolves.toMatchObject({ ai_called: false });
  });

  it('refuses bad input and unknown senses without spending budget', async () => {
    const { deps, store } = setup();
    const { provider } = scripted(MNEMONIC_RELUCTANT);
    await expect(runMnemonic({ sense_id: 'no such id!' }, deps(provider))).rejects.toBeInstanceOf(ApiError);
    await expect(runMnemonic({ sense_id: 'missing' }, deps(provider))).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(runMnemonic({ sense_id: 'x', text: 'my own words' }, deps(provider))).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(provider.generateJson).not.toHaveBeenCalled();
    expect(store.usage.size).toBe(0);
  });

  it('maps provider errors to the API error codes', async () => {
    const { deps, sense } = setup();
    const { provider } = scripted(new AiError('quota_exceeded', 'busy', 30));
    await expect(runMnemonic({ sense_id: sense }, deps(provider))).rejects.toMatchObject({
      code: 'quota_exceeded',
      retryAfterS: 30,
    });
  });
});

describe('validateMnemonicOutput', () => {
  it('drops every invalid item with its reason and keeps the rest', () => {
    const reasons: string[] = [];
    const valid = validateMnemonicOutput(MNEMONIC_INVALID.mnemonics, { lemma: 'reluctant', existing: [] }, (r) =>
      reasons.push(r),
    );
    expect(valid).toEqual([]);
    expect(reasons).toEqual(['bad_type', 'not_turkish', 'term_missing', 'too_short', 'too_long', 'bad_text', 'invalid_shape']);
  });

  it('keeps at most two per call and no near-duplicates', () => {
    const items = [...MNEMONIC_RELUCTANT.mnemonics, ...MNEMONIC_RELUCTANT_MORE.mnemonics];
    const reasons: string[] = [];
    const valid = validateMnemonicOutput(items, { lemma: 'reluctant', existing: [] }, (r) => reasons.push(r));
    expect(valid).toHaveLength(2);
    expect(reasons).toEqual(['extra', 'duplicate']);
  });

  it('finds the term with inflections and Turkish suffixes, and tells Turkish from English', () => {
    expect(mentionsTerm("Reluctant'ın anlamı isteksizdir.", 'reluctant')).toBe(true);
    expect(mentionsTerm('Sigarayı gave up ettim, yani bıraktım.', 'give up')).toBe(true);
    expect(mentionsTerm('Sigarayı bıraktım.', 'give up')).toBe(false);
    expect(mentionsTerm('Ona take advantage of etti.', 'take advantage of sth')).toBe(true);
    expect(isTurkishText('Rölantide kalan motor gibi isteksiz: reluctant biri.', 'reluctant')).toBe(true);
    expect(isTurkishText('The reluctant man is waiting for the bus.', 'reluctant')).toBe(false);
    expect(isTurkishText('reluctant isteksiz', 'reluctant')).toBe(false);
  });

  it('never turns the "none" marker or a malformed row into a suggestion', () => {
    const row = {
      id: 'x',
      term_norm: 'reluctant',
      sense_id: 's',
      lang_pair: 'en-tr' as const,
      kind: 'mnemonic_suggestion' as const,
      content_key: '-none-',
      content: { type: 'none' },
      curated: false,
      status: 'active' as const,
      updated_at: 1,
    };
    expect(toSuggestion(row)).toBeNull();
    expect(toSuggestion({ ...row, content: { type: 'story' } })).toBeNull();
    expect(toSuggestion({ ...row, content: { type: 'story', text_tr: 'a reluctant b', why: '' } })).toMatchObject({
      type: 'story',
      why: null,
    });
    expect(toSuggestion({ ...row, status: 'retired', content: { type: 'story', text_tr: 'x' } })).toBeNull();
  });
});
