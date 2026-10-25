// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { AiError } from './ai-provider.ts';
import { ApiError } from './errors.ts';
import { createGeminiTts, ttsPrompt, type SpeechSynth } from './gemini-tts.ts';
import { runTts, type TtsStore, type TtsTextSource } from './tts.ts';
import {
  normalizeTtsText,
  TTS_CACHE_VERSION,
  TTS_MAX_CHARS,
  TTS_SAMPLE_TEXT,
  ttsKeyMaterial,
  ttsObjectPath,
  ttsOnDemandObjectPath,
  ttsPublicUrl,
  ttsRequest,
  ttsSha256Hex,
  ttsTextCandidates,
} from './tts-contract.ts';
import { base64ToBytes, bytesToBase64, isWav, pcmRateFromMime, pcmToWav, toWav } from './wav.ts';

// ------------------------------------------------------------------ WAV

describe('pcmToWav', () => {
  it('writes a 44-byte RIFF header for 24 kHz 16-bit mono', () => {
    const pcm = new Uint8Array([1, 0, 2, 0, 3, 0]);
    const wav = pcmToWav(pcm);
    const v = new DataView(wav.buffer);
    const tag = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
    expect(wav.length).toBe(50);
    expect(tag(0)).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(42);
    expect(tag(8)).toBe('WAVE');
    expect(tag(12)).toBe('fmt ');
    expect(v.getUint32(16, true)).toBe(16);
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(24_000);
    expect(v.getUint32(28, true)).toBe(48_000); // byte rate
    expect(v.getUint16(32, true)).toBe(2); // block align
    expect(v.getUint16(34, true)).toBe(16);
    expect(tag(36)).toBe('data');
    expect(v.getUint32(40, true)).toBe(6);
    expect([...wav.subarray(44)]).toEqual([1, 0, 2, 0, 3, 0]);
  });

  it('drops a trailing half sample', () => {
    const wav = pcmToWav(new Uint8Array([1, 0, 2]));
    expect(new DataView(wav.buffer).getUint32(40, true)).toBe(2);
    expect(wav.length).toBe(46);
  });

  it('uses the given sample rate', () => {
    const wav = pcmToWav(new Uint8Array(4), { sampleRate: 16_000, channels: 1, bitsPerSample: 16 });
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(16_000);
  });
});

describe('toWav', () => {
  it('passes a WAV through unchanged', () => {
    const wav = pcmToWav(new Uint8Array(8));
    expect(isWav(wav)).toBe(true);
    expect(toWav(wav, 'audio/wav')).toBe(wav);
  });

  it('wraps raw L16 PCM using the rate from the mime type', () => {
    const out = toWav(new Uint8Array(8), 'audio/L16;codec=pcm;rate=22050');
    expect(isWav(out)).toBe(true);
    expect(new DataView(out.buffer).getUint32(24, true)).toBe(22_050);
  });

  it('defaults to 24 kHz', () => {
    expect(pcmRateFromMime('audio/L16')).toBeNull();
    const out = toWav(new Uint8Array(8), 'audio/L16');
    expect(new DataView(out.buffer).getUint32(24, true)).toBe(24_000);
  });

  it('round-trips base64', () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 251);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});

// ------------------------------------------------------------------ contract

describe('ttsRequest', () => {
  it('normalises whitespace and accepts both accents', () => {
    expect(ttsRequest.parse({ text: '  give\n up ', voice: 'en-GB' })).toEqual({
      text: 'give up',
      voice: 'en-GB',
    });
    expect(normalizeTtsText('café')).toBe('café');
  });

  it('rejects empty, too long, non-English and unknown voices', () => {
    expect(ttsRequest.safeParse({ text: '   ', voice: 'en-US' }).success).toBe(false);
    expect(
      ttsRequest.safeParse({ text: 'a'.repeat(TTS_MAX_CHARS + 1), voice: 'en-US' }).success,
    ).toBe(false);
    expect(ttsRequest.safeParse({ text: 'çğış 123', voice: 'en-US' }).success).toBe(false);
    expect(ttsRequest.safeParse({ text: 'word', voice: 'en-AU' }).success).toBe(false);
    expect(ttsRequest.safeParse({ text: 'a\u0000b', voice: 'en-US' }).success).toBe(false);
  });
});

