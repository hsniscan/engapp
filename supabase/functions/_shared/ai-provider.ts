// AI provider adapter. The pipeline only sees AiProvider; swapping Gemini for another
// provider means adding a factory here and setting AI_PROVIDER. Only 'gemini' exists.
//
// Gemini: REST generateContent (v1beta) with structured output
// (responseMimeType application/json + responseJsonSchema), temperature 0.2,
// 30 s timeout per attempt, up to 3 attempts per model with exponential backoff on
// 429/503/5xx/timeouts, then the same on GEMINI_FALLBACK_MODEL. Model names come only
// from configuration.

export type AiErrorCode = 'quota_exceeded' | 'ai_failed';

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly retryAfterS?: number;
  constructor(code: AiErrorCode, message: string, retryAfterS?: number) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.retryAfterS = retryAfterS;
  }
}

export interface GenerateJsonRequest {
  system: string;
  user: string;
  /** JSON Schema (subset supported by the provider) */
  schema: Record<string, unknown>;
  /** Return null if the parsed JSON is acceptable, else a reason; a reason triggers a retry. */
  validate?: (data: unknown) => string | null;
  maxOutputTokens?: number;
}

export interface GenerateJsonResult {
  data: unknown;
  model: string;
  attempts: number;
  usage: { input_tokens: number; output_tokens: number; thinking_tokens: number } | null;
}

export interface AiProvider {
  readonly name: string;
  generateJson(req: GenerateJsonRequest): Promise<GenerateJsonResult>;
}

export interface GeminiConfig {
  apiKey: string;
  model: string;
  fallbackModel?: string | null;
  temperature?: number; // default 0.2
  timeoutMs?: number; // per attempt, default 30 000
  maxAttempts?: number; // per model, default 3
  baseDelayMs?: number; // backoff base, default 1000 (1 s, 2 s, ...)
  maxDelayMs?: number; // cap for one wait, default 8000
  totalBudgetMs?: number; // stop starting new attempts after this, default 120 000
  thinkingLevel?: string | null; // optional generationConfig.thinkingConfig.thinkingLevel
  apiBase?: string; // default https://generativelanguage.googleapis.com/v1beta
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

type Failure =
  | { kind: 'retry'; quota: boolean; message: string; retryAfterMs?: number } // transient
  | { kind: 'next_model'; message: string } // this model cannot serve (404 / unknown)
  | { kind: 'fatal'; message: string }; // config or request error: stop

interface GeminiPart {
  text?: string;
  thought?: boolean;
}
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  modelVersion?: string;
}

