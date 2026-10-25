import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  createPronouncer,
  fetchPregeneratedAudio,
  LOADING_DELAY_MS,
  usePronunciationBusy,
  type AudioCache,
  type PronunciationDeps,
} from './pronunciation';
import type { TtsResponse } from '@/ai/tts';
import { ttsObjectPath, ttsPublicUrl } from '../../../supabase/functions/_shared/tts-contract';

const BASE = 'https://p.supabase.co';

class FakeAudio {
  src = '';
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  played: string[] = [];
  failOn: ((src: string) => boolean) | null = null;
  pause = vi.fn();
  play = vi.fn(() => {
    this.played.push(this.src);
    return this.failOn?.(this.src) ? Promise.reject(new Error('NotAllowed')) : Promise.resolve();
  });
}

class MemoryCache implements AudioCache {
  map = new Map<string, Blob>();
  async get(k: string) {
    return this.map.get(k) ?? null;
  }
  async put(k: string, b: Blob) {
    this.map.set(k, b);
  }
}

// Several macrotask turns: the object path is a Web Crypto digest, which settles off-thread.
const flush = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await new Promise<void>((r) => setTimeout(r, 0));
  });

function setup(over: Partial<PronunciationDeps> = {}) {
  const audio = new FakeAudio();
  const cache = new MemoryCache();
  const timers: { fn: () => void; ms: number }[] = [];
  let urls = 0;
  const deps: PronunciationDeps = {
    serverAllowed: () => true,
    online: () => true,
    request: vi.fn(async (): Promise<TtsResponse> => ({
      url: 'https://s.example/tts/a.wav',
      cached: true,
    })),
    fetchBlob: vi.fn(async () => new Blob(['RIFF'], { type: 'audio/wav' })),
    publicUrl: (path) => ttsPublicUrl(BASE, path),
    // Default: nothing pre-generated (Storage answers 4xx), so the edge function is asked.
    fetchPregenerated: vi.fn(async (): Promise<Blob | null> => null),
    cache: () => cache,
    createAudio: vi.fn(() => audio as unknown as HTMLAudioElement),
    createObjectURL: vi.fn(() => `blob:${++urls}`),
    revokeObjectURL: vi.fn(),
    fallback: vi.fn((_t: string, _v: string, onDone: () => void) => {
      onDone();
      return true;
    }),
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
    clearTimeout: () => {},
    ...over,
  };
  return { p: createPronouncer(deps), deps, audio, cache, timers };
}

