// Pronunciation through server audio played by an <audio> element, which works on every phone
// (docs/decisions/0028-server-tts.md). The browser's speechSynthesis (speakEnglish) stays as
// the fallback: for guests, offline without a cached copy, and on any failure.
//
// Mobile autoplay: play() must start inside the tap. The one shared Audio element is created
// and play()ed synchronously in the gesture (with a short silent clip while the real audio
// loads), which unlocks it on iOS; Chrome's sticky activation then allows the later play().
//
// Caches: object URLs in memory (instant replays), and the WAV files in Cache Storage so
// replays work offline and after a reload.

import { useRef, useSyncExternalStore } from 'react';

import { requestPronunciation } from '@/ai/tts';
import { getAuthState } from '@/features/auth/session';
import { isNativeApp } from '@/native/platform';
import {
  normalizeTtsText,
  TTS_CACHE_VERSION,
  ttsKeyMaterial,
  TTS_MAX_CHARS,
  type TtsResponse,
} from '../../../supabase/functions/_shared/tts-contract';
import { speakEnglish, type VoicePref } from './useSpeech';

/** Show the button's loading state only when the audio takes longer than this. */
export const LOADING_DELAY_MS = 250;
const MEMORY_MAX = 200;
const DISK_MAX = 1000;
const CACHE_NAME = 'engapp-tts';

export interface PlayOptions {
  /** Called once when playback ends, fails, or is replaced by a newer tap. */
  onDone?: () => void;
}

export interface AudioCache {
  get(key: string): Promise<Blob | null>;
  put(key: string, blob: Blob): Promise<void>;
}