// ------------------------------------------------------------------ pipeline

class MemoryTtsStore implements TtsStore {
  sources = new Map<string, TtsTextSource>();
  objects = new Map<string, Uint8Array>();
  used = new Map<string, number>();
  uploadOk = true;
  async textSource(_u: string, text: string) {
    return this.sources.get(text) ?? null;
  }
  async consume(userId: string, limit: number) {
    const used = this.used.get(userId) ?? 0;
    if (used + 1 > limit) return { allowed: false, used, limit };
    this.used.set(userId, used + 1);
    return { allowed: true, used: used + 1, limit };
  }
  async exists(path: string) {
    return this.objects.has(path);
  }
  async upload(path: string, wav: Uint8Array) {
    if (this.uploadOk) this.objects.set(path, wav);
    return this.uploadOk;
  }
  publicUrl(path: string) {
    return `https://x.supabase.co/storage/v1/object/public/tts/${path}`;
  }
}

function setup(limit = 5) {
  const store = new MemoryTtsStore();
  const wav = pcmToWav(new Uint8Array(100));
  const synthesize = vi.fn<SpeechSynth['synthesize']>(async () => ({ wav, model: 'tts-model' }));
  const deps = { userId: 'u1', store, synth: () => ({ synthesize }), dailyLimit: limit };
  return { store, synthesize, deps, wav };
}

describe('runTts', () => {
  it('serves a pre-generated MP3 without touching the budget or the model', async () => {
    const { store, synthesize, deps } = setup();
    store.sources.set('reluctant', 'public');
    const mp3 = await ttsObjectPath('en-GB', 'reluctant');
    store.objects.set(mp3, new Uint8Array([0xff, 0xfb]));
    const res = await runTts({ text: 'reluctant', voice: 'en-GB' }, deps);
    expect(res).toEqual({ url: store.publicUrl(mp3), cached: true });
    expect(synthesize).not.toHaveBeenCalled();
    expect(store.used.size).toBe(0);
  });

  it('finds the pre-generated headword in its lower-case form', async () => {
    const { store, synthesize, deps } = setup();
    store.sources.set('MONDAY', 'public');
    const mp3 = await ttsObjectPath('en-US', 'monday');
    store.objects.set(mp3, new Uint8Array([0xff, 0xfb]));
    await expect(runTts({ text: 'MONDAY', voice: 'en-US' }, deps)).resolves.toEqual({
      url: store.publicUrl(mp3),
      cached: true,
    });
    expect(synthesize).not.toHaveBeenCalled();
  });

  it('prefers the pre-generated MP3 over an older on-demand WAV', async () => {
    const { store, deps } = setup();
    store.sources.set('word', 'public');
    store.objects.set(await ttsOnDemandObjectPath('en-US', 'word'), new Uint8Array(4));
    const mp3 = await ttsObjectPath('en-US', 'word');
    store.objects.set(mp3, new Uint8Array(4));
    await expect(runTts({ text: 'word', voice: 'en-US' }, deps)).resolves.toMatchObject({
      url: store.publicUrl(mp3),
    });
  });

  it('generates a public miss once (on-demand WAV), then serves it from the cache', async () => {
    const { store, synthesize, deps } = setup();
    store.sources.set('reluctant', 'public');
    const first = await runTts({ text: 'reluctant', voice: 'en-US' }, deps);
    const path = await ttsOnDemandObjectPath('en-US', 'reluctant');
    expect(path).toMatch(/^en-US\/[0-9a-f]{64}\.wav$/);
    expect(path).not.toBe((await ttsObjectPath('en-US', 'reluctant')).replace('.mp3', '.wav'));
    expect(first).toEqual({ url: store.publicUrl(path), cached: false });
    const again = await runTts({ text: ' reluctant ', voice: 'en-US' }, { ...deps, userId: 'u2' });
    expect(again).toEqual({ url: store.publicUrl(path), cached: true });
    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(store.used.get('u2')).toBeUndefined(); // hits are free
  });

  it('keys the cache by accent', async () => {
    expect(await ttsObjectPath('en-US', 'flat')).not.toBe(await ttsObjectPath('en-GB', 'flat'));
  });

  it('always allows the settings sample', async () => {
    const { deps } = setup();
    await expect(runTts({ text: TTS_SAMPLE_TEXT, voice: 'en-GB' }, deps)).resolves.toMatchObject({
      cached: false,
    });
  });

  it('returns private text inline and never stores it', async () => {
    const { store, deps, wav } = setup();
    store.sources.set('I met him at the bank.', 'private');
    const res = await runTts({ text: 'I met him at the bank.', voice: 'en-US' }, deps);
    expect(res).toEqual({ audio_b64: bytesToBase64(wav), mime: 'audio/wav' });
    expect(store.objects.size).toBe(0);
  });

  it('sends public audio inline when it cannot be stored', async () => {
    const { store, deps } = setup();
    store.sources.set('word', 'public');
    store.uploadOk = false;
    await expect(runTts({ text: 'word', voice: 'en-US' }, deps)).resolves.toHaveProperty(
      'audio_b64',
    );
  });

  it('refuses text that is on no card, without calling the model', async () => {
    const { synthesize, deps } = setup();
    await expect(runTts({ text: 'say anything', voice: 'en-US' }, deps)).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(runTts({ text: 'x', voice: 'fr-FR' }, deps)).rejects.toBeInstanceOf(ApiError);
    expect(synthesize).not.toHaveBeenCalled();
  });

  it('enforces the daily limit on misses only', async () => {
    const { store, synthesize, deps } = setup(1);
    store.sources.set('one', 'public');
    store.sources.set('two', 'public');
    await runTts({ text: 'one', voice: 'en-US' }, deps);
    await expect(runTts({ text: 'two', voice: 'en-US' }, deps)).rejects.toMatchObject({
      code: 'daily_limit',
    });
    await expect(runTts({ text: 'one', voice: 'en-US' }, deps)).resolves.toMatchObject({
      cached: true,
    });
    expect(synthesize).toHaveBeenCalledTimes(1);
  });

  it('maps provider errors to API errors', async () => {
    const { store, deps } = setup();
    store.sources.set('word', 'public');
    const synth = {
      synthesize: async () => Promise.reject(new AiError('quota_exceeded', 'q', 30)),
    };
    await expect(
      runTts({ text: 'word', voice: 'en-US' }, { ...deps, synth: () => synth }),
    ).rejects.toMatchObject({
      code: 'quota_exceeded',
      retryAfterS: 30,
    });
  });
});

