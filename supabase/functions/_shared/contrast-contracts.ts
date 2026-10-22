// Contracts of the ai-contrast edge function (v0.3 İP6, docs/decisions/0026). Imported by the
// function (Deno) and by the web client (src/ai/, src/domain/), so both sides share the
// request/response schemas, the key and the limits.

import { z } from 'zod';
import { usageInfo } from './contracts.ts';

/** Version of the contrast prompt and response schema. Bump with every change (contrast-prompt.ts). */
export const CONTRAST_PROMPT_VERSION = 'contrast-v1';

/** Server validation of one example sentence (characters). */
export const MIN_CONTRAST_SENTENCE_CHARS = 12;
export const MAX_CONTRAST_SENTENCE_CHARS = 180;
/** Server validation of the one-line difference (characters). */
export const MIN_CONTRAST_DIFFERENCE_CHARS = 12;
export const MAX_CONTRAST_DIFFERENCE_CHARS = 220;

/** Lexicon ids: UUIDs in production, short ids in the in-memory test store. */
const senseId = z.string().regex(/^[0-9A-Za-z-]{1,64}$/);

/**
 * Key of a pair of lexicon senses: the two ids sorted and joined with "|". The same pair
 * asked in any order, by any user, has one key (and one row in lexicon_pair_notes).
 */
export function contrastKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

export const contrastRequest = z
  .object({
    /** Two lexicon_senses ids. The server reads lemma and meanings itself; nothing else is sent. */
    sense_ids: z.tuple([senseId, senseId]),
  })
  .refine((r) => r.sense_ids[0] !== r.sense_ids[1], { message: 'two different senses', path: ['sense_ids'] });
export type ContrastRequest = z.input<typeof contrastRequest>;

/** One side of a contrast card. */
export const contrastSide = z.object({
  /** lexicon_senses.id */
  sense_id: z.string(),
  lemma: z.string(),
  /** A short English sentence that uses the term in this sense. */
  sentence_en: z.string(),
  /** [start, end) of the term in sentence_en (computed by the server). */
  span: z.tuple([z.number().int(), z.number().int()]),
  /** Turkish translation of sentence_en. */
  sentence_tr: z.string().nullable(),
});
export type ContrastSide = z.infer<typeof contrastSide>;

/** The shared content of a contrast card (a lexicon_pair_notes row of kind 'contrast'). */
export const contrastNote = z.object({
  /** lexicon_pair_notes.id */
  id: z.string(),
  /** contrastKey of the two senses. */
  key: z.string(),
  /** a = the sense with the smaller id. */
  a: contrastSide,
  b: contrastSide,
  /** The difference in one Turkish line. */
  difference_tr: z.string(),
  /** epoch ms */
  updated_at: z.number(),
});
export type ContrastNote = z.infer<typeof contrastNote>;

export const contrastResponse = z.object({
  prompt_version: z.string(),
  ai_called: z.boolean(),
  model: z.string().nullable(),
  key: z.string(),
  note: contrastNote,
  counts: z.object({
    /** model answers the server discarded, by reason */
    dropped: z.record(z.string(), z.number()),
  }),
  usage: usageInfo.nullable(),
});
export type ContrastResponse = z.infer<typeof contrastResponse>;