export function createGeminiProvider(cfg: GeminiConfig): AiProvider {
  const doFetch = cfg.fetch ?? fetch;
  const sleep = cfg.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = cfg.now ?? (() => Date.now());
  const temperature = cfg.temperature ?? 0.2;
  const timeoutMs = cfg.timeoutMs ?? 30_000;
  const maxAttempts = cfg.maxAttempts ?? 3;
  const baseDelayMs = cfg.baseDelayMs ?? 1000;
  const maxDelayMs = cfg.maxDelayMs ?? 8000;
  const totalBudgetMs = cfg.totalBudgetMs ?? 120_000;
  const apiBase = (cfg.apiBase ?? 'https://generativelanguage.googleapis.com/v1beta').replace(
    /\/$/,
    '',
  );
  const models = [cfg.model, cfg.fallbackModel].filter(
    (m, i, a): m is string => !!m && a.indexOf(m) === i,
  );

  async function callOnce(
    model: string,
    req: GenerateJsonRequest,
  ): Promise<{ ok: GenerateJsonResult } | { fail: Failure }> {
    const generationConfig: Record<string, unknown> = {
      temperature,
      responseMimeType: 'application/json',
      responseJsonSchema: req.schema,
      maxOutputTokens: req.maxOutputTokens ?? 8192,
    };
    if (cfg.thinkingLevel) generationConfig.thinkingConfig = { thinkingLevel: cfg.thinkingLevel };
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.user }] }],
      generationConfig,
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(`${apiBase}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const aborted = ctrl.signal.aborted || (e instanceof Error && e.name === 'AbortError');
      return {
        fail: {
          kind: 'retry',
          quota: false,
          message: aborted ? `timeout after ${timeoutMs} ms` : `network error: ${String(e)}`,
        },
      };
    }

    let raw: string;
    try {
      raw = await res.text();
    } catch (e) {
      clearTimeout(timer);
      return { fail: { kind: 'retry', quota: false, message: `read error: ${String(e)}` } };
    }
    clearTimeout(timer);

    if (!res.ok)
      return { fail: classifyHttpError(res.status, raw, res.headers.get('retry-after')) };

    let parsed: GeminiResponse;
    try {
      parsed = JSON.parse(raw) as GeminiResponse;
    } catch {
      return {
        fail: { kind: 'retry', quota: false, message: 'provider returned non-JSON envelope' },
      };
    }
    if (parsed.promptFeedback?.blockReason) {
      return {
        fail: { kind: 'fatal', message: `prompt blocked: ${parsed.promptFeedback.blockReason}` },
      };
    }
    const cand = parsed.candidates?.[0];
    const text = (cand?.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === 'string')
      .map((p) => p.text)
      .join('');
    if (!text) {
      return {
        fail: {
          kind: 'retry',
          quota: false,
          message: `empty response (finishReason ${cand?.finishReason ?? 'none'})`,
        },
      };
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return {
        fail: {
          kind: 'retry',
          quota: false,
          message: `response is not valid JSON (finishReason ${cand?.finishReason ?? 'none'})`,
        },
      };
    }
    const problem = req.validate?.(data) ?? null;
    if (problem)
      return { fail: { kind: 'retry', quota: false, message: `schema mismatch: ${problem}` } };

    const u = parsed.usageMetadata;
    return {
      ok: {
        data,
        model,
        attempts: 0,
        usage: u
          ? {
              input_tokens: u.promptTokenCount ?? 0,
              output_tokens: u.candidatesTokenCount ?? 0,
              thinking_tokens: u.thoughtsTokenCount ?? 0,
            }
          : null,
      },
    };
  }

  return {
    name: 'gemini',
    async generateJson(req) {
      const started = now();
      let attempts = 0;
      let lastQuota = false;
      let lastMessage = 'no model configured';
      let lastRetryAfterMs: number | undefined;

      for (const model of models) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          if (now() - started > totalBudgetMs) break;
          attempts++;
          const r = await callOnce(model, req);
          if ('ok' in r) return { ...r.ok, attempts };
          const f = r.fail;
          lastMessage = `${model}: ${f.message}`;
          if (f.kind === 'fatal') throw new AiError('ai_failed', lastMessage);
          if (f.kind === 'next_model') {
            lastQuota = false;
            break;
          }
          lastQuota = f.quota;
          lastRetryAfterMs = f.retryAfterMs;
          if (attempt < maxAttempts) {
            const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
            const wait = Math.min(maxDelayMs, Math.max(backoff, f.retryAfterMs ?? 0));
            if (now() - started + wait > totalBudgetMs) break;
            await sleep(wait + Math.floor(Math.random() * 250));
          }
        }
      }
      if (lastQuota) {
        throw new AiError(
          'quota_exceeded',
          lastMessage,
          lastRetryAfterMs ? Math.ceil(lastRetryAfterMs / 1000) : 60,
        );
      }
      throw new AiError('ai_failed', lastMessage);
    },
  };
}

export function classifyHttpError(
  status: number,
  body: string,
  retryAfterHeader?: string | null,
): Failure {
  let message = `HTTP ${status}`;
  let retryAfterMs: number | undefined;
  let apiStatus = '';
  try {
    const j = JSON.parse(body) as {
      error?: {
        message?: string;
        status?: string;
        details?: { '@type'?: string; retryDelay?: string }[];
      };
    };
    apiStatus = j.error?.status ?? '';
    if (j.error?.message) message = `HTTP ${status} ${apiStatus}: ${j.error.message.slice(0, 300)}`;
    const delay = j.error?.details?.find((d) => d['@type']?.endsWith('RetryInfo'))?.retryDelay;
    const m = delay?.match(/^([\d.]+)s$/);
    if (m) retryAfterMs = Math.round(Number(m[1]) * 1000);
  } catch {
    // non-JSON error body
  }
  if (retryAfterMs === undefined && retryAfterHeader && /^\d+$/.test(retryAfterHeader)) {
    retryAfterMs = Number(retryAfterHeader) * 1000;
  }
  if (status === 429 || apiStatus === 'RESOURCE_EXHAUSTED')
    return { kind: 'retry', quota: true, message, retryAfterMs };
  // 503 UNAVAILABLE ("model is overloaded / high demand") is treated like quota: retry,
  // then fall back to the other model.
  if (status === 503 || apiStatus === 'UNAVAILABLE')
    return { kind: 'retry', quota: true, message, retryAfterMs };
  if (status >= 500 || status === 408)
    return { kind: 'retry', quota: false, message, retryAfterMs };
  if (status === 404) return { kind: 'next_model', message };
  return { kind: 'fatal', message };
}

/** Builds the configured provider. env: AI_PROVIDER, GEMINI_API_KEY, GEMINI_MODEL, GEMINI_FALLBACK_MODEL, ... */
export function createAiProvider(
  env: (key: string) => string | undefined,
  overrides: Partial<GeminiConfig> = {},
): AiProvider {
  const provider = (env('AI_PROVIDER') ?? 'gemini').toLowerCase();
  if (provider !== 'gemini')
    throw new AiError('ai_failed', `AI_PROVIDER "${provider}" is not implemented`);
  const apiKey = env('GEMINI_API_KEY');
  if (!apiKey) throw new AiError('ai_failed', 'GEMINI_API_KEY is not set');
  const fallback = env('GEMINI_FALLBACK_MODEL');
  return createGeminiProvider({
    apiKey,
    model: env('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL,
    fallbackModel: fallback === undefined ? DEFAULT_GEMINI_FALLBACK_MODEL : fallback || null,
    thinkingLevel: env('GEMINI_THINKING_LEVEL') || null,
    // Local testing only (points at a fake server); unset in production.
    ...(env('GEMINI_API_BASE') ? { apiBase: env('GEMINI_API_BASE') } : {}),
    ...overrides,
  });
}

// Defaults used only when the environment does not set GEMINI_MODEL / GEMINI_FALLBACK_MODEL.
// (Set GEMINI_FALLBACK_MODEL to an empty string to disable the fallback.)
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const DEFAULT_GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash-lite';
