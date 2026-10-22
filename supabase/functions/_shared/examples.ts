// ai-examples pipeline (v0.2 İP5): example sentences for lexicon senses, in several
// contexts, written once and shared by every user through public.lexicon_examples.
//
//   lexicon lookup (lemma, pos, gloss of each requested sense id)
//   -> shared examples first (no model call, no budget for what exists)
//   -> daily limit -> one model call for every missing (sense, context) pair
//   -> validation -> insert-or-skip -> response
//
// Privacy: the request carries only lexicon ids, a level band and context keys. The model
// gets the term, part of speech and English gloss from the lexicon, never user text.

import { ApiError } from './errors.ts';
import { AiError } from './ai-provider.ts';
import {
  EXAMPLES_PROMPT_VERSION,
  examplesRequest,
  isExampleContext,
  MAX_EXAMPLE_CHARS,
  MAX_EXAMPLE_TR_CHARS,
  MAX_EXAMPLE_WORDS,
  type ExamplesResponse,
} from './examples-contracts.ts';
import {
  buildExamplesUserPrompt,
  EXAMPLES_RESPONSE_SCHEMA,
  EXAMPLES_SYSTEM_PROMPT,
  examplesModelItem,
  examplesModelOutput,
  type AvoidLine,
  type ExampleSenseLine,
} from './examples-prompt.ts';
import type { ExampleStore, NewExample } from './examples-store.ts';
import { termMatchesSurface, type PipelineDeps } from './extract.ts';
import { findGappedSpan, findSpan } from './locate.ts';
import type { LexiconEntry } from './contracts.ts';
import { isCleanLexiconText } from './text.ts';
import { FUNCTION_WORDS, lemmaForms, tokenize } from './tokenize.ts';

export interface ExamplesDeps extends PipelineDeps {
  examples: ExampleStore;
}

export const EXAMPLES_MAX_OUTPUT_TOKENS = 8192;
export const EXAMPLES_TIMEOUT_MS = 60_000;

export type ExampleDropReason =
  | 'invalid_shape'
  | 'unknown_ref'
  | 'unexpected_context'
  | 'extra'
  | 'bad_text'
  | 'too_long'
  | 'term_missing'
  | 'bad_translation'
  | 'duplicate';

// ---------------------------------------------------------------------------
// Text helpers (pure; also used by the tests)
// ---------------------------------------------------------------------------

