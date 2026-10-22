import { describe, expect, it, vi } from 'vitest';
import { requestPronunciation } from './tts';

const config = { url: 'https://p.supabase.co', key: 'pk' };
const token = async () => 'jwt';

describe('requestPronunciation', () => {
  it('posts normalised text with the session token', async () => {
    const fetch = vi.fn(
      async (_u: string | URL | Request, _i?: RequestInit) =>
        new Response(
          JSON.stringify({
            url: 'https://p.supabase.co/storage/v1/object/public/tts/en-US/x.wav',
            cached: true,
          }),
        ),
    );
    const res = await requestPronunciation('  give   up ', 'en-US', {
      config,
      getAccessToken: token,
      fetch: fetch as typeof globalThis.fetch,
    });
    expect(res).toEqual({ url: expect.stringContaining('/tts/en-US/'), cached: true });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://p.supabase.co/functions/v1/tts');
    expect(JSON.parse(String(init!.body))).toEqual({ text: 'give up', voice: 'en-US' });
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer jwt');
  });

  it('needs a signed-in user', async () => {
    await expect(
      requestPronunciation('word', 'en-US', { config, getAccessToken: async () => null }),
    ).rejects.toMatchObject({ code: 'not_signed_in' });
  });

  it('passes server error codes on', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 'daily_limit', message: 'limit' } }), {
          status: 429,
        }),
    );
    await expect(
      requestPronunciation('word', 'en-GB', { config, getAccessToken: token, fetch }),
    ).rejects.toMatchObject({ code: 'daily_limit', status: 429 });
  });

  it('reports a network failure as offline', async () => {
    const fetch = vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')));
    await expect(
      requestPronunciation('word', 'en-GB', { config, getAccessToken: token, fetch }),
    ).rejects.toMatchObject({ code: 'offline' });
  });
});
