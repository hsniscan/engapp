// Kelime Bankası (word bank, decision 0038): the shape of a public.word_bank row as devices
// pull it, shared by the job that writes the rows (scripts/lib/word-bank-*.ts) and the app
// that reads them (src/data/wordBank.ts). System content only: never user text.

import { z } from 'zod';
import { findGappedSpan, findSpan } from './locate.ts';

export const WORDBANK_PROMPT_VERSION = 'wordbank-v1';

/** Parts of speech of the reference lists (ref_word_levels.pos). */
export const WORDBANK_POS = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'preposition',
  'conjunction',
  'pronoun',
  'determiner',
  'interjection',
  'other',
] as const;
export type WordBankPos = (typeof WORDBANK_POS)[number];

export const WORDBANK_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

/** At most this many meanings per word (most common first). */
export const WORDBANK_MAX_SENSES = 3;

export const wordBankSenseSchema = z.object({
  meaning_tr: z.string().trim().min(1).max(120),
  example_en: z.string().trim().min(3).max(240),
  example_tr: z.string().trim().min(2).max(300),
  /** The shared lexicon sense, or null when it could not be stored. */
  sense_id: z.uuid().nullable(),
});
export type WordBankSense = z.infer<typeof wordBankSenseSchema>;

/** The columns a device reads (grant in 20261026001100_word_bank.sql). */
export const wordBankRowSchema = z.object({
  lemma_norm: z.string().min(1).max(120),
  pos: z.enum(WORDBANK_POS),
  lemma: z.string().min(1).max(120),
  cefr: z.enum(WORDBANK_LEVELS),
  list_source: z.enum(['cefrj', 'octanove']),
  zipf: z.coerce.number().min(0).max(9).nullable(),
  lexicon_term_id: z.uuid().nullable(),
  senses: z.array(wordBankSenseSchema).min(1).max(WORDBANK_MAX_SENSES),
  retired: z.boolean(),
  server_seq: z.coerce.number().int().nonnegative(),
});
export type WordBankRow = z.infer<typeof wordBankRowSchema>;

/** The select list of a pull (only the granted columns). */
export const WORDBANK_COLUMNS =
  'lemma_norm,pos,lemma,cefr,list_source,zipf,lexicon_term_id,senses,retired,server_seq';

/** Rows per pull page. */
export const WORDBANK_PAGE = 1000;

/**
 * Loose "same word" test for regular inflections: apple → apples, use → used, study →
 * studies, run → running, big → bigger. Irregular forms (go → went) are not accepted: the
 * prompt asks for the base form or a regular ending.
 */
function sameWordLoose(sentenceWord: string, termWord: string): boolean {
  if (sentenceWord === termWord) return true;
  if (termWord.length < 3) return false;
  const stem = termWord.replace(/(e|y)$/u, '');
  return sentenceWord.startsWith(stem) && sentenceWord.length - termWord.length <= 4;
}

/**
 * Where the word occurs in an example sentence, as [start, end): the exact form, case- and
 * typography-insensitive, separable phrasal verbs, then regular inflections. Null when the
 * sentence does not contain the word (the example is then rejected).
 */
export function exampleSpan(sentence: string, lemma: string): [number, number] | null {
  const t = lemma.trim();
  if (!sentence.trim() || !t) return null;
  return findSpan(sentence, t) ?? findGappedSpan(sentence, t, 4, sameWordLoose);
}
