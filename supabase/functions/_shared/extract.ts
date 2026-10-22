// ai-extract pipeline: chunk cache -> lexicon pre-match -> daily limit -> model ->
// validation -> lexicon insert-or-get -> response. Environment-neutral (Deno + Node);
// all I/O goes through AiStore and AiProvider.

import {
  extractRequest,
  MAX_CANDIDATES,
  type AiFalseFriend,
  type ExtractCandidate,
  type ExtractResponse,
  type LexiconEntry,
} from './contracts.ts';
import { ApiError } from './errors.ts';
import { AiError, type AiProvider } from './ai-provider.ts';
import { parseCefr, type Cefr } from './cefr.ts';
import { lemmasNeeded, resolveLevel, type RefLookup } from './level.ts';
import { looksBorrowed } from './level-job.ts';
import { stripListEntryPrefix } from './listEntry.ts';
import { findGappedSpan, findSentence, findSpan } from './locate.ts';
import {
  buildExtractUserPrompt,
  EXTRACT_PROMPT_VERSION,
  EXTRACT_RESPONSE_SCHEMA,
  EXTRACT_SYSTEM_PROMPT,
  extractModelCandidate,
  extractModelFalseFriend,
  extractModelOutput,
  MAX_KNOWN_SENSES,
  type KnownSenseLine,
} from './prompts.ts';
import type { LexiconPairNoteRow, NewPairNote, PairNoteStore } from './pair-notes.ts';
import type { AiStore, LexiconUpsertItem, LexSense, LexTerm } from './store.ts';
import {
  cleanLemma,
  glossKey,
  isCleanLexiconText,
  isDuplicateSense,
  isNearDuplicateGloss,
  isSameMeaningTr,
  meaningAlternatives,
  normalizeLemma,
  normalizePos,
  type Pos,
} from './text.ts';
import { cleanChunkTopics } from './topics-contract.ts';
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

/** ai-extract's dependencies. Without `pairNotes` (older tests) false friends are not stored. */
export interface ExtractDeps extends PipelineDeps {
  pairNotes?: PairNoteStore;
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
  /** The model's level guess (extract-v3 / enrich-v2); null when missing or invalid. */
  cefr_guess: Cefr | null;
  /** extract-v5: a checked false-friend warning for this sense, or null. */
  false_friend?: CleanFalseFriend | null;
}

