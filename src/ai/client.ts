// Typed client for the ai-extract and ai-enrich edge functions. Every response is
// validated with the same zod schemas the server uses. AI needs a signed-in account;
// guests get AiClientError('not_signed_in') without a network call.

import {
  enrichRequest,
  enrichResponse,
  errorBody,
  EXTRACT_PROMPT_VERSION,
  extractRequest,
  extractResponse,
  type EnrichRequest,
  type EnrichResponse,
  type ErrorCode,
  type ExtractCandidate,
  type ExtractResponse,
  type LexiconEntry,
} from '../../supabase/functions/_shared/contracts';
import { hashChunk } from '@/domain/chunking';
import type { CefrLevel, ImportCandidate, LexiconSense } from '@/domain/types';
import { backendConfig, getAccessToken } from '@/lib/supabase';

export type { EnrichResponse, ExtractCandidate, ExtractResponse, LexiconEntry };
/** Prompt version the deployed ai-extract is expected to answer with (local chunk cache key). */
export { EXTRACT_PROMPT_VERSION };

export type AiClientErrorCode =
  | ErrorCode // from the server: daily_limit, quota_exceeded, ai_failed, ...
  | 'not_configured' // no Supabase env (guest-only build)
  | 'not_signed_in'
  | 'offline' // network failure; retry later (the import job stays queued)
  | 'bad_response'; // the server answered something that is not the contract

export class AiClientError extends Error {
  readonly code: AiClientErrorCode;
  readonly status: number | null;
  readonly retryAfterS: number | null;
  constructor(
    code: AiClientErrorCode,
    message: string,
    status: number | null = null,
    retryAfterS: number | null = null,
  ) {
    super(message);
    this.name = 'AiClientError';
    this.code = code;
    this.status = status;
    this.retryAfterS = retryAfterS;
  }
  /** Worth retrying later without user action. */
  get transient(): boolean {
    return (
      this.code === 'offline' ||
      this.code === 'quota_exceeded' ||
      this.code === 'ai_failed' ||
      this.code === 'internal'
    );
  }
}

export interface AiClientDeps {
  fetch?: typeof fetch;
  getAccessToken?: () => Promise<string | null>;
  config?: { url: string; key: string } | null;
  timeoutMs?: number; // default 150 s (server retries + fallback model fit inside)
}

/** POST to an AI edge function with the session token; `parse` validates the answer. */
export async function call<T>(
  fn: 'ai-extract' | 'ai-enrich' | 'ai-examples',
  body: unknown,
  parse: (x: unknown) => T,
  deps: AiClientDeps,
): Promise<T> {
  const config = deps.config === undefined ? backendConfig : deps.config;
  if (!config) throw new AiClientError('not_configured', 'Supabase is not configured');
  const token = await (deps.getAccessToken ?? getAccessToken)();
  if (!token) throw new AiClientError('not_signed_in', 'Sign in with Google to use AI');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? 150_000);
  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(`${config.url}/functions/v1/${fn}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        apikey: config.key,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new AiClientError('offline', e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new AiClientError(
      res.ok ? 'bad_response' : 'internal',
      `HTTP ${res.status} without JSON body`,
      res.status,
    );
  }
  if (!res.ok) {
    const err = errorBody.safeParse(json);
    if (err.success) {
      const retry =
        err.data.error.retry_after_s ?? (Number(res.headers.get('retry-after')) || null);
      throw new AiClientError(err.data.error.code, err.data.error.message, res.status, retry);
    }
    // e.g. the gateway's own 401 / 5xx
    throw new AiClientError(
      res.status === 401 ? 'unauthorized' : 'internal',
      `HTTP ${res.status}`,
      res.status,
    );
  }
  try {
    return parse(json);
  } catch (e) {
    throw new AiClientError(
      'bad_response',
      e instanceof Error ? e.message : 'invalid response',
      res.status,
    );
  }
}

/**
 * Extracts candidates from one chunk (≤ ~6000 chars, whole sentences). The text is sent
 * NFC-normalised together with hashChunk(text), the same key as the local chunk_cache.
 */
export async function extractChunk(
  input: { text: string; level?: CefrLevel },
  deps: AiClientDeps = {},
): Promise<ExtractResponse & { chunk_hash: string }> {
  const text = input.text.normalize('NFC');
  const chunk_hash = await hashChunk(text);
  const body = extractRequest.parse({ text, chunk_hash, level: input.level ?? 'B1' });
  const res = await call('ai-extract', body, (x) => extractResponse.parse(x), deps);
  return { ...res, chunk_hash };
}

/**
 * Senses for a term typed by the user. Lexicon first: the model is called only when the
 * lexicon has nothing, or with `more: true` ("Başka anlam ara").
 */
export async function enrichTerm(
  input: EnrichRequest,
  deps: AiClientDeps = {},
): Promise<EnrichResponse> {
  const body = enrichRequest.parse(input);
  return call('ai-enrich', body, (x) => enrichResponse.parse(x), deps);
}

/** A lexicon entry as stored in Dexie's lexicon_cache. */
export function toLexiconCacheRow(e: LexiconEntry): LexiconSense {
  return { ...e };
}

/** Fields of an ImportCandidate (preview row) from an extract candidate. */
export function toCandidateFields(
  c: ExtractCandidate,
): Omit<ImportCandidate, 'id' | 'job_id' | 'selected' | 'user_status' | 'meaning_tr_edit'> {
  return {
    term: c.term,
    surface: c.surface,
    term_type: c.term_type,
    lexicon_sense_id: c.lexicon.id,
    match: c.match,
    pos: c.lexicon.pos,
    gloss_en: c.lexicon.gloss_en,
    meaning_tr: c.lexicon.meaning_tr,
    ipa: c.lexicon.ipa,
    source_sentence: c.source_sentence,
    source_sentence_tr: c.sentence_tr,
    span: c.span,
    confidence: c.confidence,
  };
}
