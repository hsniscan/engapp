// ai-mnemonic pipeline (v0.3 İP2, docs/decisions/0020): Turkish mnemonic suggestions for one
// lexicon sense, written once and shared by every user through public.lexicon_pair_notes
// (kind 'mnemonic_suggestion', pair 'en-tr').
//
//   lexicon lookup (lemma, pos, gloss, meaning of the sense id)
//   -> shared suggestions first (no model call, no budget, also when the model found none)
//   -> daily limit -> one model call (stored suggestions as AVOID on "Başka öner")
//   -> validation -> insert-or-skip -> response
//
// Privacy: the request carries only a lexicon sense id. The model gets dictionary data from
// the lexicon, never user text. What the user picks, edits or writes stays in the user's own
// user_content rows on the device and in their account; it never reaches this function.

import { AiError } from './ai-provider.ts';
import { ApiError } from './errors.ts';
import { cleanExampleText, exampleTextKey, isCleanSentence, isNearDuplicateSentence, locateExampleTerm } from './examples.ts';
import type { PipelineDeps } from './extract.ts';
import {
  MAX_MNEMONIC_CHARS,
  MAX_MNEMONIC_WHY_CHARS,
  MAX_MNEMONICS_PER_CALL,
  MAX_MNEMONICS_PER_SENSE,
  MIN_MNEMONIC_CHARS,
  MNEMONIC_NONE_KEY,
  MNEMONIC_PROMPT_VERSION,
  MNEMONIC_TYPES,
  mnemonicRequest,
  type MnemonicResponse,
  type MnemonicSuggestion,
  type MnemonicType,
} from './mnemonic-contracts.ts';
import {
  buildMnemonicUserPrompt,
  MNEMONIC_RESPONSE_SCHEMA,
  MNEMONIC_SYSTEM_PROMPT,
  mnemonicModelItem,
  mnemonicModelOutput,
} from './mnemonic-prompt.ts';
import type { LexiconPairNoteRow, NewPairNote, PairNoteStore } from './pair-notes.ts';

export interface MnemonicDeps extends PipelineDeps {
  pairNotes: PairNoteStore;
}

export const MNEMONIC_MAX_OUTPUT_TOKENS = 1024;
export const MNEMONIC_TIMEOUT_MS = 30_000;
const KIND = 'mnemonic_suggestion' as const;

export type MnemonicDropReason =
  | 'invalid_shape'
  | 'bad_type'
  | 'bad_text'
  | 'too_short'
  | 'too_long'
  | 'term_missing'
  | 'not_turkish'
  | 'duplicate'
  | 'extra';

// ---------------------------------------------------------------------------
// Checks (pure; also used by the tests)
// ---------------------------------------------------------------------------

/** Turkish words that appear in almost any Turkish sentence. */
const TURKISH_WORDS = new Set(
  'bir ve ile gibi bu şu o için çok da de ki ne ben sen biz siz onlar her hiç olan olarak kadar daha en mi mı mu mü değil var yok ama ya hem diye sonra önce gibi gibisin sanki iken çünkü eğer kendi başka'.split(
    ' ',
  ),
);
/** English words that are not also Turkish words; two of them mean an English sentence. */
const ENGLISH_WORDS = new Set(
  'the and is are of to that it with for this you was were be been by not or he she they we his her which when will would has have like from their there'.split(
    ' ',
  ),
);
const TURKISH_LETTER = /[çğıöşüÇĞİÖŞÜ]/u;

/** Words of a text, lower-cased the Turkish way, apostrophes split ("reluctant'ın" -> reluctant, ın). */
function words(text: string): string[] {
  return text
    .normalize('NFC')
    .toLocaleLowerCase('tr')
    .split(/[^\p{L}\p{M}]+/u)
    .filter(Boolean);
}

/**
 * Does the text mention the English term (any inflection, also with a Turkish suffix after an
 * apostrophe: "reluctant'ın")? Slots like "sth" need not appear.
 */