describe('playPronunciation', () => {
  it('guests use the device voice right away, inside the tap', () => {
    const { p, deps } = setup({ serverAllowed: () => false });
    expect(p.play('reluctant', 'en-US')).toBe(true);
    expect(deps.fallback).toHaveBeenCalledWith('reluctant', 'en-US', expect.any(Function));
    expect(deps.createAudio).not.toHaveBeenCalled();
  });

  it('starts the audio element inside the tap, then plays the server audio', async () => {
    const { p, deps, audio } = setup();
    p.play(' reluctant ', 'en-GB');
    // Synchronously, before any await: the element exists and play() was called.
    expect(deps.createAudio).toHaveBeenCalledTimes(1);
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.played[0]).toMatch(/^data:audio\/wav;base64,UklGR/);
    await flush();
    expect(deps.request).toHaveBeenCalledWith('reluctant', 'en-GB');
    expect(deps.fetchBlob).toHaveBeenCalledWith('https://s.example/tts/a.wav');
    expect(audio.played.at(-1)).toBe('blob:1');
    expect(deps.fallback).not.toHaveBeenCalled();
  });

  it('replays from memory synchronously, without the network', async () => {
    const { p, deps, audio } = setup();
    p.play('word', 'en-US');
    await flush();
    p.play('word', 'en-US');
    expect(audio.played.at(-1)).toBe('blob:1');
    expect(deps.request).toHaveBeenCalledTimes(1);
  });

  it('keeps the audio in the offline cache and plays it when offline', async () => {
    let online = true;
    const { p, deps, audio, cache } = setup({ online: () => online });
    p.play('word', 'en-US');
    await flush();
    expect(cache.map.size).toBe(1);
    p.reset(); // like a page reload: memory is gone, Cache Storage stays
    online = false;
    p.play('word', 'en-US');
    await flush();
    expect(deps.request).toHaveBeenCalledTimes(1);
    expect(audio.played.at(-1)).toBe('blob:2');
    expect(deps.fallback).not.toHaveBeenCalled();
  });

  it('separates accents', async () => {
    const { p, deps } = setup();
    p.play('flat', 'en-US');
    await flush();
    p.play('flat', 'en-GB');
    await flush();
    expect(deps.request).toHaveBeenCalledTimes(2);
  });

  it('plays inline audio for the user’s own sentences', async () => {
    const { p, deps, audio, cache } = setup({
      request: vi.fn(async () => ({ audio_b64: btoa('RIFFxxxxWAVE'), mime: 'audio/wav' as const })),
    });
    p.play('I met him at the bank.', 'en-US');
    await flush();
    expect(deps.fetchBlob).not.toHaveBeenCalled();
    expect(audio.played.at(-1)).toBe('blob:1');
    expect(cache.map.size).toBe(1);
  });

  it('plays straight from the URL when the file cannot be downloaded', async () => {
    const { p, audio } = setup({ fetchBlob: vi.fn(async () => Promise.reject(new Error('cors'))) });
    p.play('word', 'en-US');
    await flush();
    expect(audio.played.at(-1)).toBe('https://s.example/tts/a.wav');
  });

  it('falls back to the device voice when the server fails', async () => {
    const onDone = vi.fn();
    const { p, deps } = setup({
      request: vi.fn(async () => Promise.reject(new Error('daily_limit'))),
    });
    p.play('word', 'en-US', { onDone });
    await flush();
    expect(deps.fallback).toHaveBeenCalledWith('word', 'en-US', expect.any(Function));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('falls back when offline with nothing cached', async () => {
    const { p, deps } = setup({ online: () => false });
    p.play('word', 'en-US');
    await flush();
    expect(deps.request).not.toHaveBeenCalled();
    expect(deps.fallback).toHaveBeenCalled();
  });

  it('falls back when the element refuses to play', async () => {
    const { p, deps, audio } = setup();
    audio.failOn = (src) => src.startsWith('blob:');
    p.play('word', 'en-US');
    await flush();
    expect(deps.fallback).toHaveBeenCalledTimes(1);
  });

  it('a newer tap replaces a pending one', async () => {
    const first = vi.fn();
    const { p, audio, deps } = setup();
    p.play('one', 'en-US', { onDone: first });
    p.play('two', 'en-US');
    expect(first).toHaveBeenCalledTimes(1);
    await flush();
    // Only the newer text is played; the older answer is dropped.
    expect(audio.played.filter((s) => s.startsWith('blob:'))).toHaveLength(1);
    expect(deps.request).toHaveBeenLastCalledWith('two', 'en-US');
  });

  it('calls onDone when playback ends', async () => {
    const onDone = vi.fn();
    const { p, audio } = setup();
    p.play('word', 'en-US', { onDone });
    await flush();
    audio.onended?.();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('does not ask the server for text over the limit', () => {
    const { p, deps } = setup();
    p.play('a'.repeat(301), 'en-US');
    expect(deps.request).not.toHaveBeenCalled();
    expect(deps.fallback).toHaveBeenCalled();
  });

  it('shows the loading state on the tapped button only after a delay', async () => {
    let resolve!: (r: TtsResponse) => void;
    const { p, timers } = setup({
      request: vi.fn(() => new Promise<TtsResponse>((r) => (resolve = r))),
    });
    const a = renderHook(() => usePronunciationBusy());
    const b = renderHook(() => usePronunciationBusy());
    act(() => a.result.current.run(() => p.play('word', 'en-US')));
    expect(a.result.current.busy).toBe(false);
    expect(timers[0]!.ms).toBe(LOADING_DELAY_MS);
    act(() => timers[0]!.fn());
    expect(a.result.current.busy).toBe(true);
    expect(b.result.current.busy).toBe(false);
    await flush(); // the request starts after the offline-cache lookup
    resolve({ url: 'https://s.example/x.wav', cached: true });
    await flush();
    expect(a.result.current.busy).toBe(false);
  });
});

describe('pre-generated audio (fast path)', () => {
  const mp3 = () => new Blob([new Uint8Array([0xff, 0xfb, 0x90])], { type: 'audio/mpeg' });

  it('plays the pre-generated file straight from Storage, without the edge function', async () => {
    const url = ttsPublicUrl(BASE, await ttsObjectPath('en-GB', 'reluctant'));
    const fetchPregenerated = vi.fn(async (u: string) => (u === url ? mp3() : null));
    const { p, deps, audio, cache } = setup({ fetchPregenerated });
    p.play(' reluctant ', 'en-GB');
    await flush();
    expect(fetchPregenerated).toHaveBeenCalledWith(url);
    expect(url).toMatch(/\/storage\/v1\/object\/public\/tts\/en-GB\/[0-9a-f]{64}\.mp3$/);
    expect(deps.request).not.toHaveBeenCalled();
    expect(audio.played.at(-1)).toBe('blob:1');
    expect(cache.map.size).toBe(1); // kept for offline replays
  });

  it('falls back to the edge function when the file is not there (404)', async () => {
    const { p, deps, audio } = setup();
    p.play('brand-new word', 'en-US');
    await flush();
    expect(deps.fetchPregenerated).toHaveBeenCalledTimes(1);
    expect(deps.request).toHaveBeenCalledWith('brand-new word', 'en-US');
    expect(audio.played.at(-1)).toBe('blob:1');
  });

  it('falls back to the edge function when Storage cannot be reached', async () => {
    const { p, deps } = setup({
      fetchPregenerated: vi.fn(async () => Promise.reject(new Error('network'))),
    });
    p.play('word', 'en-US');
    await flush();
    expect(deps.request).toHaveBeenCalledTimes(1);
    expect(deps.fallback).not.toHaveBeenCalled();
  });

  it('tries the lower-case headword file for a capitalised word', async () => {
    const lower = ttsPublicUrl(BASE, await ttsObjectPath('en-US', 'monday'));
    const fetchPregenerated = vi.fn(async (u: string) => (u === lower ? mp3() : null));
    const { p, deps } = setup({ fetchPregenerated });
    p.play('MONDAY', 'en-US');
    await flush();
    expect(fetchPregenerated).toHaveBeenCalledTimes(2);
    expect(fetchPregenerated).toHaveBeenLastCalledWith(lower);
    expect(deps.request).not.toHaveBeenCalled();
  });

  it('asks the edge function directly when no backend URL is known', async () => {
    const { p, deps } = setup({ publicUrl: () => null });
    p.play('word', 'en-US');
    await flush();
    expect(deps.fetchPregenerated).not.toHaveBeenCalled();
    expect(deps.request).toHaveBeenCalledTimes(1);
  });

  it('prefetches into memory, so the tap plays synchronously', async () => {
    const fetchPregenerated = vi.fn(async () => mp3());
    const { p, deps, audio } = setup({ fetchPregenerated });
    await expect(p.prefetch(['thorough', 'run out of'], 'en-US')).resolves.toBe(2);
    p.play('thorough', 'en-US');
    expect(audio.played).toEqual(['blob:1']); // no silent unlock clip: already in memory
    expect(deps.request).not.toHaveBeenCalled();
  });

  it('never spends the server budget on a prefetch', async () => {
    const { p, deps } = setup();
    await expect(p.prefetch(['private sentence of mine'], 'en-US')).resolves.toBe(0);
    expect(deps.request).not.toHaveBeenCalled();
  });

  it('prefetches nothing for guests or offline', async () => {
    const guest = setup({ serverAllowed: () => false });
    await expect(guest.p.prefetch(['word'], 'en-US')).resolves.toBe(0);
    const offline = setup({ online: () => false });
    await expect(offline.p.prefetch(['word'], 'en-US')).resolves.toBe(0);
    expect(guest.deps.fetchPregenerated).not.toHaveBeenCalled();
    expect(offline.deps.fetchPregenerated).not.toHaveBeenCalled();
  });

  it('a tap during a missing prefetch still reaches the edge function', async () => {
    let miss!: (b: Blob | null) => void;
    const fetchPregenerated = vi.fn(() => new Promise<Blob | null>((r) => (miss = r)));
    const { p, deps, audio } = setup({ fetchPregenerated });
    const pre = p.prefetch(['word'], 'en-US');
    await flush();
    p.play('word', 'en-US');
    miss(null);
    await flush();
    await pre;
    expect(fetchPregenerated).toHaveBeenCalledTimes(1);
    expect(deps.request).toHaveBeenCalledTimes(1);
    expect(audio.played.at(-1)).toBe('blob:1');
  });
});

describe('fetchPregeneratedAudio', () => {
  const reply = (status: number, body = 'ID3') =>
    vi.fn(async () => new Response(status === 204 ? null : body, { status }));

  it('returns the audio on 200', async () => {
    const blob = await fetchPregeneratedAudio('u', reply(200) as unknown as typeof fetch);
    expect(blob?.size).toBe(3);
  });

  it('treats 400 and 404 as "not generated yet"', async () => {
    await expect(fetchPregeneratedAudio('u', reply(404) as unknown as typeof fetch)).resolves.toBe(
      null,
    );
    await expect(fetchPregeneratedAudio('u', reply(400) as unknown as typeof fetch)).resolves.toBe(
      null,
    );
  });

  it('throws on server errors, so the caller can try the edge function', async () => {
    await expect(
      fetchPregeneratedAudio('u', reply(503) as unknown as typeof fetch),
    ).rejects.toThrow('HTTP 503');
  });
});
