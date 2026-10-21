// Request/response contracts of the AI edge functions. Imported by the functions (Deno)
// and by the web client (src/ai/), so both sides validate against the same schemas.

import { z } from 'zod';

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export const cefrLevel = z.enum(CEFR_LEVELS);

export const termType = z.enum(['word', 'phrase', 'pattern']);

/** Max characters of one chunk. The client aims for ~6000 and never splits a sentence. */
export const MAX_CHUNK_CHARS = 8000;
export const MAX_CANDIDATES = 30;

export const ERROR_CODES = [
  'unauthorized', // no/invalid/expired session, or an anonymous session
  'invalid_input', // request body failed validation (incl. chunk_hash mismatch)
  'daily_limit', // the user's daily AI call budget is used up (AI_DAILY_LIMIT)
  'quota_exceeded', // the AI provider's quota/rate limit (after retries and fallback model)
  'ai_failed', // the provider failed or kept returning unusable output
  'method_not_allowed',
  'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorBody = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    retry_after_s: z.number().optional(),
  }),
});
export type ErrorBody = z.infer<typeof errorBody>;

/** Shape of src/domain/types.ts LexiconSense (updated_at in epoch ms). */
export const lexiconEntry = z.object({
  id: z.string(),
  term_id: z.string(),
  lemma: z.string(),
  lemma_norm: z.string(),
  term_type: termType,
  pos: z.string(),
  gloss_en: z.string(),
  meaning_tr: z.string(),
  ipa: z.string().nullable(),
  updated_at: z.number(),
});
export type LexiconEntry = z.infer<typeof lexiconEntry>;

// ---------------------------------------------------------------------------
// ai-extract
// ---------------------------------------------------------------------------

export const extractRequest = z.object({
  text: z.string().min(1).max(MAX_CHUNK_CHARS),
  /** lower-case hex SHA-256 of `text` encoded as UTF-8 (verified by the server) */
  chunk_hash: z.string().regex(/^[0-9a-f]{64}$/),
  level: cefrLevel.default('B1'),
});
export type ExtractRequest = z.input<typeof extractRequest>;

export const candidateMatch = z.enum(['known_sense', 'new_sense', 'new_term']);

export const extractCandidate = z.object({
  term: z.string(), // dictionary form (= lexicon.lemma)
  surface: z.string(), // as written in source_sentence
  term_type: termType,
  source_sentence: z.string(), // verbatim from the chunk
  /** Turkish translation of source_sentence; per user, never stored in the lexicon. Absent (null) in extract-v1 results. */
  sentence_tr: z.string().nullable().default(null),
  span: z.tuple([z.number().int(), z.number().int()]), // [start, end) of surface in source_sentence
  confidence: z.number().min(0).max(1),
  /** relation to the shared lexicon before this request */
  match: candidateMatch,
  /** true when no lexicon content was generated for this candidate in this request */
  lexicon_hit: z.boolean(),
  lexicon: lexiconEntry,
});
export type ExtractCandidate = z.infer<typeof extractCandidate>;

export const usageInfo = z.object({ used: z.number(), limit: z.number() });

export const extractResponse = z.object({
  prompt_version: z.string(),
  cache_hit: z.boolean(), // served from the server chunk cache (no AI call)
  ai_called: z.boolean(),
  model: z.string().nullable(),
  candidates: z.array(extractCandidate).max(MAX_CANDIDATES),
  counts: z.object({
    candidates: z.number(),
    known_sense: z.number(),
    new_sense: z.number(),
    new_term: z.number(),
    lexicon_hits: z.number(),
    /** candidates the server discarded, by reason */
    dropped: z.record(z.string(), z.number()),
  }),
  usage: usageInfo.nullable(), // today's AI calls after this request (null on cache hit)
});
export type ExtractResponse = z.infer<typeof extractResponse>;

// ---------------------------------------------------------------------------
// ai-enrich
// ---------------------------------------------------------------------------

export const enrichRequest = z.object({
  term: z.string().trim().min(1).max(80),
  /** optional sentence the term came from; sent to the model only, never stored */
  sentence: z.string().max(600).optional(),
  /** "Başka anlam ara": ask the model for senses not yet in the lexicon */
  more: z.boolean().default(false),
  level: cefrLevel.default('B1'),
});
export type EnrichRequest = z.input<typeof enrichRequest>;

export const enrichResponse = z.object({
  prompt_version: z.string(),
  ai_called: z.boolean(),
  model: z.string().nullable(),
  /** null when the term is unknown and the model said it is not an English term */
  term: z
    .object({ id: z.string(), lemma: z.string(), lemma_norm: z.string(), term_type: termType })
    .nullable(),
  /** existing senses first (lexicon order), then the newly added ones */
  senses: z.array(lexiconEntry),
  new_sense_ids: z.array(z.string()),
  /** sense used in `sentence`, when a sentence was given and the model could tell */
  suggested_sense_id: z.string().nullable(),
  usage: usageInfo.nullable(),
});
export type EnrichResponse = z.infer<typeof enrichResponse>;
