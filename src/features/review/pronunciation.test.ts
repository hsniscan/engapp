import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  createPronouncer,
  LOADING_DELAY_MS,
  usePronunciationBusy,
  type AudioCache,
  type PronunciationDeps,
} from './pronunciation';
import type { TtsResponse } from '@/ai/tts';

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

const flush = () => act(async () => new Promise<void>((r) => setTimeout(r, 0)));

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
