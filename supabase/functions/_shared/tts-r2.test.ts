// @vitest-environment node
// The tts function's R2 tier (decision 0053): order of lookups and uploads, and that any R2
// failure falls back to Supabase Storage. R2 is a mocked fetch; no network.
import { describe, expect, it } from 'vitest';
import { R2Client } from './r2.ts';
import { runTts, type TtsStore, type TtsTextSource } from './tts.ts';
import { ttsObjectPath, ttsOnDemandObjectPath } from './tts-contract.ts';
import { AUDIO_CACHE_CONTROL, withR2Audio } from './tts-r2.ts';
import { pcmToWav } from './wav.ts';

const R2_BASE = 'https://pub-test.r2.dev';
const SUPA = 'https://x.supabase.co/storage/v1/object/public/tts/';

class SupabaseFake implements TtsStore {
  objects = new Set<string>();
  saved: string[] = [];
  sources = new Map<string, TtsTextSource>();
  async textSource(_u: string, t: string) {
    return this.sources.get(t) ?? null;
  }
  async consume(_u: string, limit: number) {
    return { allowed: true, used: 1, limit };
  }
  async find(path: string) {
    return this.objects.has(path) ? SUPA + path : null;
  }
  async save(path: string) {
    this.saved.push(path);
    this.objects.add(path);
    return SUPA + path;
  }
}

/** An R2 bucket behind a mocked fetch: HEAD/PUT on the S3 endpoint. */
function r2Fake(mode: { down?: boolean; putFails?: boolean } = {}) {
  const objects = new Map<string, { type: string; cache: string }>();
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = decodeURIComponent(url.pathname.replace(/^\/engapp-audio\//, ''));
    calls.push(`${init?.method} ${key}`);
    if (mode.down) throw new TypeError('fetch failed');
    const h = init?.headers as Record<string, string>;
    if (!h.authorization?.startsWith('AWS4-HMAC-SHA256 '))
      return new Response(null, { status: 403 });
    if (init?.method === 'HEAD')
      return new Response(null, { status: objects.has(key) ? 200 : 404 });
    if (init?.method === 'PUT') {
      if (mode.putFails)
        return new Response('<Error><Code>InternalError</Code></Error>', { status: 500 });
      objects.set(key, { type: h['content-type']!, cache: h['cache-control']! });
      return new Response(null, { status: 200 });
    }
    return new Response(null, { status: 400 });
  }) as typeof fetch;
  const client = new R2Client(
    { accountId: 'acc', accessKeyId: 'id', secretAccessKey: 's', bucket: 'engapp-audio' },
    { fetch: f },
  );
  return { client, objects, calls };
}

function setup(mode?: Parameters<typeof r2Fake>[0]) {
  const supa = new SupabaseFake();
  const r2 = r2Fake(mode);
  const logs: string[] = [];
  const store = withR2Audio(supa, r2.client, `${R2_BASE}/`, (m) => logs.push(m));
  const wav = pcmToWav(new Uint8Array(10));
  const deps = {
    userId: 'u1',
    store,
    synth: () => ({ synthesize: async () => ({ wav, model: 'm' }) }),
    dailyLimit: 5,
  };
  return { supa, r2, store, deps, logs };
}

describe('withR2Audio', () => {
  it('serves a file from R2 first', async () => {
    const { supa, r2, deps } = setup();
    supa.sources.set('word', 'public');
    const mp3 = await ttsObjectPath('en-US', 'word');
    r2.objects.set(mp3, { type: 'audio/mpeg', cache: '' });
    supa.objects.add(mp3);
    await expect(runTts({ text: 'word', voice: 'en-US' }, deps)).resolves.toEqual({
      url: `${R2_BASE}/${mp3}`,
      cached: true,
    });
  });

  it('falls back to Supabase Storage for a file not copied yet', async () => {
    const { supa, r2, deps } = setup();
    supa.sources.set('word', 'public');
    const mp3 = await ttsObjectPath('en-US', 'word');
    supa.objects.add(mp3);
    await expect(runTts({ text: 'word', voice: 'en-US' }, deps)).resolves.toEqual({
      url: SUPA + mp3,
      cached: true,
    });
    expect(r2.calls[0]).toBe(`HEAD ${mp3}`);
  });

  it('stores a cache miss on R2 only, with its type and cache header', async () => {
    const { supa, r2, deps } = setup();
    supa.sources.set('word', 'public');
    const wavPath = await ttsOnDemandObjectPath('en-US', 'word');
    await expect(runTts({ text: 'word', voice: 'en-US' }, deps)).resolves.toEqual({
      url: `${R2_BASE}/${wavPath}`,
      cached: false,
    });
    expect(r2.objects.get(wavPath)).toEqual({ type: 'audio/wav', cache: AUDIO_CACHE_CONTROL });
    expect(supa.saved).toEqual([]);
    // The next request finds it on R2.
    await expect(runTts({ text: 'word', voice: 'en-US' }, deps)).resolves.toEqual({
      url: `${R2_BASE}/${wavPath}`,
      cached: true,
    });
  });

  it('uses Supabase Storage when the R2 upload fails', async () => {
    const { supa, deps, logs } = setup({ putFails: true });
    supa.sources.set('word', 'public');
    const wavPath = await ttsOnDemandObjectPath('en-US', 'word');
    await expect(runTts({ text: 'word', voice: 'en-US' }, deps)).resolves.toEqual({
      url: SUPA + wavPath,
      cached: false,
    });
    expect(supa.saved).toEqual([wavPath]);
    expect(logs).toContain('tts r2 upload failed');
  });

  it('keeps working on Supabase when R2 cannot be reached', async () => {
    const { supa, deps, logs } = setup({ down: true });
    supa.sources.set('word', 'public');
    const mp3 = await ttsObjectPath('en-US', 'word');
    supa.objects.add(mp3);
    await expect(runTts({ text: 'word', voice: 'en-US' }, deps)).resolves.toEqual({
      url: SUPA + mp3,
      cached: true,
    });
    expect(logs).toContain('tts r2 head failed');
  });

  it('never stores private text anywhere', async () => {
    const { supa, r2, deps } = setup();
    supa.sources.set('my own sentence', 'private');
    await expect(runTts({ text: 'my own sentence', voice: 'en-US' }, deps)).resolves.toHaveProperty(
      'audio_b64',
    );
    expect(r2.calls.filter((c) => c.startsWith('PUT'))).toEqual([]);
    expect(supa.saved).toEqual([]);
  });
});
