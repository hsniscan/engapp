// Pronunciation through server audio played by an <audio> element, which works on every phone
// (docs/decisions/0028-server-tts.md). The browser's speechSynthesis (speakEnglish) stays as
// the fallback: for guests, offline without a cached copy, and on any failure.
//
// Mobile autoplay: play() must start inside the tap. The one shared Audio element is created
// and play()ed synchronously in the gesture (with a short silent clip while the real audio
// loads), which unlocks it on iOS; Chrome's sticky activation then allows the later play().
//
// Where the audio comes from (docs/decisions/0042-pregenerated-tts.md), first hit wins:
//   1. memory (object URLs: instant replays) and Cache Storage (offline, after a reload);
//   2. the pre-generated MP3 in the public `tts` bucket, fetched straight from Storage: the
//      client computes the object path itself (same key as the server, tts-contract.ts), so
//      a dictionary word or sentence plays with no edge-function round trip;
//   3. the `tts` edge function, only when that file is not there (a 4xx): private text and
//      dictionary entries newer than the last pre-generation run;
//   4. the device voice, on any failure.
// The review screen prefetches the current card's word (prefetchPronunciations), so the tap
// usually finds it in memory.

import { useRef, useSyncExternalStore } from 'react';

import { requestPronunciation } from '@/ai/tts';
import { getAuthState } from '@/features/auth/session';
import { backendConfig } from '@/lib/supabase';
import { isNativeApp } from '@/native/platform';
import {
  normalizeTtsText,
  TTS_CACHE_VERSION,
  ttsKeyMaterial,
  TTS_MAX_CHARS,
  ttsObjectPath,
  ttsPublicUrl,
  ttsSha256Hex,
  ttsTextCandidates,
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
  /** Public URL of an object in the `tts` bucket; null when no backend is configured. */
  publicUrl: (path: string) => string | null;
  /**
   * Fetches a pre-generated file: the audio, or null when it is not there (any 4xx: Storage
   * answers 400 or 404 for a missing object). Throws on network errors.
   */
  fetchPregenerated: (url: string) => Promise<Blob | null>;
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

const sha256Hex = ttsSha256Hex;

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
    `${location.origin}/__tts/${TTS_CACHE_VERSION}/${await sha256Hex(key)}`;
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
          new Response(blob, { headers: { 'content-type': blob.type || 'audio/mpeg' } }),
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
  /**
   * Fetches the pre-generated audio of these texts into the caches ahead of a tap. Never calls
   * the edge function (no budget is spent on audio nobody asked for). Resolves to how many
   * texts are now ready.
   */
  prefetch(texts: readonly string[], voice: VoicePref): Promise<number>;
  /** The audio of `text` is in memory: play() starts at once and asks no server. */
  ready(text: string, voice: VoicePref): boolean;
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

  /** The pre-generated file of `text` (or of its lower-case headword form), or null. */
  async function fetchPregenerated(text: string, voice: VoicePref): Promise<Blob | null> {
    for (const t of ttsTextCandidates(text)) {
      const url = deps.publicUrl(await ttsObjectPath(voice, t));
      if (!url) return null;
      try {
        const blob = await deps.fetchPregenerated(url);
        if (blob) return blob;
      } catch {
        return null; // network trouble: let the edge function (or the device voice) decide
      }
    }
    return null;
  }

  // One load per key at a time, shared by a tap and a prefetch of the same text. A tap that
  // finds a prefetch (Storage only) still in flight goes on to the server if that misses.
  const inflight = new Map<string, { p: Promise<Blob | string>; viaServer: boolean }>();
  function load(
    key: string,
    text: string,
    voice: VoicePref,
    viaServer: boolean,
  ): Promise<Blob | string> {
    const running = inflight.get(key);
    if (running && (running.viaServer || !viaServer)) return running.p;
    const p: Promise<Blob | string> = (
      running
        ? running.p.catch(() => loadBlob(key, text, voice, true, false))
        : loadBlob(key, text, voice, viaServer)
    ).finally(() => {
      if (inflight.get(key)?.p === p) inflight.delete(key);
    });
    inflight.set(key, { p, viaServer });
    return p;
  }

  async function loadBlob(
    key: string,
    text: string,
    voice: VoicePref,
    viaServer: boolean,
    tryStorage = true,
  ): Promise<Blob | string> {
    const cache = deps.cache();
    const cached = await cache?.get(key);
    if (cached) return cached;
    if (!deps.online() || !deps.serverAllowed()) throw new Error('no server audio');
    const pre = tryStorage ? await fetchPregenerated(text, voice) : null;
    if (pre) {
      void cache?.put(key, pre);
      return pre;
    }
    if (!viaServer) throw new Error('not pre-generated');
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
      inflight.clear();
      el = null;
    },

    ready(rawText, voice) {
      const text = normalizeTtsText(rawText);
      return !!text && memory.has(ttsKeyMaterial(voice, text));
    },

    async prefetch(texts, voice) {
      if (!deps.serverAllowed() || !deps.online()) return 0;
      let ready = 0;
      for (const raw of texts) {
        const text = normalizeTtsText(raw);
        if (!text || text.length > TTS_MAX_CHARS) continue;
        const key = ttsKeyMaterial(voice, text);
        if (memory.has(key)) {
          ready++;
          continue;
        }
        try {
          const blob = await load(key, text, voice, false);
          if (typeof blob !== 'string' && !memory.has(key)) {
            remember(key, deps.createObjectURL(blob));
          }
          ready++;
        } catch {
          // not pre-generated (or offline): the tap will ask the server
        }
      }
      return ready;
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

      load(key, text, voice, true).then(
        (blobOrUrl) => {
          if (id !== seq) return;
          if (loadingTimer !== null) deps.clearTimeout(loadingTimer);
          loadingTimer = null;
          if (loadingOwner === owner) setLoadingOwner(null);
          let src: string;
          if (typeof blobOrUrl === 'string') src = blobOrUrl;
          else {
            src = memory.get(key) ?? deps.createObjectURL(blobOrUrl);
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
  publicUrl: (path) => (backendConfig ? ttsPublicUrl(backendConfig.url, path) : null),
  fetchPregenerated: fetchPregeneratedAudio,
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
 * Fetch for the pre-generated files: the blob on 2xx, null on 4xx (not generated yet), an
 * error otherwise. A short timeout: the edge function is the next step, not a long wait.
 */
export async function fetchPregeneratedAudio(
  url: string,
  doFetch: typeof fetch = fetch,
  timeoutMs = 6000,
): Promise<Blob | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await doFetch(url, { signal: ctrl.signal });
    if (r.status >= 400 && r.status < 500) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const blob = await r.blob();
    return blob.size > 0 ? blob : null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Prefetches the pre-generated audio of these texts (e.g. the card on screen), so the next tap
 * plays from memory. Quietly does nothing for guests, offline, or when data saver is on.
 */
export function prefetchPronunciations(texts: readonly string[], voice: VoicePref): void {
  const conn = (globalThis.navigator as { connection?: { saveData?: boolean } } | undefined)
    ?.connection;
  if (conn?.saveData) return;
  void defaultPronouncer.prefetch(texts, voice).catch(() => {});
}

/**
 * The reader's listen-along (decision 0043): fetches only the pre-generated files of these
 * sentences (never the edge function, so the user's text is not sent anywhere) and resolves
 * to how many are ready; then `pronunciationReady` tells which can play from memory.
 */
export function prefetchPregenerated(texts: readonly string[], voice: VoicePref): Promise<number> {
  return defaultPronouncer.prefetch(texts, voice).catch(() => 0);
}

/** True when `text` plays from memory (pre-generated or already played): no server call. */
export function pronunciationReady(text: string, voice: VoicePref): boolean {
  return defaultPronouncer.ready(text, voice);
}

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
