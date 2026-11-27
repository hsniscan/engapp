// The word bank's example as a sense's main example (2026-11-26 review #5). Imported cards
// often carry a weak source sentence: no Turkish translation, a fragment ("ugly face") or a
// sentence about another sense ("Root beer…" for root = kök). When the sense matches a word
// bank sense, the bank's checked sentence with its translation leads and the user's own
// sentence comes second ("Senin örneğin"). A full sentence the user translated stays first.
// Pure: reads only what the caller passes; nothing is ever written to the shared content.
import { exampleSpan } from '../../supabase/functions/_shared/wordbank-contract';
import type { Span } from './recognition';
import type { Sense } from './types';
import type { WordBankEntry } from './wordBank';

export interface BankExample {
  text: string;
  tr: string;
  span: Span;
}

const WORDS = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

/**
 * A full sentence: at least four words, starting with a capital (or a digit or an opening
 * quote) and ending with . ! ? or … (a closing quote or bracket may follow).
 */
export function isFullSentence(raw: string | null | undefined): boolean {
  const s = raw?.trim() ?? '';
  if ((s.match(WORDS) ?? []).length < 4) return false;
  if (!/^["'“‘(]?[\p{Lu}\p{N}]/u.test(s)) return false;
  return /[.!?…]["'”’)]*$/u.test(s);
}

/** The user's own sentence can lead: a full sentence with the user's Turkish translation. */
export function ownSentenceLeads(sense: Pick<Sense, 'source_sentence' | 'source_sentence_tr'>): boolean {
  return !!sense.source_sentence_tr?.trim() && isFullSentence(sense.source_sentence);
}

/** Turkish meaning parts: "kök, köken; (bitki) kökü" → {kök, köken, kökü}. */
export function meaningParts(meaning: string): Set<string> {
  return new Set(
    meaning
      .replace(/\([^)]*\)/g, ' ')
      .split(/[,;/]/)
      .map((p) => p.toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim())
      .filter(Boolean),
  );
}

const overlaps = (a: Set<string>, b: Set<string>) => [...a].some((x) => b.has(x));

type SenseLike = Pick<Sense, 'lexicon_sense_id' | 'pos' | 'meaning_tr' | 'meaning_tr_override'>;

/**
 * The bank example for one of the note's senses, or null. A sense is matched to a bank sense
 * by its shared lexicon id, else by a common meaning part among the bank rows of the same
 * part of speech (any, when the sense has none), else, for a note with one sense, when the
 * bank has exactly one sense for the word. The sentence must contain the term.
 */
export function bankExampleFor(
  term: string,
  sense: SenseLike,
  senseCount: number,
  entries: readonly Pick<WordBankEntry, 'pos' | 'senses'>[],
): BankExample | null {
  const pos = sense.pos?.toLowerCase() ?? null;
  const all = entries.flatMap((e) => e.senses.map((s) => ({ pos: e.pos, s })));
  const samePos = pos ? all.filter((x) => x.pos === pos) : all;
  const mine = meaningParts(sense.meaning_tr_override ?? sense.meaning_tr);
  const hit =
    (sense.lexicon_sense_id && all.find((x) => x.s.sense_id === sense.lexicon_sense_id)) ||
    samePos.find((x) => overlaps(meaningParts(x.s.meaning_tr), mine)) ||
    (senseCount === 1 && samePos.length === 1 ? samePos[0] : undefined);
  if (!hit) return null;
  const text = hit.s.example_en.trim();
  const tr = hit.s.example_tr.trim();
  const span = exampleSpan(text, term);
  return text && tr && span ? { text, tr, span } : null;
}

/**
 * The bank example that should lead for this sense: only when the user's own sentence is
 * missing or weak (see ownSentenceLeads) and it is not the same sentence.
 */
export function leadingBankExample(
  term: string,
  sense: SenseLike & Pick<Sense, 'source_sentence' | 'source_sentence_tr'>,
  senseCount: number,
  entries: readonly Pick<WordBankEntry, 'pos' | 'senses'>[],
): BankExample | null {
  if (ownSentenceLeads(sense)) return null;
  const ex = bankExampleFor(term, sense, senseCount, entries);
  if (!ex) return null;
  const own = sense.source_sentence?.trim().toLowerCase();
  return own && own === ex.text.toLowerCase() ? null : ex;
}
