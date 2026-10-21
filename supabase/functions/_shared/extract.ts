// ai-extract pipeline: chunk cache -> lexicon pre-match -> daily limit -> model ->
// validation -> lexicon insert-or-get -> response. Environment-neutral (Deno + Node);
// all I/O goes through AiStore and AiProvider.

import {
  extractRequest,
  MAX_CANDIDATES,
  type ExtractCandidate,
  type ExtractResponse,
  type LexiconEntry,
} from './contracts.ts';
import { ApiError } from './errors.ts';
import { AiError, type AiProvider } from './ai-provider.ts';
import { findGappedSpan, findSentence, findSpan } from './locate.ts';
import {
  buildExtractUserPrompt,
  EXTRACT_PROMPT_VERSION,
  EXTRACT_RESPONSE_SCHEMA,
  EXTRACT_SYSTEM_PROMPT,
  extractModelCandidate,
  extractModelOutput,
  MAX_KNOWN_SENSES,
  type KnownSenseLine,
} from './prompts.ts';
import type { AiStore, LexiconUpsertItem, LexTerm } from './store.ts';
import {
  cleanLemma,
  glossKey,
  isCleanLexiconText,
  isNearDuplicateGloss,
  normalizeLemma,
  normalizePos,
  type Pos,
} from './text.ts';
import { FUNCTION_WORDS, lemmaForms, prematchForms, termForms, tokenize } from './tokenize.ts';

/** Two word forms that share a base form ("talked" ~ "talk"). */
function sameLemma(a: string, b: string): boolean {
  if (a === b) return true;
  const fb = new Set(lemmaForms(b));
  return lemmaForms(a).some((f) => fb.has(f));
}

/**
 * Does the dictionary form belong to the words found in the text? At least one content
 * word of the term (all words, for a term made only of function words) must share a base
 * form with a word of the surface. Stops a model (or an injected instruction in the text)
 * from attaching a sense of an unrelated term to any word of the chunk.
 */
export function termMatchesSurface(term: string, surface: string): boolean {
  const surf = tokenize(surface).map((t) => t.norm);
  if (surf.length === 0) return false;
  const words = tokenize(term).map((t) => t.norm);
  const content = words.filter((w) => !FUNCTION_WORDS.has(w) && !PLACEHOLDERS.has(w));
  const occurs = (w: string) => surf.some((s) => sameLemma(w, s));
  return content.length > 0 ? content.some(occurs) : words.length > 0 && words.every(occurs);
}

/** Pattern placeholders that never appear literally in the text. */
const PLACEHOLDERS = new Set([
  "one's",
  'oneself',
  'someone',
  "someone's",
  'somebody',
  "somebody's",
  'something',
  'sb',
  "sb's",
  'sth',
  'smb',
  'smth',
  'doing',
]);

export const MAX_SENTENCE_CHARS = 1000;
/**
 * Output budget of one extract call: a full vocabulary-list chunk (MAX_CANDIDATES items
 * of ~120 tokens) fits; prose answers are far shorter. A cut-off answer keeps its
 * complete items (ai-provider salvageTruncatedJson).
 */
export const EXTRACT_MAX_OUTPUT_TOKENS = 32_768;
/** Per-attempt timeout: a long list answer takes longer than the 30 s default. */
export const EXTRACT_TIMEOUT_MS = 60_000;
/** Turkish runs longer than English; well under the 2000 of senses.source_sentence_tr. */
export const MAX_SENTENCE_TR_CHARS = 1500;

export interface PipelineDeps {
  userId: string;
  store: AiStore;
  /** Created lazily: requests answered from cache/lexicon never need a provider. */
  provider: () => AiProvider;
  dailyLimit: number;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------------------
// Validation of the model output
// ---------------------------------------------------------------------------

export interface KnownRef {
  senseId: string;
  lemmaNorm: string;
}

export interface NewSense {
  pos: Pos;
  gloss_en: string;
  gloss_key: string;
  meaning_tr: string;
  ipa: string | null;
}

export interface ValidCandidate {
  term: string; // cleaned dictionary form
  lemma_norm: string;
  term_type: 'word' | 'phrase' | 'pattern';
  surface: string; // characters of the sentence at span
  source_sentence: string; // characters of the chunk
  sentence_tr: string | null; // the user's sentence in Turkish (never goes to the lexicon)
  span: [number, number];
  confidence: number;
  known: KnownRef | null;
  newSense: NewSense | null;
}

export type DropReason =
  | 'invalid_shape'
  | 'bad_term'
  | 'proper_noun'
  | 'sentence_not_in_text'
  | 'sentence_too_long'
  | 'surface_not_in_sentence'
  | 'unknown_sense_ref'
  | 'incomplete_new_sense'
  | 'duplicate'
  | 'over_limit'
  | 'term_not_in_text'
  | 'unsafe_text';

export interface ValidationResult {
  candidates: ValidCandidate[];
  dropped: Partial<Record<DropReason, number>>;
}

export function cleanGloss(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;]+$/, '')
    .trim();
}

