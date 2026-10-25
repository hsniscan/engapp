// Request/response contract of the `tts` edge function (server pronunciation audio,
// docs/decisions/0028-server-tts.md). Imported by the function (Deno) and by the web client
// (src/ai/tts.ts). Kept apart from contracts.ts so it can change on its own.
//
// It also names the audio files in the public `tts` bucket (docs/decisions/0042): the client
// computes the same object path and plays the file straight from Storage, so these helpers
// must stay byte-for-byte identical on both sides (and in scripts/tts-pregen.ts, which makes
// the files).

import { z } from 'zod';

/** Longest text the server reads aloud (characters, after normalizeTtsText). */
export const TTS_MAX_CHARS = 300;

export const TTS_VOICES = ['en-US', 'en-GB'] as const;
export type TtsVoice = (typeof TTS_VOICES)[number];

/**
 * Version of the pre-generated audio (Kokoro-82M MP3, made by scripts/tts-pregen.ts; decision
 * 0042). Bump when the engine, the voices or the audio format change: it is part of the key,
 * so old files are simply no longer used and the next pre-generation run makes new ones.
 */
export const TTS_CACHE_VERSION = 'tts-v3';

/**
 * Version of the on-demand audio the `tts` function makes with Gemini when no pre-generated
 * file exists yet (decision 0028). Kept at the old value so the WAV files already cached
 * under it keep serving those rare misses.
 */
export const TTS_ONDEMAND_CACHE_VERSION = 'tts-v2';

/** Public Storage bucket of the shared audio. */
export const TTS_BUCKET = 'tts';

/** Longest headword (lexicon_terms.lemma_norm); only texts up to this long can be one. */
export const TTS_HEADWORD_MAX_CHARS = 120;

/**
 * The settings screen's "Listen" sample. Always allowed (it is on no card) and cached for
 * everyone. The client sends exactly this text.
 */
export const TTS_SAMPLE_TEXT = 'Hello! This is how new words will sound.';

/** NFC, trimmed, every run of whitespace folded to one space. Both sides use it. */
export function normalizeTtsText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** The string whose SHA-256 (hex) names the cached audio: version, voice and text. */
export function ttsKeyMaterial(
  voice: TtsVoice,
  text: string,
  version: string = TTS_CACHE_VERSION,
): string {
  return `${version}\n${voice}\n${normalizeTtsText(text)}`;
}

/** Lower-case hex SHA-256 of a UTF-8 string (Web Crypto: browsers, Deno and Node). */
export async function ttsSha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Object path of the pre-generated MP3 of a voice + text in the `tts` bucket. */
export async function ttsObjectPath(voice: TtsVoice, text: string): Promise<string> {
  return `${voice}/${await ttsSha256Hex(ttsKeyMaterial(voice, text))}.mp3`;
}

/** Object path of the on-demand (Gemini) WAV of a voice + text in the `tts` bucket. */
export async function ttsOnDemandObjectPath(voice: TtsVoice, text: string): Promise<string> {
  return `${voice}/${await ttsSha256Hex(ttsKeyMaterial(voice, text, TTS_ONDEMAND_CACHE_VERSION))}.wav`;
}

/**
 * The texts whose pre-generated file may hold this text's audio, best first: the text itself,
 * then its lower-case form when it could be a headword. A headword is public in any casing
 * (tts_text_source compares lemma_norm with lower(text)), and the pre-generation makes its
 * display spelling and its lower-case form, so "Monday", "monday" and "MONDAY" all find one.
 */
export function ttsTextCandidates(text: string): string[] {
  const t = normalizeTtsText(text);
  if (!t) return [];
  const lower = t.toLowerCase();
  return lower !== t && t.length <= TTS_HEADWORD_MAX_CHARS ? [t, lower] : [t];
}

/** Public URL of an object in the `tts` bucket (anyone may fetch it by name). */
export function ttsPublicUrl(supabaseUrl: string, path: string): string {
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${TTS_BUCKET}/${path}`;
}

function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

export const ttsRequest = z.object({
  text: z
    .string()
    .transform(normalizeTtsText)
    .pipe(
      z
        .string()
        .min(1)
        .max(TTS_MAX_CHARS)
        // English text to read: at least one Latin letter, no control characters.
        .regex(/[A-Za-z]/, 'no English letters')
        .refine((s) => !hasControlChars(s), 'control characters'),
    ),
  voice: z.enum(TTS_VOICES),
});
export type TtsRequest = z.input<typeof ttsRequest>;

/**
 * Either a URL of shared, cached audio (public dictionary words and sentences), or the audio
 * itself (base64 WAV) for text that is only on this user's own cards, which is never stored
 * on the server.
 */
export const ttsResponse = z.union([
  z.object({
    url: z.string().url(),
    cached: z.boolean(),
  }),
  z.object({
    audio_b64: z.string().min(1),
    mime: z.literal('audio/wav'),
  }),
]);
export type TtsResponse = z.infer<typeof ttsResponse>;
