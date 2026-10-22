// ai-contrast pipeline (v0.3 İP6, docs/decisions/0026): the content of a "fark kartı" for two
// lexicon senses the learner mixes up — one short English sentence per term, its Turkish
// translation and the difference in one Turkish line. Written once per pair and shared by
// every user through public.lexicon_pair_notes (kind 'contrast', pair 'en-tr', sense_id = the
// smaller sense id, content_key = contrastKey(a, b)).
//
//   lexicon lookup (lemma, part of speech, meanings of both sense ids)
//   -> shared table first (no model call, no budget)
//   -> daily limit -> one model call -> validation -> insert-or-skip -> response
//
// Privacy: the request carries two lexicon sense ids, nothing else. The model gets
// dictionary data (lemma and the sense's meanings), never user text. What the user edits on
// their own contrast card stays in their own rows (senses, user_content).

import { AiError } from './ai-provider.ts';
import type { LexiconEntry } from './contracts.ts';
import {
  CONTRAST_PROMPT_VERSION,
  contrastKey,
  contrastRequest,
  type ContrastNote,
  type ContrastResponse,
  type ContrastSide,
  MAX_CONTRAST_DIFFERENCE_CHARS,
  MAX_CONTRAST_SENTENCE_CHARS,
  MIN_CONTRAST_DIFFERENCE_CHARS,
  MIN_CONTRAST_SENTENCE_CHARS,
} from './contrast-contracts.ts';
import {
  buildContrastUserPrompt,
  CONTRAST_RESPONSE_SCHEMA,
  CONTRAST_SYSTEM_PROMPT,
  contrastModelOutput,
} from './contrast-prompt.ts';
import { ApiError } from './errors.ts';
import { cleanExampleText, isCleanSentence, locateExampleTerm } from './examples.ts';
import type { PipelineDeps } from './extract.ts';
import { isTurkishText, mentionsTerm } from './mnemonic.ts';
import type { LexiconPairNoteRow, NewPairNote, PairNoteStore } from './pair-notes.ts';

export interface ContrastDeps extends PipelineDeps {
  pairNotes: PairNoteStore;
}

export const CONTRAST_MAX_OUTPUT_TOKENS = 1024;
export const CONTRAST_TIMEOUT_MS = 30_000;
const KIND = 'contrast' as const;
const MAX_TR_CHARS = 300;

export type ContrastDropReason =
  | 'invalid_shape'
  | 'bad_sentence'
  | 'sentence_length'
  | 'term_missing'
  | 'both_terms'
  | 'bad_difference'
  | 'difference_length'
  | 'difference_terms'
  | 'not_turkish';

// ---------------------------------------------------------------------------
// Checks (pure; also used by the tests)
// ---------------------------------------------------------------------------

/** A Turkish translation: cleaned, or null when empty, too long or not clean text. */
export function cleanTranslation(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = cleanExampleText(raw);
  if (!v || v.length > MAX_TR_CHARS || !isCleanSentence(v)) return null;
  return v;
}

type Lemmas = { a: string; b: string };

function checkSentence(
  raw: string,
  own: string,
  other: string,
): { text: string; span: [number, number] } | ContrastDropReason {
  const text = cleanExampleText(raw);
  if (!text || !isCleanSentence(text)) return 'bad_sentence';
  if (text.length < MIN_CONTRAST_SENTENCE_CHARS || text.length > MAX_CONTRAST_SENTENCE_CHARS) return 'sentence_length';
  const span = locateExampleTerm(text, own, '');
  if (!span) return 'term_missing';
  // The other term in the same sentence hides the difference ("affect" has no "effect").
  if (other !== own && locateExampleTerm(text, other, '') && !own.includes(other)) return 'both_terms';
  return { text, span };
}

export interface ValidContrast {
  a: { sentence_en: string; span: [number, number]; sentence_tr: string | null };
  b: { sentence_en: string; span: [number, number]; sentence_tr: string | null };
  difference_tr: string;
}

/** Checks the model's answer. Returns the clean content, or the first reason it is unusable. */
export function validateContrastOutput(data: unknown, lemmas: Lemmas): ValidContrast | ContrastDropReason {
  const p = contrastModelOutput.safeParse(data);
  if (!p.success) return 'invalid_shape';
  const a = checkSentence(p.data.a_sentence_en, lemmas.a, lemmas.b);
  if (typeof a === 'string') return a;
  const b = checkSentence(p.data.b_sentence_en, lemmas.b, lemmas.a);
  if (typeof b === 'string') return b;
  const diff = cleanExampleText(p.data.difference_tr);
  if (!diff || !isCleanSentence(diff)) return 'bad_difference';
  if (diff.length < MIN_CONTRAST_DIFFERENCE_CHARS || diff.length > MAX_CONTRAST_DIFFERENCE_CHARS) return 'difference_length';
  if (!mentionsTerm(diff, lemmas.a) || !mentionsTerm(diff, lemmas.b)) return 'difference_terms';
  if (!isTurkishText(diff, `${lemmas.a} ${lemmas.b}`)) return 'not_turkish';
  return {
    a: { sentence_en: a.text, span: a.span, sentence_tr: cleanTranslation(p.data.a_sentence_tr) },
    b: { sentence_en: b.text, span: b.span, sentence_tr: cleanTranslation(p.data.b_sentence_tr) },
    difference_tr: diff,
  };
}

