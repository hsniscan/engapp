// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { corsHeaders, createHandler, parseOrigins } from './http.ts';
import { ApiError } from './errors.ts';
import { createAiFunction } from './setup.ts';
import { MemoryAiStore } from './testing/memory-store.ts';
import { runEnrich } from './enrich.ts';

const ORIGIN = 'https://engapp.example';

function handler(run = async () => ({ ok: true })) {
  return createHandler({
    cors: { allowedOrigins: [ORIGIN] },
    authenticate: async (req) => {
      if (req.headers.get('authorization') !== 'Bearer good')
        throw new ApiError('unauthorized', 'Sign in required');
      return 'user-1';
    },
    run,
  });
}

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request('http://x/functions/v1/ai-extract', {
    method: 'POST',
    body,
    headers: {
      origin: ORIGIN,
      authorization: 'Bearer good',
      'content-type': 'application/json',
      ...headers,
    },
  });

describe('http handler', () => {
  it('answers CORS preflight without auth', async () => {
    const res = await handler()(
      new Request('http://x', { method: 'OPTIONS', headers: { origin: ORIGIN } }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(res.headers.get('access-control-allow-headers')).toContain('authorization');
  });

  it('does not allow other origins', () => {
    const h = corsHeaders(
      new Request('http://x', { headers: { origin: 'https://evil.example' } }),
      { allowedOrigins: [ORIGIN] },
    );
    expect(h['Access-Control-Allow-Origin']).toBeUndefined();
    expect(parseOrigins(' https://a.example/ , http://b ')).toEqual([
      'https://a.example',
      'http://b',
    ]);
  });

  it('uses the {error: {code, message}} shape', async () => {
    const unauth = await handler()(post('{}', { authorization: '' }));
    expect(unauth.status).toBe(401);
    expect(await unauth.json()).toEqual({
      error: { code: 'unauthorized', message: 'Sign in required' },
    });
    expect(unauth.headers.get('access-control-allow-origin')).toBe(ORIGIN);

    const bad = await handler()(post('not json'));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe('invalid_input');

    const get = await handler()(new Request('http://x', { method: 'GET' }));
    expect(get.status).toBe(405);

    const limited = await handler(async () => {
      throw new ApiError('quota_exceeded', 'busy', 30);
    })(post('{}'));
    expect(limited.status).toBe(503);
    expect(limited.headers.get('retry-after')).toBe('30');
    expect(await limited.json()).toEqual({
      error: { code: 'quota_exceeded', message: 'busy', retry_after_s: 30 },
    });

    const crash = await handler(async () => {
      throw new Error('secret detail');
    })(post('{}'));
    expect(crash.status).toBe(500);
    expect(await crash.json()).toEqual({ error: { code: 'internal', message: 'Internal error' } });
  });

  it('wires a function with the user id from authentication only', async () => {
    const store = new MemoryAiStore();
    store.seed('bank', 'noun', 'the land beside a river', 'beside land river', 'kıyı');
    const fn = createAiFunction('ai-enrich', () => undefined, runEnrich, {
      store,
      authenticate: async () => 'user-from-jwt',
      provider: () => {
        throw new Error('no AI expected');
      },
    });
    const res = await fn(
      post(JSON.stringify({ term: 'bank', user_id: 'spoofed' }), {
        origin: 'http://localhost:5173',
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).senses).toHaveLength(1);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });
});
