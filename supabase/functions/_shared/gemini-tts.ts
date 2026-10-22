// Gemini text-to-speech for the tts function (docs/decisions/0028-server-tts.md).
//
// REST generateContent (v1beta) with responseModalities ["AUDIO"] and a prebuilt voice. The
// answer is one inlineData part: a WAV file (3.8 TTS models) or raw 16-bit PCM at 24 kHz
// (older models); toWav() turns either into a WAV. Short timeouts and few attempts: a person
// is waiting with their finger on the speaker button, and the browser voice is the fallback.
// Model names come only from configuration (GEMINI_TTS_MODEL / GEMINI_TTS_FALLBACK_MODEL).

import { AiError, classifyHttpError } from './ai-provider.ts';
import type { TtsVoice } from './tts-contract.ts';
import { base64ToBytes, toWav } from './wav.ts';

export interface SpeechResult {
  /** A complete WAV file. */
  wav: Uint8Array;
  model: string;
}

export interface SpeechSynth {
  synthesize(text: string, voice: TtsVoice): Promise<SpeechResult>;
}

export interface GeminiTtsConfig {
  apiKey: string;
  model: string;
  fallbackModel?: string | null;
  voices: Record<TtsVoice, string>;
  timeoutMs?: number; // per attempt, default 20 000
  maxAttempts?: number; // per model, default 2
  apiBase?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

// Defaults used only when the environment does not set them (Oct 2026: both models are on
// the free tier and have their own quota, separate from the text models').
export const DEFAULT_GEMINI_TTS_MODEL = 'gemini-3.8-flash-tts';
export const DEFAULT_GEMINI_TTS_FALLBACK_MODEL = 'gemini-3.8-flash-lite-tts';
/** Prebuilt voices ("Clear" in Google's voice list). The accent comes from the prompt. */
export const DEFAULT_TTS_VOICES: Record<TtsVoice, string> = {
  'en-US': 'Iapetus',
  'en-GB': 'Erinome',
};

const ACCENT: Record<TtsVoice, string> = {
  'en-US': 'a natural American English accent',
  'en-GB': 'a natural British English accent',
};

/**
 * The spoken text with a short, neutral direction. TTS models read everything after the colon
 * and treat the part before it as a style instruction.
 */
export function ttsPrompt(text: string, voice: TtsVoice): string {
  return `Say clearly, in ${ACCENT[voice]}: ${text}`;
}

interface InlineData {
  mimeType?: string;
  data?: string;
}
interface TtsResponseBody {
  candidates?: { content?: { parts?: { inlineData?: InlineData }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

export function createGeminiTts(cfg: GeminiTtsConfig): SpeechSynth {
  const doFetch = cfg.fetch ?? fetch;
  const sleep = cfg.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = cfg.timeoutMs ?? 20_000;
  const maxAttempts = cfg.maxAttempts ?? 2;
  const apiBase = (cfg.apiBase ?? 'https://generativelanguage.googleapis.com/v1beta').replace(
    /\/$/,
    '',
  );
  const models = [cfg.model, cfg.fallbackModel].filter(
    (m, i, a): m is string => !!m && a.indexOf(m) === i,
  );

  async function once(model: string, text: string, voice: TtsVoice) {
    const body = {
      contents: [{ role: 'user', parts: [{ text: ttsPrompt(text, voice) }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: cfg.voices[voice] } } },
      },
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await doFetch(`${apiBase}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const raw = await res.text();
      if (!res.ok)
        return { fail: classifyHttpError(res.status, raw, res.headers.get('retry-after')) };
      let parsed: TtsResponseBody;
      try {
        parsed = JSON.parse(raw) as TtsResponseBody;
      } catch {
        return { fail: { kind: 'retry' as const, quota: false, message: 'non-JSON envelope' } };
      }
      if (parsed.promptFeedback?.blockReason) {
        return {
          fail: {
            kind: 'fatal' as const,
            message: `blocked: ${parsed.promptFeedback.blockReason}`,
          },
        };
      }
      const cand = parsed.candidates?.[0];
      const inline = cand?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
      if (!inline?.data) {
        return {
          fail: {
            kind: 'retry' as const,
            quota: false,
            message: `no audio (finishReason ${cand?.finishReason ?? 'none'})`,
          },
        };
      }
      const bytes = base64ToBytes(inline.data);
      if (bytes.length < 64) {
        return { fail: { kind: 'retry' as const, quota: false, message: 'audio too short' } };
      }
      return { ok: { wav: toWav(bytes, inline.mimeType), model } };
    } catch (e) {
      const aborted = ctrl.signal.aborted || (e instanceof Error && e.name === 'AbortError');
      return {
        fail: {
          kind: 'retry' as const,
          quota: false,
          message: aborted ? `timeout after ${timeoutMs} ms` : `network error: ${String(e)}`,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async synthesize(text, voice) {
      let lastQuota = false;
      let lastMessage = 'no TTS model configured';
      let retryAfterMs: number | undefined;
      for (const model of models) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const r = await once(model, text, voice);
          if ('ok' in r && r.ok) return r.ok;
          const f = r.fail!;
          lastMessage = `${model}: ${f.message}`;
          if (f.kind === 'fatal') throw new AiError('ai_failed', lastMessage);
          if (f.kind === 'next_model') {
            lastQuota = false;
            break;
          }
          lastQuota = f.quota;
          retryAfterMs = f.retryAfterMs;
          // Quota errors go straight to the fallback model: waiting would keep the user waiting.
          if (f.quota) break;
          if (attempt < maxAttempts) await sleep(500 + Math.floor(Math.random() * 250));
        }
      }
      if (lastQuota) {
        throw new AiError(
          'quota_exceeded',
          lastMessage,
          retryAfterMs ? Math.ceil(retryAfterMs / 1000) : 60,
        );
      }
      throw new AiError('ai_failed', lastMessage);
    },
  };
}

type Env = (key: string) => string | undefined;

/** Builds the TTS synthesizer from env: GEMINI_API_KEY, GEMINI_TTS_MODEL, GEMINI_TTS_FALLBACK_MODEL, GEMINI_TTS_VOICE_US / _GB. */
export function createTtsFromEnv(env: Env, overrides: Partial<GeminiTtsConfig> = {}): SpeechSynth {
  const apiKey = env('GEMINI_API_KEY');
  if (!apiKey) throw new AiError('ai_failed', 'GEMINI_API_KEY is not set');
  const fallback = env('GEMINI_TTS_FALLBACK_MODEL');
  return createGeminiTts({
    apiKey,
    model: env('GEMINI_TTS_MODEL') || DEFAULT_GEMINI_TTS_MODEL,
    fallbackModel: fallback === undefined ? DEFAULT_GEMINI_TTS_FALLBACK_MODEL : fallback || null,
    voices: {
      'en-US': env('GEMINI_TTS_VOICE_US') || DEFAULT_TTS_VOICES['en-US'],
      'en-GB': env('GEMINI_TTS_VOICE_GB') || DEFAULT_TTS_VOICES['en-GB'],
    },
    ...(env('GEMINI_API_BASE') ? { apiBase: env('GEMINI_API_BASE') } : {}),
    ...overrides,
  });
}
