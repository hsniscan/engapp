// The recorded sentences of a library text (v0.5.1, decision 0054). Every graded sentence has
// an `audio_key`: the object path of its en-US clip in the public audio bucket (Cloudflare R2
// under VITE_AUDIO_BASE_URL first, then the Supabase `tts` bucket; tts-contract.ts
// ttsAudioUrls). The files are public, so guests hear them too; nothing about the user is sent.
// When a clip cannot be played (offline, not there, blocked) the device voice reads the
// sentence instead, so "Dinleyerek oku" never stops in the middle of a text.
//
// Since v0.5.3 (decision 0073) the library is recorded in both accents. The British clip has no
// stored key: it is content-addressed like every clip, so it is computed from the sentence. A
// clip string may hold several space-separated paths, tried in order (the chosen accent first,
// then the stored en-US clip for a text recorded before both accents were).
import { backendConfig } from '@/lib/supabase';
import {
  parseAudioBaseUrl,
  ttsAudioUrls,
  ttsObjectPath,
  type TtsVoice,
} from '../../../supabase/functions/_shared/tts-contract';

const AUDIO_BASE_URL = parseAudioBaseUrl(import.meta.env.VITE_AUDIO_BASE_URL);

/** Where a clip may be fetched, best first; empty when no audio host is configured. */
export function gradedClipUrls(
  key: string,
  from: { audioBaseUrl: string | null; supabaseUrl: string | null } = {
    audioBaseUrl: AUDIO_BASE_URL,
    supabaseUrl: backendConfig?.url ?? null,
  },
): string[] {
  const out: string[] = [];
  for (const part of key.split(/\s+/)) {
    const path = part.replace(/^\/+/, '');
    if (!path || path.includes('..')) continue;
    for (const url of ttsAudioUrls(path, from)) if (!out.includes(url)) out.push(url);
  }
  return out;
}

/**
 * The clip string of a library sentence in the reader's accent: the stored en-US key as it is,
 * or the British clip's path first and the stored key after it. Null when the sentence has no
 * recording.
 */
export async function voicedClipKey(
  row: { en: string; audio_key: string | null },
  voice: TtsVoice,
): Promise<string | null> {
  const key = row.audio_key?.trim();
  if (!key) return null;
  if (voice === 'en-US') return key;
  return `${await ttsObjectPath(voice, row.en)} ${key}`;
}

let el: HTMLAudioElement | null = null;
let seq = 0;

/**
 * Plays a recorded sentence; `onDone` once when it ends. `fallback` (the device voice) is used
 * when no address works. Returns false only when there is nothing to play and no fallback.
 */
export function playGradedClip(
  key: string,
  onDone: () => void,
  fallback: () => boolean,
  urls: readonly string[] = gradedClipUrls(key),
  /** Listening speed, 1 = normal (the recording keeps its pitch). */
  rate = 1,
): boolean {
  if (typeof Audio === 'undefined' || urls.length === 0) return fallback();
  const id = ++seq;
  el ??= new Audio();
  const audio = el;
  let done = false;
  let at = -1;
  const finish = () => {
    if (done || id !== seq) return;
    done = true;
    onDone();
  };
  const tryAt = (i: number) => {
    if (id !== seq || i <= at) return;
    at = i;
    const url = urls[i];
    if (url === undefined) {
      done = true;
      if (!fallback()) onDone();
      return;
    }
    audio.onended = finish;
    audio.onerror = () => tryAt(i + 1);
    audio.src = url;
    audio.playbackRate = rate;
    const playing = audio.play() as Promise<void> | undefined;
    playing?.catch(() => {
      if (!done) tryAt(i + 1);
    });
  };
  audio.pause();
  tryAt(0);
  return true;
}

/** Stops a recorded sentence (its onDone is not called). */
export function stopGradedClip(): void {
  seq++;
  el?.pause();
}

const warmed = new Set<string>();

/** Warms the browser's cache for the next clips, so the reading does not pause between them. */
export function prefetchGradedClips(keys: readonly (string | null | undefined)[]): void {
  if (typeof Audio === 'undefined') return;
  const conn = (globalThis.navigator as { connection?: { saveData?: boolean } } | undefined)
    ?.connection;
  if (conn?.saveData) return;
  for (const key of keys) {
    const url = key ? gradedClipUrls(key)[0] : undefined;
    if (!url || warmed.has(url)) continue;
    warmed.add(url);
    if (warmed.size > 64) warmed.delete(warmed.values().next().value as string);
    const a = new Audio();
    a.preload = 'auto';
    a.src = url;
  }
}