/** Turkish meaning: trimmed, unquoted, at most two alternatives ("a, b"). */
export function cleanMeaningTr(s: string): string {
  const v = s
    .replace(/\s+/g, ' ')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .trim()
    .replace(/[.;]+$/, '')
    .trim();
  const alts = v
    .split(/\s*[,;/]\s*/)
    .map((a) => a.trim())
    .filter(Boolean);
  return [...new Set(alts)].slice(0, 2).join(', ');
}

/**
 * Turkish translation of the user's sentence: whitespace collapsed, invisible characters and
 * wrapping quotes removed. null when empty, too long, without letters or a mere copy of the
 * English sentence. A bad translation never drops the candidate.
 */
export function cleanSentenceTr(s: string | null | undefined, sentence: string): string | null {
  if (!s) return null;
  const v = s
    .replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["“”]+|["“”]+$/g, '')
    .trim();
  if (!v || v.length > MAX_SENTENCE_TR_CHARS || !/\p{L}/u.test(v)) return null;
  if (v.toLowerCase() === sentence.replace(/\s+/g, ' ').trim().toLowerCase()) return null;
  return v;
}

export function cleanIpa(s: string | null | undefined): string | null {
  if (!s) return null;
  let v = s.replace(/\s+/g, ' ').trim();
  if (!v) return null;
  v = v.replace(/^[/[]+|[/\]]+$/g, '');
  if (!v || v.length > 116) return null;
  return `/${v}/`;
}

function inferTermType(raw: string, term: string): 'word' | 'phrase' | 'pattern' {
  if (raw === 'word' || raw === 'phrase' || raw === 'pattern') {
    if (raw === 'word' && term.includes(' ')) return 'phrase';
    return raw;
  }
  return term.includes(' ') ? 'phrase' : 'word';
}

/**
 * Checks every candidate the model returned against the chunk. Never throws; invalid
 * candidates are dropped and counted by reason.
 */