/** A false friend the server accepted (extract-v5), before it is stored. */
export interface CleanFalseFriend {
  tr_word: string;
  tr_meaning_tr: string;
  strength: 'full' | 'partial';
  note_tr: string | null;
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
  /** extract-v5: topic keys of the chunk (empty when missing or unknown). */
  topics: string[];
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

const MAX_FALSE_FRIEND_NOTE_CHARS = 160;

/**
 * The model's false_friend_tr for a new sense (extract-v5), checked: a Turkish word (1–3
 * words, ≤ 40 chars) whose meaning is NOT the sense's Turkish meaning (that would be a
 * borrowed word, not a false friend) and that sounds like the English term (looksBorrowed,
 * the same sound check as the level job's false friends). Anything else gives null: a bad
 * warning never drops the candidate.
 */
export function cleanFalseFriend(raw: unknown, term: string, meaningTr: string): CleanFalseFriend | null {
  if (raw === null || raw === undefined) return null;
  const p = extractModelFalseFriend.safeParse(raw);
  if (!p.success) return null;
  const strip = (v: string) =>
    v
      .normalize('NFC')
      .replace(/\s+/g, ' ')
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
      .trim();
  const word = strip(p.data.tr_word).toLocaleLowerCase('tr');
  const meaning = cleanMeaningTr(p.data.tr_meaning_tr);
  if (!word || word.length > 40 || word.split(' ').length > 3 || !isCleanLexiconText(word, 'tr')) return null;
  if (!meaning || meaning.length > 60 || !isCleanLexiconText(meaning, 'tr')) return null;
  // Same meaning as the sense: a loanword ("television" ~ "televizyon"), not a trap.
  if (isSameMeaningTr(meaning, meaningTr) || meaningAlternatives(meaningTr).includes(word)) return null;
  if (!word.split(' ').some((w) => looksBorrowed(term, `'${w}'`))) return null;
  const note = p.data.note_tr ? strip(p.data.note_tr).replace(/["“”]/g, "'") : '';
  return {
    tr_word: word,
    tr_meaning_tr: meaning,
    strength: p.data.strength === 'partial' ? 'partial' : 'full',
    note_tr:
      note && note.length <= MAX_FALSE_FRIEND_NOTE_CHARS && isCleanLexiconText(note, 'tr') ? note : null,
  };
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
  if (!top.success) return { candidates: [], dropped: { invalid_shape: 1 }, topics: [] };

  const out: ValidCandidate[] = [];
  const seen = new Set<string>();
  const bySentence = new Map<string, number>();

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

    const located = findSentence(chunk, c.source_sentence);
    if (!located) {
      drop('sentence_not_in_text');
      continue;
    }
    // "1988 trailer I own a trailer." from a word list: keep only the example sentence.
    const sentence = { text: stripListEntryPrefix(located.text, term) };
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
          cefr_guess: parseCefr(c.cefr_guess),
          false_friend: cleanFalseFriend(c.false_friend_tr, term, meaning),
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

    const conf = Number.isFinite(c.confidence) ? Math.min(1, Math.max(0, c.confidence)) : 0.5;
    const candidate: ValidCandidate = {
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
    };

    // One sense per term and sentence: the same word in the same sentence has one meaning.
    // A model that answers both with a known ref and with a reworded new sense ("a polite
    // request to attend an event" / "... to go somewhere") must not add a second sense.
    // The known sense wins (nothing is written), then the higher confidence.
    const sentenceKey = `${lemmaNorm}|${sentence.text.replace(/\s+/g, ' ').trim()}`;
    const twin = bySentence.get(sentenceKey);
    if (twin !== undefined) {
      const prev = out[twin]!;
      const better =
        (candidate.known !== null && prev.known === null) ||
        ((candidate.known === null) === (prev.known === null) &&
          candidate.confidence > prev.confidence);
      drop('duplicate');
      if (better) {
        seen.add(dedupKey);
        out[twin] = candidate;
      }
      continue;
    }
    if (out.length >= MAX_CANDIDATES) {
      drop('over_limit');
      continue;
    }
    seen.add(dedupKey);
    bySentence.set(sentenceKey, out.length);
    out.push(candidate);
  }
  return { candidates: out, dropped, topics: cleanChunkTopics(top.data.topics) };
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

interface SenseShape {
  pos: string;
  gloss_en: string;
  gloss_key: string;
  meaning_tr: string;
}

/**
 * Is `b` a sense the term already has as `a`? Same part of speech, and the same or a
 * nearly identical English gloss ('gloss'), or an overlapping Turkish meaning ('meaning':
 * "davet" ~ "davetiye, davet", whatever the glosses say). Both when `by` is omitted.
 */
function isSameSense(a: SenseShape, b: SenseShape, by?: 'gloss' | 'meaning'): boolean {
  if (a.pos !== b.pos) return false;
  const gloss = a.gloss_key === b.gloss_key || isNearDuplicateGloss(a.gloss_en, b.gloss_en);
  if (by === 'gloss') return gloss;
  const meaning = isDuplicateSense(a, b);
  return by === 'meaning' ? meaning : gloss || meaning;
}

/**
 * Turns new senses into lexicon ids: reuses an existing sense of the same term and part
 * of speech when the gloss is the same or nearly the same, or when the Turkish meaning
 * overlaps (no insert), otherwise inserts. lexicon_upsert() repeats the meaning check
 * under the lexicon lock, so a sense created a moment ago by a concurrent request is
 * reused too (ON CONFLICT returns the existing row for the same gloss_key). Returns one
 * result per input, in order.
 */
export async function resolveNewSenses(
  pending: PendingSense[],
  termsByNorm: Map<string, LexTerm>,
  store: AiStore,
  model: string | null,
  log?: PipelineDeps['log'],
): Promise<ResolvedSense[]> {
  const missing = [...new Set(pending.map((p) => p.lemma_norm))].filter((n) => !termsByNorm.has(n));
  if (missing.length > 0) {
    for (const t of await store.findTerms(missing)) termsByNorm.set(t.lemma_norm, t);
  }

  const results: (ResolvedSense | null)[] = pending.map(() => null);
  const toInsert: { idx: number[]; item: LexiconUpsertItem }[] = [];

  pending.forEach((p, i) => {
    const term = termsByNorm.get(p.lemma_norm);
    const existing =
      term?.senses.find((s) => isSameSense(s, p.sense, 'gloss')) ??
      term?.senses.find((s) => isSameSense(s, p.sense, 'meaning'));
    if (existing) {
      results[i] = { senseId: existing.id, match: 'known_sense' };
      return;
    }
    const twin = toInsert.find(
      (t) =>
        t.item.lemma_norm === p.lemma_norm &&
        isSameSense(
          {
            pos: t.item.pos!,
            gloss_en: t.item.gloss_en!,
            gloss_key: t.item.gloss_key!,
            meaning_tr: t.item.meaning_tr!,
          },
          p.sense,
        ),
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
        // The key (even null) tells lexicon_upsert that the model was asked for a guess.
        cefr_guess: p.sense.cefr_guess,
      },
    });
  });

  if (toInsert.length > 0) {
    await attachLevels(
      toInsert.map((t) => t.item),
      store,
      log,
    );
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

/**
 * Sets the level (level.ts resolveLevel) of new senses and the term's Zipf value from the
 * reference data. Never fails the request: without reference data the senses are stored
 * without a level and the level job (scripts/system-jobs.ts) resolves them later.
 */
export async function attachLevels(
  items: LexiconUpsertItem[],
  store: AiStore,
  log?: PipelineDeps['log'],
): Promise<void> {
  if (items.length === 0) return;
  try {
    const lemmas = [...new Set(items.flatMap((it) => lemmasNeeded(it.lemma_norm)))];
    const refs = await store.getLevelRefs(lemmas.slice(0, 2000));
    const byLemma = new Map(refs.rows.map((r) => [r.lemma_norm, r]));
    const lookup: RefLookup = (l) => byLemma.get(l);
    for (const it of items) {
      it.zipf = byLemma.get(it.lemma_norm)?.zipf ?? null;
      if (!it.gloss_key) continue;
      const level = resolveLevel(
        {
          lemma_norm: it.lemma_norm,
          term_type: it.term_type,
          pos: it.pos ?? null,
          cefr_guess: it.cefr_guess ?? null,
        },
        lookup,
        { minZipf: refs.min_zipf },
      );
      if (!level) continue;
      it.cefr = level.cefr;
      it.cefr_source = level.source;
      it.cefr_list = level.list_cefr;
      it.cefr_reason_tr = level.reason_tr;
    }
  } catch (e) {
    log?.('level lookup failed', { error: String(e) });
  }
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
  /** extract-v5 */
  topics?: string[];
}

function isCachedResult(x: unknown): x is CachedResult {
  return (
    !!x &&
    typeof x === 'object' &&
    (x as CachedResult).v === 1 &&
    Array.isArray((x as CachedResult).candidates)
  );
}

/** A stored false_friend pair note as the response carries it; null when malformed. */
export function toAiFalseFriend(row: LexiconPairNoteRow): AiFalseFriend | null {
  const c = row.content;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const trWord = str(c.tr_word);
  const enTr = str(c.en_meaning_tr);
  const trTr = str(c.tr_meaning_tr);
  if (row.kind !== 'false_friend' || row.status !== 'active' || !trWord || !enTr || !trTr) return null;
  return {
    id: row.id,
    tr_word: trWord,
    en_meaning_tr: enTr,
    tr_meaning_tr: trTr,
    tr_meaning_en: str(c.tr_meaning_en),
    strength: c.strength === 'partial' ? 'partial' : 'full',
    note_tr: str(c.note_tr),
  };
}

/** AI false friends stored for these senses (first per sense). A failed lookup shows none. */
async function falseFriendsOf(
  senseIds: string[],
  deps: ExtractDeps,
): Promise<Map<string, AiFalseFriend>> {
  const out = new Map<string, AiFalseFriend>();
  if (!deps.pairNotes || senseIds.length === 0) return out;
  try {
    for (const row of await deps.pairNotes.findNotes(senseIds, 'false_friend')) {
      const ff = toAiFalseFriend(row);
      if (ff && row.sense_id && !out.has(row.sense_id)) out.set(row.sense_id, ff);
    }
  } catch (e) {
    deps.log?.('ai-extract false friend lookup failed', { error: String(e) });
  }
  return out;
}

function buildResponse(
  cached: CachedResult,
  entries: LexiconEntry[],
  meta: { cacheHit: boolean; model: string | null; usage: { used: number; limit: number } | null },
  falseFriends: ReadonlyMap<string, AiFalseFriend> = new Map(),
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
      false_friend: falseFriends.get(lex.id) ?? null,
    });
  }
  const count = (m: string) => candidates.filter((c) => c.match === m).length;
  return {
    prompt_version: EXTRACT_PROMPT_VERSION,
    cache_hit: meta.cacheHit,
    ai_called: !meta.cacheHit,
    model: meta.model,
    topics: cleanChunkTopics(cached.topics ?? []),
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

/**
 * The known senses offered to the model, at most `max`: chosen round robin (each term's
 * first sense, then each term's second, ...), listed grouped by term in the input order.
 */
export function pickKnownSenses(terms: LexTerm[], max: number): { t: LexTerm; s: LexSense }[] {
  const picked = new Set<string>();
  const depth = Math.max(0, ...terms.map((t) => t.senses.length));
  for (let k = 0; k < depth && picked.size < max; k++) {
    for (const t of terms) {
      if (picked.size >= max) break;
      const s = t.senses[k];
      if (s) picked.add(s.id);
    }
  }
  return terms.flatMap((t) => t.senses.filter((s) => picked.has(s.id)).map((s) => ({ t, s })));
}

export async function runExtract(body: unknown, deps: ExtractDeps): Promise<ExtractResponse> {
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
    const ids = [...new Set(hit.result.candidates.map((c) => c.sense_id))];
    const entries = await deps.store.getEntries(ids);
    return buildResponse(
      hit.result,
      entries,
      { cacheHit: true, model: hit.model, usage: null },
      await falseFriendsOf(ids, deps),
    );
  }

  // 2. Lexicon pre-match: existing senses of terms that occur in the chunk.
  const terms = await deps.store.findTerms(prematchForms(text));
  const termsByNorm = new Map(terms.map((t) => [t.lemma_norm, t]));
  const known: KnownSenseLine[] = [];
  const knownByRef = new Map<string, KnownRef>();
  // Round robin (every term's first sense, then every second sense, ...): when the chunk
  // knows more senses than the prompt can carry, every term is still offered, not just
  // the alphabetically first ones. A term the model is not shown gets a reworded new
  // sense, which resolveNewSenses then has to catch.
  for (const { t, s } of pickKnownSenses(terms, MAX_KNOWN_SENSES)) {
    const ref = `s${known.length + 1}`;
    known.push({ ref, lemma: t.lemma, pos: s.pos, gloss_en: s.gloss_en });
    knownByRef.set(ref, { senseId: s.id, lemmaNorm: t.lemma_norm });
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
  const resolved = await resolveNewSenses(
    pending,
    termsByNorm,
    deps.store,
    result.model,
    deps.log,
  );
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
  const cached: CachedResult = { v: 1, candidates: cachedCandidates, dropped, topics: v.topics };

  // 6b. extract-v5: false friends of new senses go to the shared pair notes (no user text:
  // the Turkish look-alike, its meaning and a short note, written by the model and checked).
  if (deps.pairNotes) {
    const notes: NewPairNote[] = [];
    v.candidates.forEach((c, i) => {
      const ff = c.newSense?.false_friend;
      const senseId = senseIdOf[i];
      if (!ff || !senseId || !c.newSense) return;
      notes.push({
        term_norm: c.lemma_norm,
        sense_id: senseId,
        lang_pair: 'en-tr',
        kind: 'false_friend',
        content_key: ff.tr_word,
        content: {
          tr_word: ff.tr_word,
          en_meaning_tr: c.newSense.meaning_tr,
          tr_meaning_tr: ff.tr_meaning_tr,
          tr_meaning_en: null,
          strength: ff.strength,
          note_tr: ff.note_tr,
        },
        model: result.model,
        prompt_version: EXTRACT_PROMPT_VERSION,
      });
    });
    try {
      if (notes.length) await deps.pairNotes.insertNotes(notes);
    } catch (e) {
      deps.log?.('ai-extract false friend write failed', { error: String(e) });
    }
  }

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
  return buildResponse(
    cached,
    entries,
    { cacheHit: false, model: result.model, usage: { used: usage.used, limit: usage.limit } },
    await falseFriendsOf([...seenSense], deps),
  );
}
