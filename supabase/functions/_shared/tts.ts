// The tts pipeline (docs/decisions/0028-server-tts.md): validate, check that the text is one
// the user can have on a card, serve shared audio from the Storage cache, and only call the
// model on a miss (counted against the user's daily TTS budget). Environment-neutral: the
// store and the synthesizer are passed in.

import { AiError } from './ai-provider.ts';
import { ApiError } from './errors.ts';
import type { SpeechSynth } from './gemini-tts.ts';
import {
  TTS_SAMPLE_TEXT,
  ttsKeyMaterial,
  ttsRequest,
  type TtsResponse,
  type TtsVoice,
} from './tts-contract.ts';
import { bytesToBase64 } from './wav.ts';

/**
 * Where the text comes from. 'public': the shared dictionary (a lexicon headword or example
 * sentence), so its audio may be cached for everyone. 'private': only this user's own cards
 * (their word, their source sentence, their edited example); never stored on the server.
 */
export type TtsTextSource = 'public' | 'private';

export interface TtsStore {
  textSource(userId: string, text: string): Promise<TtsTextSource | null>;
  /** Atomically takes one generation from today's budget. */
  consume(
    userId: string,
    limit: number,
  ): Promise<{ allowed: boolean; used: number; limit: number }>;
  exists(path: string): Promise<boolean>;
  /** Stores the WAV; false when it could not be stored (the audio is then sent inline). */
  upload(path: string, wav: Uint8Array): Promise<boolean>;
  publicUrl(path: string): string;
}

export interface TtsDeps {
  userId: string;
  store: TtsStore;
  synth: () => SpeechSynth;
  dailyLimit: number;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

export const DEFAULT_TTS_DAILY_LIMIT = 150;

export function ttsDailyLimit(env: (k: string) => string | undefined): number {
  const n = Number(env('TTS_DAILY_LIMIT'));
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_TTS_DAILY_LIMIT;
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Object path of a voice + text in the `tts` bucket. */
export async function ttsObjectPath(voice: TtsVoice, text: string): Promise<string> {
  return `${voice}/${await sha256Hex(ttsKeyMaterial(voice, text))}.wav`;
}

export async function runTts(body: unknown, deps: TtsDeps): Promise<TtsResponse> {
  const parsed = ttsRequest.safeParse(body);
  if (!parsed.success) throw new ApiError('invalid_input', 'Invalid tts request');
  const { text, voice } = parsed.data;

  const source: TtsTextSource | null =
    text === TTS_SAMPLE_TEXT ? 'public' : await deps.store.textSource(deps.userId, text);
  if (!source) throw new ApiError('invalid_input', 'Text is not on any of your cards');

  const path = source === 'public' ? await ttsObjectPath(voice, text) : null;
  if (path && (await deps.store.exists(path))) {
    deps.log?.('tts cache hit', { voice, chars: text.length });
    return { url: deps.store.publicUrl(path), cached: true };
  }

  const usage = await deps.store.consume(deps.userId, deps.dailyLimit);
  if (!usage.allowed) {
    throw new ApiError('daily_limit', `Daily pronunciation limit reached (${usage.limit})`);
  }

  let wav: Uint8Array;
  let model: string;
  try {
    ({ wav, model } = await deps.synth().synthesize(text, voice));
  } catch (e) {
    if (e instanceof AiError) throw new ApiError(e.code, e.message, e.retryAfterS);
    throw e;
  }
  deps.log?.('tts generated', { voice, source, chars: text.length, bytes: wav.length, model });

  if (path && (await deps.store.upload(path, wav))) {
    return { url: deps.store.publicUrl(path), cached: false };
  }
  return { audio_b64: bytesToBase64(wav), mime: 'audio/wav' };
}
