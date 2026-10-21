import { describe, expect, it } from 'vitest';
import { AiClientError, enrichTerm, extractChunk, toCandidateFields } from './client';
import { sha256Hex } from '../../supabase/functions/_shared/extract';
import { hashChunk } from '@/domain/chunking';

const config = { url: 'https://ref.supabase.co', key: 'sb_publishable_test' };
const token = async () => 'jwt';

const entry = {
  id: 's1',
  term_id: 't1',
  lemma: 'give up',
  lemma_norm: 'give up',
  term_type: 'phrase' as const,
  pos: 'phrasal verb',
  gloss_en: 'stop doing a habit',
  meaning_tr: 'bırakmak',
  ipa: null,
  updated_at: 1,
};
const okExtract = {
  prompt_version: 'extract-v1',
  cache_hit: false,
  ai_called: true,
  model: 'm',
  candidates: [
    {
      term: 'give up',
      surface: 'gave up',
      term_type: 'phrase',
      source_sentence: 'She gave up.',
      span: [4, 11],
      confidence: 0.9,
      match: 'new_term',
      lexicon_hit: false,
      lexicon: entry,
    },
  ],
  counts: {
    candidates: 1,
    known_sense: 0,
    new_sense: 0,
    new_term: 1,
    lexicon_hits: 0,
    dropped: {},
  },
  usage: { used: 1, limit: 200 },
};

function fetchReturning(
  status: number,
  body: unknown,
  seen: { url?: string; init?: RequestInit } = {},
) {
  return (async (url: string, init: RequestInit) => {
    seen.url = url;
    seen.init = init;
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('ai client', () => {
  it('hashes exactly like the server and the local chunk cache', async () => {
    const text = 'Café – “quoted”';
    expect(await hashChunk(text)).toBe(await sha256Hex(text.normalize('NFC')));
  });

  it('posts the chunk with its hash and validates the response', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const res = await extractChunk(
      { text: 'She gave up.', level: 'B2' },
      { config, getAccessToken: token, fetch: fetchReturning(200, okExtract, seen) },
    );
    expect(seen.url).toBe('https://ref.supabase.co/functions/v1/ai-extract');
    const sent = JSON.parse(String(seen.init!.body));
    expect(sent).toEqual({
      text: 'She gave up.',
      chunk_hash: await hashChunk('She gave up.'),
      level: 'B2',
    });
    expect((seen.init!.headers as Record<string, string>).authorization).toBe('Bearer jwt');
    expect(res.chunk_hash).toBe(sent.chunk_hash);
    expect(toCandidateFields(res.candidates[0]!)).toMatchObject({
      lexicon_sense_id: 's1',
      match: 'new_term',
      span: [4, 11],
    });
  });

  it('maps server errors to typed codes', async () => {
    const err = await enrichTerm(
      { term: 'bank' },
      {
        config,
        getAccessToken: token,
        fetch: fetchReturning(429, {
          error: { code: 'daily_limit', message: 'Daily AI limit reached (200/200).' },
        }),
      },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiClientError);
    expect((err as AiClientError).code).toBe('daily_limit');
    expect((err as AiClientError).transient).toBe(false);
  });

  it('rejects a response that breaks the contract', async () => {
    await expect(
      extractChunk(
        { text: 'x' },
        { config, getAccessToken: token, fetch: fetchReturning(200, { candidates: 'nope' }) },
      ),
    ).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('works offline-first: guests and missing config fail fast without network', async () => {
    const never = (async () => {
      throw new Error('must not fetch');
    }) as unknown as typeof fetch;
    await expect(
      enrichTerm({ term: 'bank' }, { config, getAccessToken: async () => null, fetch: never }),
    ).rejects.toMatchObject({ code: 'not_signed_in' });
    await expect(
      enrichTerm({ term: 'bank' }, { config: null, fetch: never }),
    ).rejects.toMatchObject({ code: 'not_configured' });
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const e = await enrichTerm(
      { term: 'bank' },
      { config, getAccessToken: token, fetch: offline },
    ).catch((x: unknown) => x);
    expect((e as AiClientError).code).toBe('offline');
    expect((e as AiClientError).transient).toBe(true);
  });
});