const INVISIBLE_G = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/gu;
// Sentences: Latin letters, digits and ordinary punctuation (no other scripts, no markup).
const SENTENCE_TEXT = /^[\p{Script=Latin}\p{M}\p{N} '’",;:.()\-/!?&%$£€]+$/u;

/** Whitespace collapsed, invisible characters and wrapping quotes removed. */
export function cleanExampleText(s: string): string {
  return s
    .replace(INVISIBLE_G, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["“”‘’']+|["“”‘’']+$/g, '')
    .trim();
}

/** Words of a sentence (tokens with a letter or digit). */
export function wordCount(s: string): number {
  return s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Duplicate key of a sentence; the SQL twin is lexicon_examples.text_key. */
export function exampleTextKey(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Same sentence, or the same words in another order / with one or two words changed. */
export function isNearDuplicateSentence(a: string, b: string): boolean {
  const ka = exampleTextKey(a);
  const kb = exampleTextKey(b);
  if (ka === kb) return true;
  const ta = new Set(ka.split(' '));
  const tb = new Set(kb.split(' '));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union > 0 && inter / union >= 0.7;
}

/** Fit for a shared sentence (English or Turkish): no links, markup or foreign scripts. */
export function isCleanSentence(s: string): boolean {
  return isCleanLexiconText(s, 'ipa') && SENTENCE_TEXT.test(s) && /\p{L}/u.test(s);
}

const PLACEHOLDER = /^(?:sb|sth|smb|smth|someone|somebody|something|one's|oneself|someone's|somebody's|sb's|doing)$/;

/**
 * [start, end) of the term in the sentence. The model's `surface` is used when it is a form
 * of the term and occurs in the sentence; otherwise the term's own words are searched (any
 * inflection, up to four words in between, slots like "sth" skipped). Null: the sentence
 * does not contain the term.
 */
export function locateExampleTerm(
  text: string,
  lemma: string,
  surface: string,
): [number, number] | null {
  const surf = surface.trim();
  if (surf && termMatchesSurface(lemma, surf)) {
    const at = findSpan(text, surf);
    if (at) return at;
  }
  const words = tokenize(lemma)
    .map((t) => t.norm)
    .filter((w) => !PLACEHOLDER.test(w));
  if (words.length === 0) return null;
  const same = (sentenceWord: string, termWord: string) =>
    sentenceWord === termWord || lemmaForms(sentenceWord).includes(termWord);
  if (words.length === 1) {
    for (const t of tokenize(text)) {
      if (same(t.norm, words[0]!)) return [t.index, t.index + t.text.length];
    }
    return null;
  }
  // A multi-word term made only of function words would match almost anything loosely.
  if (words.every((w) => FUNCTION_WORDS.has(w))) return findSpan(text, words.join(' '));
  return findGappedSpan(text, words.join(' '), 4, same);
}

export interface ValidExample {
  ref: string;
  context: string;
  text_en: string;
  text_tr: string;
  span: [number, number];
}

export interface ValidationInput {
  /** ref -> the sense's lemma and the contexts asked for it */
  senses: ReadonlyMap<string, { lemma: string; contexts: readonly string[] }>;
  /** ref -> sentences the sense already has (any band and context): no duplicates of them */
  existing: ReadonlyMap<string, readonly string[]>;
}

/**
 * Checks every item the model returned. Never throws; an invalid item is dropped and
 * counted, the others are kept. At most one sentence per (ref, context).
 */
export function validateExamplesOutput(
  items: readonly unknown[],
  input: ValidationInput,
  onDrop: (reason: ExampleDropReason) => void = () => {},
): ValidExample[] {
  const out: ValidExample[] = [];
  const taken = new Set<string>();
  const seen = new Map<string, string[]>(); // ref -> sentences accepted in this batch
  for (const raw of items) {
    const p = examplesModelItem.safeParse(raw);
    if (!p.success) {
      onDrop('invalid_shape');
      continue;
    }
    const ref = p.data.ref.trim();
    const context = p.data.context.trim().toLowerCase();
    const sense = input.senses.get(ref);
    if (!sense) {
      onDrop('unknown_ref');
      continue;
    }
    if (!sense.contexts.includes(context)) {
      onDrop('unexpected_context');
      continue;
    }
    const key = `${ref}|${context}`;
    if (taken.has(key)) {
      onDrop('extra');
      continue;
    }
    const text = cleanExampleText(p.data.text_en);
    if (!text || !isCleanSentence(text)) {
      onDrop('bad_text');
      continue;
    }
    if (text.length > MAX_EXAMPLE_CHARS || wordCount(text) > MAX_EXAMPLE_WORDS) {
      onDrop('too_long');
      continue;
    }
    const span = locateExampleTerm(text, sense.lemma, p.data.surface);
    if (!span) {
      onDrop('term_missing');
      continue;
    }
    const tr = cleanExampleText(p.data.text_tr);
    if (
      !tr ||
      tr.length > MAX_EXAMPLE_TR_CHARS ||
      !isCleanSentence(tr) ||
      exampleTextKey(tr) === exampleTextKey(text)
    ) {
      onDrop('bad_translation');
      continue;
    }
    const before = [...(input.existing.get(ref) ?? []), ...(seen.get(ref) ?? [])];
    if (before.some((b) => isNearDuplicateSentence(b, text))) {
      onDrop('duplicate');
      continue;
    }
    taken.add(key);
    seen.set(ref, [...(seen.get(ref) ?? []), text]);
    out.push({ ref, context, text_en: text, text_tr: tr, span });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export async function runExamples(body: unknown, deps: ExamplesDeps): Promise<ExamplesResponse> {
  const parsed = examplesRequest.safeParse(body);
  if (!parsed.success)
    throw new ApiError(
      'invalid_input',
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  const { level_band: band, fresh } = parsed.data;
  // Unknown context keys (a newer client) are ignored, not refused.
  const contexts = fresh
    ? [fresh.context].filter(isExampleContext)
    : [...new Set(parsed.data.contexts)].filter(isExampleContext);
  const senseIds = fresh ? [fresh.sense_id] : [...new Set(parsed.data.sense_ids)];

  const entries = (await deps.store.getEntries(senseIds)).filter((e) => senseIds.includes(e.id));
  const ids = entries.map((e) => e.id);
  const existing = ids.length ? await deps.examples.findExamples(ids, band) : [];

  const has = new Set(existing.map((x) => `${x.sense_id}|${x.context}`));
  const wanted: { entry: LexiconEntry; contexts: string[] }[] = [];
  let requested = 0;
  for (const entry of entries) {
    const need: string[] = [];
    for (const c of contexts) {
      requested++;
      if (fresh || !has.has(`${entry.id}|${c}`)) need.push(c);
    }
    if (need.length) wanted.push({ entry, contexts: need });
  }
  const missingPairs = wanted.reduce((n, w) => n + w.contexts.length, 0);
  const base = {
    prompt_version: EXAMPLES_PROMPT_VERSION,
    level_band: band,
    counts: { requested, cached: requested - missingPairs, generated: 0, dropped: {} },
  };
  if (wanted.length === 0) {
    return { ...base, ai_called: false, model: null, examples: existing, new_ids: [], usage: null };
  }

  const usage = await deps.store.consumeAi(deps.userId, deps.dailyLimit);
  if (!usage.allowed)
    throw new ApiError('daily_limit', `Daily AI limit reached (${usage.used}/${usage.limit}).`);

  // Every sentence the senses already have (all bands and contexts) must not come again.
  const all = await deps.examples.findExamples(
    wanted.map((w) => w.entry.id),
    null,
  );
  const lines: ExampleSenseLine[] = [];
  const avoid: AvoidLine[] = [];
  const refToId = new Map<string, string>();
  const senses = new Map<string, { lemma: string; contexts: string[] }>();
  const existingByRef = new Map<string, string[]>();
  wanted.forEach((w, i) => {
    const ref = `r${i + 1}`;
    refToId.set(ref, w.entry.id);
    senses.set(ref, { lemma: w.entry.lemma, contexts: w.contexts });
    lines.push({
      ref,
      lemma: w.entry.lemma,
      pos: w.entry.pos,
      gloss_en: w.entry.gloss_en,
      contexts: w.contexts,
    });
    const mine = all.filter((x) => x.sense_id === w.entry.id);
    existingByRef.set(
      ref,
      mine.map((x) => x.text_en),
    );
    if (fresh) {
      for (const x of mine.filter((m) => m.context === fresh.context).slice(-12))
        avoid.push({ ref, context: x.context, text: x.text_en });
    }
  });

  let result;
  try {
    result = await deps.provider().generateJson({
      system: EXAMPLES_SYSTEM_PROMPT,
      user: buildExamplesUserPrompt(band, lines, avoid),
      schema: EXAMPLES_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      validate: (d) => (examplesModelOutput.safeParse(d).success ? null : 'expected {examples: [...]}'),
      maxOutputTokens: EXAMPLES_MAX_OUTPUT_TOKENS,
      timeoutMs: EXAMPLES_TIMEOUT_MS,
    });
  } catch (e) {
    if (e instanceof AiError) throw new ApiError(e.code, e.message, e.retryAfterS);
    throw e;
  }

  const dropped: Record<string, number> = {};
  const valid = validateExamplesOutput(
    examplesModelOutput.parse(result.data).examples,
    { senses, existing: existingByRef },
    (reason) => {
      dropped[reason] = (dropped[reason] ?? 0) + 1;
    },
  );
  const rows: NewExample[] = valid.map((v) => ({
    sense_id: refToId.get(v.ref)!,
    context: v.context,
    level_band: band,
    text_en: v.text_en,
    span: v.span,
    translations: { tr: v.text_tr },
    model: result.model,
    prompt_version: EXAMPLES_PROMPT_VERSION,
  }));
  const inserted = await deps.examples.insertExamples(rows);
  const after = await deps.examples.findExamples(ids, band);
  deps.log?.('ai-examples model call', {
    model: result.model,
    attempts: result.attempts,
    senses: wanted.length,
    pairs: missingPairs,
    generated: inserted.length,
    dropped,
    fresh: !!fresh,
    truncated: result.truncated === true,
    usage: result.usage,
  });
  return {
    ...base,
    ai_called: true,
    model: result.model,
    examples: after,
    new_ids: inserted.map((r) => r.id),
    counts: { ...base.counts, generated: inserted.length, dropped },
    usage: { used: usage.used, limit: usage.limit },
  };
}
