// Contracts of the ai-mnemonic edge function (v0.3 İP2, docs/decisions/0020). Imported by
// the function (Deno) and by the web client (src/ai/, src/domain/), so both sides share the
// request/response schemas and the limits.

import { z } from 'zod';
import { usageInfo } from './contracts.ts';

/** Version of the mnemonic prompt and response schema. Bump with every change (mnemonic-prompt.ts). */
export const MNEMONIC_PROMPT_VERSION = 'mnemonic-v1';

/**
 * Kinds of association: a Turkish word that sounds like the English one ("sound"), a short
 * situation ("story"), a picture in the mind ("image").
 */
export const MNEMONIC_TYPES = ['sound', 'story', 'image'] as const;
export type MnemonicType = (typeof MNEMONIC_TYPES)[number];

/** Suggestions one model call may add ("AI iki çağrışım önerir"). */
export const MAX_MNEMONICS_PER_CALL = 2;
/**
 * Suggestions a sense keeps in the shared table. When reached, "Başka öner" answers from the
 * table without a model call (`exhausted`).
 */
export const MAX_MNEMONICS_PER_SENSE = 10;
/** Server validation of one suggestion (characters). */
export const MIN_MNEMONIC_CHARS = 12;
export const MAX_MNEMONIC_CHARS = 220;
export const MAX_MNEMONIC_WHY_CHARS = 160;
/** Longest mnemonic the user can write or edit (stays in user_content, never shared). */
export const MAX_USER_MNEMONIC_CHARS = 300;

/**
 * content_key of the marker row stored when the model found no good association for a sense
 * on the first request: the next request for the sense is answered from the table too
 * ("aynı anlam ikinci kez 0 çağrı"). Never shown to a client.
 */
export const MNEMONIC_NONE_KEY = '-none-';

/** Lexicon ids: UUIDs in production, short ids in the in-memory test store. */
const senseId = z.string().regex(/^[0-9A-Za-z-]{1,64}$/);

export const mnemonicRequest = z.object({
  /** lexicon_senses.id. The server reads term, part of speech, gloss and meaning itself. */
  sense_id: senseId,
  /**
   * "Başka öner": ask the model for new suggestions even when the sense has some. The
   * server passes the stored suggestions to the model so it does not repeat them.
   */
  more: z.boolean().default(false),
});
export type MnemonicRequest = z.input<typeof mnemonicRequest>;

/** A shared suggestion (a lexicon_pair_notes row of kind 'mnemonic_suggestion'). */
export const mnemonicSuggestion = z.object({
  /** lexicon_pair_notes.id (the user's pick and rejection point at it). */
  id: z.string(),
  /** lexicon_senses.id */
  sense_id: z.string(),
  type: z.enum(MNEMONIC_TYPES),
  text_tr: z.string(),
  /** Short Turkish note on what links the word to the mnemonic. */
  why: z.string().nullable(),
  /** epoch ms */
  updated_at: z.number(),
});
export type MnemonicSuggestion = z.infer<typeof mnemonicSuggestion>;

export const mnemonicResponse = z.object({
  prompt_version: z.string(),
  ai_called: z.boolean(),
  model: z.string().nullable(),
  sense_id: z.string(),
  /** Every stored suggestion of the sense, oldest first. */
  suggestions: z.array(mnemonicSuggestion),
  /** Suggestions written by this request. */
  new_ids: z.array(z.string()),
  /** The sense was asked before and the model found no good association: no suggestion at all. */
  none: z.boolean(),
  /** The sense has MAX_MNEMONICS_PER_SENSE suggestions: "Başka öner" asks the model no more. */
  exhausted: z.boolean(),
  counts: z.object({
    generated: z.number(),
    /** suggestions the server discarded, by reason */
    dropped: z.record(z.string(), z.number()),
  }),
  usage: usageInfo.nullable(),
});
export type MnemonicResponse = z.infer<typeof mnemonicResponse>;