function sideOf(raw: unknown, senseId: string): ContrastSide | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const span = s.span;
  if (
    typeof s.lemma !== 'string' ||
    typeof s.sentence_en !== 'string' ||
    !Array.isArray(span) ||
    span.length !== 2 ||
    !span.every((n) => Number.isInteger(n))
  )
    return null;
  return {
    sense_id: senseId,
    lemma: s.lemma,
    sentence_en: s.sentence_en,
    span: [span[0] as number, span[1] as number],
    sentence_tr: typeof s.sentence_tr === 'string' && s.sentence_tr ? s.sentence_tr : null,
  };
}

/** A stored row as a contrast note; null for another kind or a malformed row. */
export function toContrastNote(row: LexiconPairNoteRow): ContrastNote | null {
  if (row.kind !== KIND || row.status !== 'active' || !row.sense_id) return null;
  const ids = row.content_key.split('|');
  if (ids.length !== 2 || ids[0] !== row.sense_id) return null;
  const c = row.content;
  const a = sideOf(c.a, ids[0]!);
  const b = sideOf(c.b, ids[1]!);
  if (!a || !b || typeof c.difference_tr !== 'string') return null;
  return { id: row.id, key: row.content_key, a, b, difference_tr: c.difference_tr, updated_at: row.updated_at };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export async function runContrast(body: unknown, deps: ContrastDeps): Promise<ContrastResponse> {
  const parsed = contrastRequest.safeParse(body);
  if (!parsed.success)
    throw new ApiError(
      'invalid_input',
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  const key = contrastKey(parsed.data.sense_ids[0], parsed.data.sense_ids[1]);
  const [idA, idB] = key.split('|') as [string, string];
  const entries = await deps.store.getEntries([idA, idB]);
  const ea = entries.find((e) => e.id === idA);
  const eb = entries.find((e) => e.id === idB);
  if (!ea || !eb) throw new ApiError('invalid_input', 'sense_ids: unknown lexicon sense');
  const base = { prompt_version: CONTRAST_PROMPT_VERSION, key };

  // 1. The shared table answers: a pair asked before costs no call, for every user.
  const stored = await findPair(deps.pairNotes, idA, key);
  if (stored) {
    return { ...base, ai_called: false, model: null, note: stored, counts: { dropped: {} }, usage: null };
  }

  // 2. Daily limit (only requests that call the model count).
  const usage = await deps.store.consumeAi(deps.userId, deps.dailyLimit);
  if (!usage.allowed)
    throw new ApiError('daily_limit', `Daily AI limit reached (${usage.used}/${usage.limit}).`);

  // 3. One model call with dictionary data of the two senses.
  let result;
  try {
    result = await deps.provider().generateJson({
      system: CONTRAST_SYSTEM_PROMPT,
      user: buildContrastUserPrompt(promptInput(ea), promptInput(eb)),
      schema: CONTRAST_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      validate: (d) => (contrastModelOutput.safeParse(d).success ? null : 'expected the contrast fields'),
      maxOutputTokens: CONTRAST_MAX_OUTPUT_TOKENS,
      timeoutMs: CONTRAST_TIMEOUT_MS,
    });
  } catch (e) {
    if (e instanceof AiError) throw new ApiError(e.code, e.message, e.retryAfterS);
    throw e;
  }

  // 4. Validation: an unusable answer is not stored (the next request may ask again).
  const valid = validateContrastOutput(result.data, { a: ea.lemma, b: eb.lemma });
  if (typeof valid === 'string') {
    deps.log?.('ai-contrast unusable answer', { model: result.model, reason: valid });
    throw new ApiError('ai_failed', `The model answer was not usable (${valid}).`);
  }

  // 5. Storage (insert-or-skip: a concurrent request for the same pair keeps the first row).
  const item: NewPairNote = {
    term_norm: ea.lemma_norm,
    sense_id: idA,
    lang_pair: 'en-tr',
    kind: KIND,
    content_key: key,
    content: {
      a: { lemma: ea.lemma, ...valid.a },
      b: { lemma: eb.lemma, ...valid.b },
      difference_tr: valid.difference_tr,
    },
    model: result.model,
    prompt_version: CONTRAST_PROMPT_VERSION,
  };
  await deps.pairNotes.insertNotes([item]);
  const note = await findPair(deps.pairNotes, idA, key);
  if (!note) throw new ApiError('internal', 'contrast note was not stored');

  deps.log?.('ai-contrast model call', { model: result.model, attempts: result.attempts, usage: result.usage });
  return {
    ...base,
    ai_called: true,
    model: result.model,
    note,
    counts: { dropped: {} },
    usage: { used: usage.used, limit: usage.limit },
  };
}

function promptInput(e: LexiconEntry) {
  return { lemma: e.lemma, pos: e.pos, gloss_en: e.gloss_en, meaning_tr: e.meaning_tr };
}

async function findPair(store: PairNoteStore, senseA: string, key: string): Promise<ContrastNote | null> {
  const rows = await store.findNotes([senseA], KIND);
  for (const r of rows) {
    if (r.content_key !== key) continue;
    const note = toContrastNote(r);
    if (note) return note;
  }
  return null;
}
