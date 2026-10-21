import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiClientError, type EnrichResponse } from '@/ai/client';
import '@/i18n';
import { db } from '@/data';
import type { LexiconSense } from '@/domain/types';
import { setAuthStateForTesting } from '@/features/auth/session';
import { resetDb } from '@/test/db';
import { lookupLexicon, useLexiconLookup, type LookupDeps } from './lexicon';

const sense = (id: string, lemma: string, meaning: string, gloss = 'a gloss'): LexiconSense => ({
  id,
  term_id: `t-${lemma}`,
  lemma,
  lemma_norm: lemma,
  term_type: 'word',
  pos: 'noun',
  gloss_en: gloss,
  meaning_tr: meaning,
  ipa: null,
  updated_at: 1,
});

function enrichReply(
  senses: LexiconSense[],
  aiCalled: boolean,
  newIds: string[] = [],
): EnrichResponse {
  return {
    prompt_version: 'enrich-v1',
    ai_called: aiCalled,
    model: aiCalled ? 'fake' : null,
    term: senses[0]
      ? {
          id: senses[0].term_id,
          lemma: senses[0].lemma,
          lemma_norm: senses[0].lemma_norm,
          term_type: 'word',
        }
      : null,
    senses: senses.map((s) => ({
      ...s,
      cefr: s.cefr ?? null,
      cefr_source: s.cefr_source ?? null,
      cefr_list: s.cefr_list ?? null,
      cefr_reason_tr: s.cefr_reason_tr ?? null,
      zipf: s.zipf ?? null,
    })),
    new_sense_ids: newIds,
    suggested_sense_id: null,
    usage: null,
  };
}

let enrich: ReturnType<typeof vi.fn>;
let deps: LookupDeps;
beforeEach(async () => {
  await resetDb();
  enrich = vi.fn();
  deps = { enrich: enrich as unknown as LookupDeps['enrich'], isOnline: () => true };
});

describe('lookupLexicon', () => {
  it('answers from lexicon_cache without any network call', async () => {
    await db.lexicon_cache.bulkPut([sense('s1', 'bank', 'kıyı'), sense('s2', 'bank', 'banka')]);
    const res = await lookupLexicon('Bank', { more: false }, deps);
    expect(res).toMatchObject({ ok: true, aiCalled: false });
    expect(res.ok && res.senses.map((s) => [s.meaning_tr, s.origin])).toEqual([
      ['kıyı', 'lexicon'],
      ['banka', 'lexicon'],
    ]);
    expect(enrich).not.toHaveBeenCalled();
  });

  it('asks ai-enrich without `more` when the cache has nothing, and caches the answer', async () => {
    enrich.mockResolvedValue(enrichReply([sense('s9', 'cope', 'başa çıkmak')], false));
    const res = await lookupLexicon('cope', { more: false }, deps);
    expect(enrich).toHaveBeenCalledWith(expect.objectContaining({ term: 'cope', more: false }));
    expect(res.ok && res.senses[0]!.origin).toBe('lexicon'); // the shared lexicon had it: no AI
    expect(await db.lexicon_cache.get('s9')).toBeTruthy();
    // Second time: local cache, no call.
    await lookupLexicon('cope', { more: false }, deps);
    expect(enrich).toHaveBeenCalledTimes(1);
  });

  it('"Başka anlam ara" calls with more: true and marks new senses as AI', async () => {
    await db.lexicon_cache.put(sense('s1', 'bank', 'kıyı'));
    enrich.mockResolvedValue(
      enrichReply([sense('s1', 'bank', 'kıyı'), sense('s3', 'bank', 'banka')], true, ['s3']),
    );
    const res = await lookupLexicon('bank', { more: true }, deps);
    expect(enrich).toHaveBeenCalledWith(expect.objectContaining({ more: true }));
    expect(res.ok && res.senses.map((s) => s.origin)).toEqual(['lexicon', 'ai']);
  });

  it('offline without a cached term, and server errors, come back as codes', async () => {
    expect(
      await lookupLexicon('zeal', { more: false }, { ...deps, isOnline: () => false }),
    ).toEqual({ ok: false, error: 'offline' });
    enrich.mockRejectedValue(new AiClientError('daily_limit', 'x', 429));
    expect(await lookupLexicon('zeal', { more: false }, deps)).toEqual({
      ok: false,
      error: 'daily_limit',
    });
  });
});

describe('useLexiconLookup', () => {
  it('is unavailable for guests and works for signed-in users', async () => {
    setAuthStateForTesting({ status: 'guest', user: null });
    const guest = renderHook(() => useLexiconLookup('bank', deps));
    expect(guest.result.current.available).toBe(false);

    setAuthStateForTesting({
      status: 'signed_in',
      user: { id: 'u', email: null, name: null, avatarUrl: null },
    });
    await db.lexicon_cache.put(sense('s1', 'bank', 'kıyı'));
    enrich.mockResolvedValue(
      enrichReply([sense('s1', 'bank', 'kıyı'), sense('s3', 'bank', 'banka')], true, ['s3']),
    );
    const { result, rerender } = renderHook(({ term }) => useLexiconLookup(term, deps), {
      initialProps: { term: 'bank' },
    });
    expect(result.current.available).toBe(true);
    expect(result.current.canSearchMore).toBe(false);
    act(() => result.current.fill());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.senses).toHaveLength(1);
    expect(enrich).not.toHaveBeenCalled();
    expect(result.current.canSearchMore).toBe(true);
    act(() => result.current.searchMore());
    await waitFor(() => expect(result.current.senses).toHaveLength(2));
    expect(result.current.canSearchMore).toBe(false);
    // Typing another term starts over.
    rerender({ term: 'banks' });
    expect(result.current.senses).toHaveLength(0);
    expect(result.current.status).toBe('idle');
  });
});