export function mentionsTerm(text: string, lemma: string): boolean {
  const plain = text.replace(/['’‘`´]/g, ' ');
  return locateExampleTerm(plain, lemma, '') !== null;
}

/**
 * Is the text Turkish (apart from the English term in it)? At least three other words, a
 * Turkish letter or a common Turkish word, and at most one English-only function word.
 */
export function isTurkishText(text: string, lemma: string): boolean {
  const termWords = new Set(words(lemma));
  const rest = words(text).filter((w) => !termWords.has(w));
  if (rest.length < 3) return false;
  const english = rest.filter((w) => ENGLISH_WORDS.has(w)).length;
  if (english >= 2) return false;
  return TURKISH_LETTER.test(rest.join(' ')) || rest.some((w) => TURKISH_WORDS.has(w));
}

/** The "why" note: cleaned, or null when empty, too long or not clean Turkish text. */
export function cleanWhy(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = cleanExampleText(raw);
  if (!v || v.length > MAX_MNEMONIC_WHY_CHARS || !isCleanSentence(v)) return null;
  return v;
}

export interface ValidMnemonic {
  type: MnemonicType;
  text_tr: string;
  why: string | null;
  key: string;
}

/**
 * Checks every item the model returned. Never throws; an invalid item is dropped and
 * counted, the others are kept (at most MAX_MNEMONICS_PER_CALL).
 */
export function validateMnemonicOutput(
  items: readonly unknown[],
  input: { lemma: string; existing: readonly string[] },
  onDrop: (reason: MnemonicDropReason) => void = () => {},
): ValidMnemonic[] {
  const out: ValidMnemonic[] = [];
  for (const raw of items) {
    const p = mnemonicModelItem.safeParse(raw);
    if (!p.success) {
      onDrop('invalid_shape');
      continue;
    }
    const type = p.data.type.trim().toLowerCase();
    if (!(MNEMONIC_TYPES as readonly string[]).includes(type)) {
      onDrop('bad_type');
      continue;
    }
    const text = cleanExampleText(p.data.text_tr);
    if (!text || !isCleanSentence(text)) {
      onDrop('bad_text');
      continue;
    }
    if (text.length < MIN_MNEMONIC_CHARS) {
      onDrop('too_short');
      continue;
    }
    if (text.length > MAX_MNEMONIC_CHARS) {
      onDrop('too_long');
      continue;
    }
    if (!mentionsTerm(text, input.lemma)) {
      onDrop('term_missing');
      continue;
    }
    if (!isTurkishText(text, input.lemma)) {
      onDrop('not_turkish');
      continue;
    }
    const before = [...input.existing, ...out.map((o) => o.text_tr)];
    if (before.some((b) => isNearDuplicateSentence(b, text))) {
      onDrop('duplicate');
      continue;
    }
    if (out.length >= MAX_MNEMONICS_PER_CALL) {
      onDrop('extra');
      continue;
    }
    out.push({
      type: type as MnemonicType,
      text_tr: text,
      why: cleanWhy(p.data.why),
      key: exampleTextKey(text).slice(0, 120),
    });
  }
  return out;
}

/** A stored row as a suggestion; null for the "no association" marker or a malformed row. */
export function toSuggestion(row: LexiconPairNoteRow): MnemonicSuggestion | null {
  if (row.kind !== KIND || row.status !== 'active' || !row.sense_id) return null;
  const c = row.content;
  const type = typeof c.type === 'string' ? c.type : '';
  if (!(MNEMONIC_TYPES as readonly string[]).includes(type) || typeof c.text_tr !== 'string') return null;
  return {
    id: row.id,
    sense_id: row.sense_id,
    type: type as MnemonicType,
    text_tr: c.text_tr,
    why: typeof c.why === 'string' && c.why ? c.why : null,
    updated_at: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export async function runMnemonic(body: unknown, deps: MnemonicDeps): Promise<MnemonicResponse> {
  const parsed = mnemonicRequest.safeParse(body);
  if (!parsed.success)
    throw new ApiError(
      'invalid_input',
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  const { sense_id: senseId, more } = parsed.data;
  const entry = (await deps.store.getEntries([senseId])).find((e) => e.id === senseId);
  if (!entry) throw new ApiError('invalid_input', 'sense_id: unknown lexicon sense');

  const rows = await deps.pairNotes.findNotes([senseId], KIND);
  const suggestions = rows.map(toSuggestion).filter((s): s is MnemonicSuggestion => s !== null);
  const asked = rows.length > 0;
  const exhausted = suggestions.length >= MAX_MNEMONICS_PER_SENSE;
  const base = { prompt_version: MNEMONIC_PROMPT_VERSION, sense_id: senseId };

  // 1. The shared table answers: a sense asked before (also "no good association") costs no call.
  if ((asked && !more) || exhausted) {
    return {
      ...base,
      ai_called: false,
      model: null,
      suggestions,
      new_ids: [],
      none: suggestions.length === 0,
      exhausted,
      counts: { generated: 0, dropped: {} },
      usage: null,
    };
  }

  // 2. Daily limit (only requests that call the model count).
  const usage = await deps.store.consumeAi(deps.userId, deps.dailyLimit);
  if (!usage.allowed)
    throw new ApiError('daily_limit', `Daily AI limit reached (${usage.used}/${usage.limit}).`);

  // 3. One model call; the stored suggestions are not to be repeated.
  const avoid = suggestions.map((s) => s.text_tr);
  let result;
  try {
    result = await deps.provider().generateJson({
      system: MNEMONIC_SYSTEM_PROMPT,
      user: buildMnemonicUserPrompt(entry, avoid),
      schema: MNEMONIC_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      validate: (d) => (mnemonicModelOutput.safeParse(d).success ? null : 'expected {mnemonics: [...]}'),
      maxOutputTokens: MNEMONIC_MAX_OUTPUT_TOKENS,
      timeoutMs: MNEMONIC_TIMEOUT_MS,
    });
  } catch (e) {
    if (e instanceof AiError) throw new ApiError(e.code, e.message, e.retryAfterS);
    throw e;
  }

  // 4. Validation and storage.
  const dropped: Record<string, number> = {};
  const valid = validateMnemonicOutput(
    mnemonicModelOutput.parse(result.data).mnemonics,
    { lemma: entry.lemma, existing: avoid },
    (reason) => {
      dropped[reason] = (dropped[reason] ?? 0) + 1;
    },
  );
  const room = Math.max(0, MAX_MNEMONICS_PER_SENSE - suggestions.length);
  const note = (key: string, content: Record<string, unknown>): NewPairNote => ({
    term_norm: entry.lemma_norm,
    sense_id: senseId,
    lang_pair: 'en-tr',
    kind: KIND,
    content_key: key,
    content,
    model: result.model,
    prompt_version: MNEMONIC_PROMPT_VERSION,
  });
  const items: NewPairNote[] = valid
    .slice(0, room)
    .map((v) => note(v.key, { type: v.type, text_tr: v.text_tr, why: v.why }));
  // Nothing usable on the first request: remember that, so the next request is free too.
  if (items.length === 0 && !asked) items.push(note(MNEMONIC_NONE_KEY, { type: 'none' }));
  const inserted = await deps.pairNotes.insertNotes(items);
  const newIds = inserted.flatMap((r) => (toSuggestion(r) ? [r.id] : []));
  const after = (await deps.pairNotes.findNotes([senseId], KIND))
    .map(toSuggestion)
    .filter((s): s is MnemonicSuggestion => s !== null);

  deps.log?.('ai-mnemonic model call', {
    model: result.model,
    attempts: result.attempts,
    more,
    generated: newIds.length,
    dropped,
    usage: result.usage,
  });
  return {
    ...base,
    ai_called: true,
    model: result.model,
    suggestions: after,
    new_ids: newIds,
    none: after.length === 0,
    exhausted: after.length >= MAX_MNEMONICS_PER_SENSE,
    counts: { generated: newIds.length, dropped },
    usage: { used: usage.used, limit: usage.limit },
  };
}