export function validateExtractOutput(
  data: unknown,
  chunk: string,
  knownByRef: ReadonlyMap<string, KnownRef>,
  onDrop?: (reason: DropReason, term: string) => void,
): ValidationResult {
  const dropped: Partial<Record<DropReason, number>> = {};
  let current = '';
  const drop = (r: DropReason) => {
    dropped[r] = (dropped[r] ?? 0) + 1;
    onDrop?.(r, current);
  };
  const top = extractModelOutput.safeParse(data);
  if (!top.success) return { candidates: [], dropped: { invalid_shape: 1 } };

  const out: ValidCandidate[] = [];
  const seen = new Set<string>();

  for (const item of top.data.candidates) {
    const p = extractModelCandidate.safeParse(item);
    if (!p.success) {
      drop('invalid_shape');
      continue;
    }
    const c = p.data;
    current = `${c.term} [${c.surface}]`.slice(0, 120);

    const term = cleanLemma(c.term);
    const lemmaNorm = normalizeLemma(term);
    if (!term || term.length > 120 || term.split(' ').length > 8 || !/\p{L}/u.test(term)) {
      drop('bad_term');
      continue;
    }
    // Dictionary forms are lower-case; a capitalised one is a name, brand or acronym
    // (the pronoun "I" excepted: word lists have it).
    if (/^\p{Lu}/u.test(term) && term !== 'I') {
      drop('proper_noun');
      continue;
    }

    const sentence = findSentence(chunk, c.source_sentence);
    if (!sentence) {
      drop('sentence_not_in_text');
      continue;
    }
    if (sentence.text.length > MAX_SENTENCE_CHARS) {
      drop('sentence_too_long');
      continue;
    }
    // Last resort: inflection differs ("talk her into" for "talked her into").
    let span =
      findSpan(sentence.text, c.surface) ?? findGappedSpan(sentence.text, c.surface, 4, sameLemma);
    // Separable phrasal verb given with only its verb ("turned" for "turn down" in
    // "turned her application down"): widen the span to the particle.
    const termWords = term.split(' ');
    if (span && termWords.length > 1 && !/\s/.test(c.surface.trim())) {
      const wide = findGappedSpan(
        sentence.text,
        [c.surface.trim(), ...termWords.slice(1)].join(' '),
      );
      if (wide && wide[0] === span[0]) span = wide;
    }
    if (!span) {
      drop('surface_not_in_sentence');
      continue;
    }
    if (!termMatchesSurface(term, sentence.text.slice(span[0], span[1]))) {
      drop('term_not_in_text');
      continue;
    }

    let known: KnownRef | null = null;
    const ref = c.known_sense?.trim();
    if (ref) {
      const k = knownByRef.get(ref);
      if (k && (k.lemmaNorm === lemmaNorm || termForms(term).includes(k.lemmaNorm))) known = k;
    }

    let newSense: NewSense | null = null;
    if (!known) {
      const pos = normalizePos(c.pos);
      const gloss = c.gloss_en ? cleanGloss(c.gloss_en) : '';
      const key = gloss ? glossKey(gloss) : null;
      const meaning = c.meaning_tr ? cleanMeaningTr(c.meaning_tr) : '';
      if (pos && gloss && gloss.length <= 200 && key && meaning && meaning.length <= 120) {
        const ipa = cleanIpa(c.ipa);
        if (
          !isCleanLexiconText(term, 'en') ||
          !isCleanLexiconText(gloss, 'en') ||
          !isCleanLexiconText(meaning, 'tr') ||
          (ipa !== null && !isCleanLexiconText(ipa, 'ipa'))
        ) {
          drop('unsafe_text');
          continue;
        }
        newSense = {
          pos,
          gloss_en: gloss,
          gloss_key: key,
          meaning_tr: meaning,
          ipa,
        };
      } else {
        drop(ref ? 'unknown_sense_ref' : 'incomplete_new_sense');
        continue;
      }
    }

    const dedupKey = known
      ? `k:${known.senseId}`
      : `n:${lemmaNorm}|${newSense!.pos}|${newSense!.gloss_key}`;
    if (seen.has(dedupKey)) {
      drop('duplicate');
      continue;
    }
    if (out.length >= MAX_CANDIDATES) {
      drop('over_limit');
      continue;
    }
    seen.add(dedupKey);

    const conf = Number.isFinite(c.confidence) ? Math.min(1, Math.max(0, c.confidence)) : 0.5;
    out.push({
      term,
      lemma_norm: lemmaNorm,
      term_type: inferTermType(c.term_type, term),
      surface: sentence.text.slice(span[0], span[1]),
      source_sentence: sentence.text,
      sentence_tr: cleanSentenceTr(c.sentence_tr, sentence.text),
      span,
      confidence: Math.round(conf * 100) / 100,
      known,
      newSense,
    });
  }
  return { candidates: out, dropped };
}

// ---------------------------------------------------------------------------
// Lexicon resolution (shared by extract and enrich)
// ---------------------------------------------------------------------------

export interface PendingSense {
  lemma: string;
  lemma_norm: string;
  term_type: 'word' | 'phrase' | 'pattern';
  sense: NewSense;
}

export interface ResolvedSense {
  senseId: string;
  match: 'known_sense' | 'new_sense' | 'new_term';
}

/**
 * Turns new senses into lexicon ids: reuses an existing sense of the same term and part
 * of speech when the gloss is the same or nearly the same (no insert), otherwise
 * inserts (ON CONFLICT returns the existing row). Returns one result per input, in order.
 */