export interface PronunciationDeps {
  /** Server audio may be asked for (backend configured, not a guest). */
  serverAllowed: () => boolean;
  online: () => boolean;
  request: (text: string, voice: VoicePref) => Promise<TtsResponse>;
  fetchBlob: (url: string) => Promise<Blob>;
  cache: () => AudioCache | null;
  createAudio: () => HTMLAudioElement;
  createObjectURL: (b: Blob) => string;
  revokeObjectURL: (u: string) => void;
  fallback: (text: string, voice: VoicePref, onDone: () => void) => boolean;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

// A 0.05 s silent WAV (8 kHz, 8-bit mono, 400 samples) to unlock the element inside the tap.
const SILENCE =
  'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACA' +
  'gICA'.repeat(133);

/** sha256 hex, for the Cache Storage key. */
async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Cache Storage, when the browser has it (secure contexts). Never throws. */
export function cacheStorageAudioCache(): AudioCache | null {
  if (typeof caches === 'undefined' || typeof location === 'undefined') return null;
  const url = async (key: string) =>
    `${location.origin}/__tts/${TTS_CACHE_VERSION}/${await sha256Hex(key)}.wav`;
  return {
    async get(key) {
      try {
        const hit = await (await caches.open(CACHE_NAME)).match(await url(key));
        return hit ? await hit.blob() : null;
      } catch {
        return null;
      }
    },
    async put(key, blob) {
      try {
        const c = await caches.open(CACHE_NAME);
        await c.put(
          await url(key),
          new Response(blob, { headers: { 'content-type': 'audio/wav' } }),
        );
        const keys = await c.keys();
        for (const k of keys.slice(0, Math.max(0, keys.length - DISK_MAX))) await c.delete(k);
      } catch {
        // quota or private mode: memory cache only
      }
    },
  };
}

// ---------------------------------------------------------------- busy state (button UI)

type Owner = object;
let loadingOwner: Owner | null = null;
let currentOwner: Owner | null = null;
const busyListeners = new Set<() => void>();

function setLoadingOwner(o: Owner | null) {
  if (loadingOwner === o) return;
  loadingOwner = o;
  for (const l of busyListeners) l();
}

function subscribeBusy(l: () => void) {
  busyListeners.add(l);
  return () => busyListeners.delete(l);
}

/**
 * Loading state for one speaker button. Wrap the tap with `run`; `busy` is true while that
 * button's audio is still loading (after LOADING_DELAY_MS).
 */
export function usePronunciationBusy(): { busy: boolean; run: (fn: () => void) => void } {
  const owner = useRef<Owner>({}).current;
  const busy = useSyncExternalStore(
    subscribeBusy,
    () => loadingOwner === owner,
    () => false,
  );
  const run = (fn: () => void) => {
    currentOwner = owner;
    try {
      fn();
    } finally {
      currentOwner = null;
    }
  };
  return { busy, run };
}

// ---------------------------------------------------------------- player

export interface Pronouncer {
  play(text: string, voice: VoicePref, opts?: PlayOptions): boolean;
  /** For tests: forget the in-memory URLs. */
  reset(): void;
}

export function createPronouncer(deps: PronunciationDeps): Pronouncer {
  const memory = new Map<string, string>(); // key -> object URL (insertion order = age)
  let el: HTMLAudioElement | null = null;
  let seq = 0;
  let finishCurrent: (() => void) | null = null;

  const remember = (key: string, url: string) => {
    memory.delete(key);
    memory.set(key, url);
    while (memory.size > MEMORY_MAX) {
      const [oldKey, oldUrl] = memory.entries().next().value as [string, string];
      memory.delete(oldKey);
      deps.revokeObjectURL(oldUrl);
    }
  };

  async function loadBlob(key: string, text: string, voice: VoicePref): Promise<Blob | string> {
    const cache = deps.cache();
    const cached = await cache?.get(key);
    if (cached) return cached;
    if (!deps.online() || !deps.serverAllowed()) throw new Error('no server audio');
    const res = await deps.request(text, voice);
    if ('audio_b64' in res) {
      const blob = base64ToBlob(res.audio_b64, res.mime);
      void cache?.put(key, blob);
      return blob;
    }
    try {
      const blob = await deps.fetchBlob(res.url);
      void cache?.put(key, blob);
      return blob;
    } catch {
      return res.url; // still playable straight from Storage, just not kept offline
    }
  }

  return {
    reset() {
      for (const u of memory.values()) deps.revokeObjectURL(u);
      memory.clear();
      el = null;
    },

    play(rawText, voice, opts = {}) {
      const text = normalizeTtsText(rawText);
      if (!text) return false;
      const owner = currentOwner;
      const id = ++seq;
      finishCurrent?.(); // a newer tap replaces whatever was playing or loading

      let done = false;
      let loadingTimer: unknown = null;
      const finish = () => {
        if (done) return;
        done = true;
        if (loadingTimer !== null) deps.clearTimeout(loadingTimer);
        if (loadingOwner === owner) setLoadingOwner(null);
        if (finishCurrent === finish) finishCurrent = null;
        opts.onDone?.();
      };
      const fallback = () => {
        if (id !== seq) return finish();
        if (!deps.fallback(rawText, voice, finish)) finish();
      };

      // Guests (and texts the server would refuse) use the device voice, still inside the tap.
      if (text.length > TTS_MAX_CHARS || !deps.serverAllowed()) {
        el?.pause();
        fallback();
        return true;
      }

      el ??= deps.createAudio();
      const audio = el;
      audio.pause();
      finishCurrent = finish;

      const start = (src: string) => {
        if (id !== seq) return;
        audio.onended = finish;
        audio.onerror = () => {
          if (id === seq && !done) fallback();
        };
        audio.src = src;
        audio.play().catch(() => {
          if (id === seq && !done) fallback();
        });
      };

      const key = ttsKeyMaterial(voice, text);
      const known = memory.get(key);
      if (known) {
        start(known);
        return true;
      }

      // Unlock the element inside the gesture; the real audio follows.
      audio.onended = null;
      audio.onerror = null;
      audio.src = SILENCE;
      audio.play().catch(() => {});
      loadingTimer = deps.setTimeout(() => {
        loadingTimer = null;
        if (!done && owner) setLoadingOwner(owner);
      }, LOADING_DELAY_MS);

      loadBlob(key, text, voice).then(
        (blobOrUrl) => {
          if (id !== seq) return;
          if (loadingTimer !== null) deps.clearTimeout(loadingTimer);
          loadingTimer = null;
          if (loadingOwner === owner) setLoadingOwner(null);
          let src: string;
          if (typeof blobOrUrl === 'string') src = blobOrUrl;
          else {
            src = deps.createObjectURL(blobOrUrl);
            remember(key, src);
          }
          start(src);
        },
        () => {
          if (id !== seq) return;
          if (loadingOwner === owner) setLoadingOwner(null);
          fallback();
        },
      );
      return true;
    },
  };
}

/**
 * The device voice: the phone's TextToSpeech engine in the Android app (its WebView has no
 * usable speechSynthesis; src/native/tts.ts), the browser's speechSynthesis on the web.
 */
export function deviceVoice(
  text: string,
  voice: VoicePref,
  onDone: () => void,
  native: boolean = isNativeApp(),
): boolean {
  if (!native) return speakEnglish(text, voice, { onDone });
  void import('@/native/tts')
    .then((m) => m.speakNative(text, voice))
    .catch(() => {})
    .finally(onDone);
  return true;
}

const defaultPronouncer = createPronouncer({
  serverAllowed: () => {
    const s = getAuthState().status;
    return s === 'signed_in' || s === 'loading';
  },
  online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  request: (text, voice) => requestPronunciation(text, voice),
  fetchBlob: async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.blob();
  },
  cache: (() => {
    let c: AudioCache | null | undefined;
    return () => (c === undefined ? (c = cacheStorageAudioCache()) : c);
  })(),
  createAudio: () => new Audio(),
  createObjectURL: (b) => URL.createObjectURL(b),
  revokeObjectURL: (u) => URL.revokeObjectURL(u),
  // Offline without a cached copy (and every failure) goes straight to the device voice.
  fallback: (text, voice, onDone) => deviceVoice(text, voice, onDone),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id as number),
});

/**
 * Plays `text` in the chosen accent: server audio when possible, else the browser voice.
 * Call it directly from a tap handler. Returns false when there is nothing to say.
 */
export function playPronunciation(text: string, voice: VoicePref, opts?: PlayOptions): boolean {
  return defaultPronouncer.play(text, voice, opts);
}

/** True when this browser can play pronunciations at all (audio element or speech engine). */
export function pronunciationSupported(): boolean {
  if (isNativeApp()) return true; // native TextToSpeech is always there as the fallback
  return (
    typeof Audio !== 'undefined' || (typeof window !== 'undefined' && 'speechSynthesis' in window)
  );
}
