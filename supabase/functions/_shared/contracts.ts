// Request/response contracts of the AI edge functions. Imported by the functions (Deno)
// and by the web client (src/ai/), so both sides validate against the same schemas.

import { z } from 'zod';
import { CEFR, LEVEL_SOURCES } from './cefr.ts';

export const CEFR_LEVELS = CEFR;
export const cefrLevel = z.enum(CEFR_LEVELS);

export const termType = z.enum(['word', 'phrase', 'pattern']);

/** Max characters of one chunk. The client aims for ~6000 and never splits a sentence. */
export const MAX_CHUNK_CHARS = 8000;
/**
 * Candidates per chunk. A vocabulary list returns every entry (a 6000-char chunk of a
 * numbered word list holds ~100); ordinary prose is asked for at most MAX_PROSE_CANDIDATES.
 */
export const MAX_CANDIDATES = 150;
export const MAX_PROSE_CANDIDATES = 30;

/**
 * Version of the extract prompt and response schema; it keys the server chunk cache and
 * the client's local chunk cache. Bump it with every prompt or schema change (prompts.ts).
 */
export const EXTRACT_PROMPT_VERSION = 'extract-v5';

export const ERROR_CODES = [
  'unauthorized', // no/invalid/expired session, or an anonymous session
  'invalid_input', // request body failed validation (incl. chunk_hash mismatch)
  'daily_limit', // the user's daily AI call budget is used up (AI_DAILY_LIMIT)
  'quota_exceeded', // the AI provider's quota/rate limit (after retries and fallback model)
  'ai_failed', // the provider failed or kept returning unusable output
  'method_not_allowed',
  'internal',
  // fetch-article (v0.5 İP2, decision 0044)
  'blocked_url', // not http(s) on a default port, or the host is not a public address (SSRF)
  'robots_disallowed', // the site's robots.txt does not allow EngappReader
  'not_html', // the address is not a web page (PDF, image, JSON, ...)
  'too_large', // the page is over 2 MB
  'fetch_failed', // the site did not answer in time, refused, or redirected too often
  'paywalled', // the page says it is for subscribers only; no attempt is made to get around it
  'extract_failed', // no readable article text on the page
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

/**
 * A field added after v0.1: absent (older server or cached row) or unexpected (a newer
 * server) becomes null instead of failing the whole lexicon page.
 */
const lenient = <T extends z.ZodType>(t: T) => t.nullable().default(null).catch(null);

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
  // v0.2 İP2: level of the sense (supabase/functions/_shared/level.ts) and the term's Zipf.
  cefr: lenient(cefrLevel),
  cefr_source: lenient(z.enum(LEVEL_SOURCES)),
  /** List level before the Turkish-learner correction (list sources only). */
  cefr_list: lenient(cefrLevel),
  /** Short Turkish reason of the correction ("Türkçede 'televizyon'"). */
  cefr_reason_tr: lenient(z.string().max(120)),
  zipf: lenient(z.number().min(0).max(9)),
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

/**
 * extract-v5: a Turkish word that looks or sounds like the term but means something else
 * ("actually" ~ "aktüel"), written by the model for a new sense, checked by the server and
 * stored in the shared lexicon_pair_notes (kind 'false_friend'). Same content as the
 * hand-written list (src/domain/pairNotes.ts FalseFriendContent).
 */
export const aiFalseFriend = z.object({
  /** lexicon_pair_notes.id */
  id: z.string(),
  tr_word: z.string(),
  /** What the English term means, in Turkish (the sense's meaning_tr). */
  en_meaning_tr: z.string(),
  /** What the Turkish word means. */
  tr_meaning_tr: z.string(),
  tr_meaning_en: z.string().nullable(),
  strength: z.enum(['full', 'partial']),
  note_tr: z.string().nullable(),
});
export type AiFalseFriend = z.infer<typeof aiFalseFriend>;

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
  /** extract-v5: an AI false-friend warning stored for this sense; null when none (and before v5). */
  false_friend: aiFalseFriend.nullable().default(null).catch(null),
});
export type ExtractCandidate = z.infer<typeof extractCandidate>;

export const usageInfo = z.object({ used: z.number(), limit: z.number() });

export const extractResponse = z.object({
  prompt_version: z.string(),
  cache_hit: z.boolean(), // served from the server chunk cache (no AI call)
  ai_called: z.boolean(),
  model: z.string().nullable(),
  /**
   * extract-v5: 1–2 topic keys of the chunk (_shared/topics-contract.ts); the device
   * aggregates a text's chunks into sources.topics. Empty before v5 or when unclear.
   */
  topics: z.array(z.string()).max(4).default([]).catch([]),
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