export async function resolveNewSenses(
  pending: PendingSense[],
  termsByNorm: Map<string, LexTerm>,
  store: AiStore,
  model: string | null,
): Promise<ResolvedSense[]> {
  const missing = [...new Set(pending.map((p) => p.lemma_norm))].filter((n) => !termsByNorm.has(n));
  if (missing.length > 0) {
    for (const t of await store.findTerms(missing)) termsByNorm.set(t.lemma_norm, t);
  }

  const results: (ResolvedSense | null)[] = pending.map(() => null);
  const toInsert: { idx: number[]; item: LexiconUpsertItem }[] = [];

  pending.forEach((p, i) => {
    const term = termsByNorm.get(p.lemma_norm);
    const existing = term?.senses.find(
      (s) =>
        s.pos === p.sense.pos &&
        (s.gloss_key === p.sense.gloss_key || isNearDuplicateGloss(s.gloss_en, p.sense.gloss_en)),
    );
    if (existing) {
      results[i] = { senseId: existing.id, match: 'known_sense' };
      return;
    }
    const twin = toInsert.find(
      (t) =>
        t.item.lemma_norm === p.lemma_norm &&
        t.item.pos === p.sense.pos &&
        (t.item.gloss_key === p.sense.gloss_key ||
          isNearDuplicateGloss(t.item.gloss_en!, p.sense.gloss_en)),
    );
    if (twin) {
      twin.idx.push(i);
      return;
    }
    toInsert.push({
      idx: [i],
      item: {
        lemma: term?.lemma ?? p.lemma,
        lemma_norm: p.lemma_norm,
        term_type: term?.term_type ?? p.term_type,
        pos: p.sense.pos,
        gloss_en: p.sense.gloss_en,
        gloss_key: p.sense.gloss_key,
        meaning_tr: p.sense.meaning_tr,
        // A known term keeps its pronunciation unless the model gave one for this sense.
        ipa: p.sense.ipa ?? term?.senses.find((s) => s.ipa)?.ipa ?? null,
        model,
      },
    });
  });

  if (toInsert.length > 0) {
    const upserted = await store.upsertLexicon(toInsert.map((t) => t.item));
    toInsert.forEach((t, k) => {
      const r = upserted[k];
      if (!r?.sense_id) return;
      const match = !r.sense_created ? 'known_sense' : r.term_created ? 'new_term' : 'new_sense';
      for (const i of t.idx) results[i] = { senseId: r.sense_id, match };
    });
  }
  return results.map((r) => r ?? { senseId: '', match: 'known_sense' });
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** What the chunk cache stores: lexicon ids only, lexicon content is joined on read. */
interface CachedCandidate {
  surface: string;
  term_type: 'word' | 'phrase' | 'pattern';
  source_sentence: string;
  sentence_tr?: string | null; // since extract-v2
  span: [number, number];
  confidence: number;
  sense_id: string;
  match: 'known_sense' | 'new_sense' | 'new_term';
}
interface CachedResult {
  v: 1;
  candidates: CachedCandidate[];
  dropped: Record<string, number>;
}

function isCachedResult(x: unknown): x is CachedResult {
  return (
    !!x &&
    typeof x === 'object' &&
    (x as CachedResult).v === 1 &&
    Array.isArray((x as CachedResult).candidates)
  );
}

function buildResponse(
  cached: CachedResult,
  entries: LexiconEntry[],
  meta: { cacheHit: boolean; model: string | null; usage: { used: number; limit: number } | null },
): ExtractResponse {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const candidates: ExtractCandidate[] = [];
  const dropped = { ...cached.dropped };
  for (const c of cached.candidates) {
    const lex = byId.get(c.sense_id);
    if (!lex) {
      dropped.lexicon_missing = (dropped.lexicon_missing ?? 0) + 1;
      continue;
    }
    candidates.push({
      term: lex.lemma,
      surface: c.surface,
      term_type: lex.term_type,
      source_sentence: c.source_sentence,
      sentence_tr: c.sentence_tr ?? null,
      span: c.span,
      confidence: c.confidence,
      match: c.match,
      lexicon_hit: meta.cacheHit || c.match === 'known_sense',
      lexicon: lex,
    });
  }
  const count = (m: string) => candidates.filter((c) => c.match === m).length;
  return {
    prompt_version: EXTRACT_PROMPT_VERSION,
    cache_hit: meta.cacheHit,
    ai_called: !meta.cacheHit,
    model: meta.model,
    candidates,
    counts: {
      candidates: candidates.length,
      known_sense: count('known_sense'),
      new_sense: count('new_sense'),
      new_term: count('new_term'),
      lexicon_hits: candidates.filter((c) => c.lexicon_hit).length,
      dropped,
    },
    usage: meta.usage,
  };
}

export async function runExtract(body: unknown, deps: PipelineDeps): Promise<ExtractResponse> {
  const parsed = extractRequest.safeParse(body);
  if (!parsed.success)
    throw new ApiError(
      'invalid_input',
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  const { text, chunk_hash, level } = parsed.data;

  if ((await sha256Hex(text)) !== chunk_hash) {
    throw new ApiError('invalid_input', 'chunk_hash is not the SHA-256 of text');
  }

  // 1. Chunk cache: the same text never reaches the model twice.
  const hit = await deps.store.getChunkCache(
    deps.userId,
    chunk_hash,
    EXTRACT_PROMPT_VERSION,
    level,
  );
  if (hit && isCachedResult(hit.result)) {
    const entries = await deps.store.getEntries([
      ...new Set(hit.result.candidates.map((c) => c.sense_id)),
    ]);
    return buildResponse(hit.result, entries, { cacheHit: true, model: hit.model, usage: null });
  }

  // 2. Lexicon pre-match: existing senses of terms that occur in the chunk.
  const terms = await deps.store.findTerms(prematchForms(text));
  const termsByNorm = new Map(terms.map((t) => [t.lemma_norm, t]));
  const known: KnownSenseLine[] = [];
  const knownByRef = new Map<string, KnownRef>();
  for (const t of terms) {
    for (const s of t.senses) {
      if (known.length >= MAX_KNOWN_SENSES) break;
      const ref = `s${known.length + 1}`;
      known.push({ ref, lemma: t.lemma, pos: s.pos, gloss_en: s.gloss_en });
      knownByRef.set(ref, { senseId: s.id, lemmaNorm: t.lemma_norm });
    }
  }

  // 3. Daily limit (only requests that call the model count).
  const usage = await deps.store.consumeAi(deps.userId, deps.dailyLimit);
  if (!usage.allowed) {
    throw new ApiError('daily_limit', `Daily AI limit reached (${usage.used}/${usage.limit}).`);
  }

  // 4. Model.
  let result;
  try {
    result = await deps.provider().generateJson({
      system: EXTRACT_SYSTEM_PROMPT,
      user: buildExtractUserPrompt(text, level, known),
      schema: EXTRACT_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      validate: (d) =>
        extractModelOutput.safeParse(d).success ? null : 'expected {candidates: [...]}',
      maxOutputTokens: EXTRACT_MAX_OUTPUT_TOKENS,
      timeoutMs: EXTRACT_TIMEOUT_MS,
    });
  } catch (e) {
    if (e instanceof AiError) throw new ApiError(e.code, e.message, e.retryAfterS);
    throw e;
  }
  deps.log?.('ai-extract model call', {
    model: result.model,
    attempts: result.attempts,
    usage: result.usage,
    truncated: result.truncated ?? false,
  });

  // 5. Validation.
  // Logs carry the dropped term only, never the user's sentence.
  const v = validateExtractOutput(result.data, text, knownByRef, (reason, term) =>
    deps.log?.('ai-extract dropped candidate', { reason, term }),
  );

  // 6. Lexicon: new senses are inserted (or matched to an existing one).
  const pendingIdx: number[] = [];
  const pending: PendingSense[] = [];
  v.candidates.forEach((c, i) => {
    if (c.newSense) {
      pendingIdx.push(i);
      pending.push({
        lemma: c.term,
        lemma_norm: c.lemma_norm,
        term_type: c.term_type,
        sense: c.newSense,
      });
    }
  });
  const resolved = await resolveNewSenses(pending, termsByNorm, deps.store, result.model);
  const senseIdOf: string[] = v.candidates.map((c) => c.known?.senseId ?? '');
  const matchOf: ('known_sense' | 'new_sense' | 'new_term')[] = v.candidates.map(
    () => 'known_sense',
  );
  pendingIdx.forEach((ci, k) => {
    senseIdOf[ci] = resolved[k]!.senseId;
    matchOf[ci] = resolved[k]!.match;
  });

  const dropped: Record<string, number> = { ...v.dropped } as Record<string, number>;
  // The answer was cut off by the token limit: items after the cut are missing.
  if (result.truncated) dropped.truncated = 1;
  const cachedCandidates: CachedCandidate[] = [];
  const seenSense = new Set<string>();
  v.candidates.forEach((c, i) => {
    const id = senseIdOf[i]!;
    if (!id) {
      dropped.lexicon_write_failed = (dropped.lexicon_write_failed ?? 0) + 1;
      return;
    }
    if (seenSense.has(id)) {
      dropped.duplicate = (dropped.duplicate ?? 0) + 1;
      return;
    }
    seenSense.add(id);
    cachedCandidates.push({
      surface: c.surface,
      term_type: c.term_type,
      source_sentence: c.source_sentence,
      sentence_tr: c.sentence_tr,
      span: c.span,
      confidence: c.confidence,
      sense_id: id,
      match: matchOf[i]!,
    });
  });
  const cached: CachedResult = { v: 1, candidates: cachedCandidates, dropped };

  // 7. Cache (failure to cache must not fail the request).
  try {
    await deps.store.putChunkCache(
      deps.userId,
      chunk_hash,
      EXTRACT_PROMPT_VERSION,
      level,
      cached,
      result.model,
    );
  } catch (e) {
    deps.log?.('ai-extract cache write failed', { error: String(e) });
  }

  const entries = await deps.store.getEntries([...seenSense]);
  return buildResponse(cached, entries, {
    cacheHit: false,
    model: result.model,
    usage: { used: usage.used, limit: usage.limit },
  });
}