// ------------------------------------------------------------------ Gemini adapter

function geminiAnswer(data: Uint8Array, mimeType: string) {
  return new Response(
    JSON.stringify({
      candidates: [
        { content: { parts: [{ inlineData: { mimeType, data: bytesToBase64(data) } }] } },
      ],
    }),
    { status: 200 },
  );
}

describe('createGeminiTts', () => {
  const voices = { 'en-US': 'VoiceUS', 'en-GB': 'VoiceGB' };

  it('asks for audio with the accent voice and wraps PCM as WAV', async () => {
    const fetch = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) =>
      geminiAnswer(new Uint8Array(200), 'audio/L16;codec=pcm;rate=24000'),
    );
    const tts = createGeminiTts({
      apiKey: 'k',
      model: 'tts-a',
      voices,
      fetch: fetch as typeof globalThis.fetch,
    });
    const r = await tts.synthesize('flat', 'en-GB');
    expect(isWav(r.wav)).toBe(true);
    expect(r.wav.length).toBe(244);
    expect(r.model).toBe('tts-a');
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain('/models/tts-a:generateContent');
    const body = JSON.parse(String(init!.body));
    expect(body.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe(
      'VoiceGB',
    );
    expect(body.contents[0].parts[0].text).toBe(ttsPrompt('flat', 'en-GB'));
    expect(body.contents[0].parts[0].text).toBe('flat');
    expect(body.generationConfig.speechConfig.languageCode).toBe('en-GB');
  });

  it('retries without languageCode when the model rejects it', async () => {
    const bodies: { generationConfig: { speechConfig: { languageCode?: string } } }[] = [];
    const fetch = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      const b = JSON.parse(String(init!.body));
      bodies.push(b);
      return b.generationConfig.speechConfig.languageCode
        ? new Response(
            JSON.stringify({
              error: { status: 'INVALID_ARGUMENT', message: 'Unknown name "languageCode"' },
            }),
            { status: 400 },
          )
        : geminiAnswer(new Uint8Array(200), 'audio/L16;codec=pcm;rate=24000');
    });
    const tts = createGeminiTts({
      apiKey: 'k',
      model: 'tts-a',
      voices,
      fetch: fetch as typeof globalThis.fetch,
      sleep: async () => {},
    });
    const r = await tts.synthesize('flat', 'en-US');
    expect(isWav(r.wav)).toBe(true);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!.generationConfig.speechConfig.languageCode).toBeUndefined();
  });

  it('falls back to the second model on quota errors', async () => {
    const wav = pcmToWav(new Uint8Array(200));
    const fetch = vi.fn(async (u: string | URL | Request) =>
      String(u).includes('tts-a')
        ? new Response(JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'q' } }), {
            status: 429,
          })
        : geminiAnswer(wav, 'audio/wav'),
    );
    const tts = createGeminiTts({
      apiKey: 'k',
      model: 'tts-a',
      fallbackModel: 'tts-b',
      voices,
      fetch: fetch as typeof globalThis.fetch,
      sleep: async () => {},
    });
    const r = await tts.synthesize('word', 'en-US');
    expect(r.model).toBe('tts-b');
    expect(r.wav).toEqual(wav);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reports quota_exceeded when every model is out of quota', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED' } }), { status: 429 }),
    );
    const tts = createGeminiTts({
      apiKey: 'k',
      model: 'a',
      fallbackModel: 'b',
      voices,
      fetch: fetch as typeof globalThis.fetch,
    });
    await expect(tts.synthesize('word', 'en-US')).rejects.toMatchObject({ code: 'quota_exceeded' });
  });

  it('retries an answer without audio, then fails', async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'OTHER' }] })),
    );
    const tts = createGeminiTts({
      apiKey: 'k',
      model: 'a',
      fallbackModel: null,
      voices,
      fetch: fetch as typeof globalThis.fetch,
      sleep: async () => {},
    });
    await expect(tts.synthesize('word', 'en-US')).rejects.toMatchObject({ code: 'ai_failed' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

// ------------------------------------------------------------------ cache keys

describe('tts cache keys', () => {
  // Pinned: the client, the edge function and scripts/tts-pregen.ts must agree byte for byte,
  // and every file already in the bucket is named by this. Changing it orphans them all.
  it('names the pre-generated MP3 by sha256 of version, voice and normalised text', async () => {
    expect(TTS_CACHE_VERSION).toBe('tts-v3');
    expect(ttsKeyMaterial('en-US', '  Run\t out\nof ')).toBe('tts-v3\nen-US\nRun out of');
    const hash = await ttsSha256Hex('tts-v3\nen-US\nreluctant');
    expect(await ttsObjectPath('en-US', ' reluctant ')).toBe(`en-US/${hash}.mp3`);
    expect(await ttsSha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('keeps the on-demand WAV under the earlier version (old files stay usable)', async () => {
    const hash = await ttsSha256Hex('tts-v2\nen-GB\nreluctant');
    expect(await ttsOnDemandObjectPath('en-GB', 'reluctant')).toBe(`en-GB/${hash}.wav`);
  });

  it('normalises to NFC, so composed and decomposed text share one file', async () => {
    expect(await ttsObjectPath('en-US', 'cafe\u0301')).toBe(await ttsObjectPath('en-US', 'café'));
  });

  it('adds the lower-case form only for texts that could be a headword', () => {
    expect(ttsTextCandidates('monday')).toEqual(['monday']);
    expect(ttsTextCandidates(' Monday ')).toEqual(['Monday', 'monday']);
    expect(ttsTextCandidates('I like it.'.padEnd(121, '!'))).toHaveLength(1);
    expect(ttsTextCandidates('   ')).toEqual([]);
  });

  it('builds the public Storage URL', () => {
    expect(ttsPublicUrl('https://p.supabase.co/', 'en-US/ab.mp3')).toBe(
      'https://p.supabase.co/storage/v1/object/public/tts/en-US/ab.mp3',
    );
  });
});
