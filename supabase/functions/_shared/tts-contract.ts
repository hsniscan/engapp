// Request/response contract of the `tts` edge function (server pronunciation audio,
// docs/decisions/0028-server-tts.md). Imported by the function (Deno) and by the web client
// (src/ai/tts.ts). Kept apart from contracts.ts so it can change on its own.

import { z } from 'zod';

/** Longest text the server reads aloud (characters, after normalizeTtsText). */
export const TTS_MAX_CHARS = 300;

export const TTS_VOICES = ['en-US', 'en-GB'] as const;
export type TtsVoice = (typeof TTS_VOICES)[number];

/**
 * Bump when the prompt, the voices or the audio format change: it is part of the cache key,
 * so old audio is simply no longer used (and new audio is generated on the next request).
 */
export const TTS_CACHE_VERSION = 'tts-v1';

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
export function ttsKeyMaterial(voice: TtsVoice, text: string): string {
  return `${TTS_CACHE_VERSION}\n${voice}\n${normalizeTtsText(text)}`;
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
