// Prompt wordbank-v1 (Claude Haiku, Message Batches): Turkish meaning(s) and one short example
// sentence with its Turkish translation per meaning, for one word of the reference lists
// (decision 0038, docs/ai-pipeline.md "Word bank"). Meanings the shared lexicon already has are
// given to the model and never regenerated (AGENTS.md rule 6): it only writes their examples.
// Only the word, its part of speech, its level and those dictionary meanings are sent.

import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { answerText, type ModelMessage } from '../../supabase/functions/_shared/image-prompt.ts';
import {
  glossKey,
  isCleanLexiconText,
  isDuplicateSense,
} from '../../supabase/functions/_shared/text.ts';
import {
  exampleSpan,
  WORDBANK_MAX_SENSES,
  WORDBANK_PROMPT_VERSION,
} from '../../supabase/functions/_shared/wordbank-contract.ts';

export { WORDBANK_PROMPT_VERSION };

export const WORDBANK_MAX_TOKENS = 3000;

/** A lexicon sense handed to the model as fixed (its meaning is not regenerated). */
export interface GivenSense {
  sense_id: string;
  meaning_tr: string;
}

/** What one request is built from (stored on the job row while the batch runs). */
export interface WordInput {
  lemma_norm: string;
  pos: string;
  cefr: string;
  /** Lexicon senses for this lemma and part of speech that still need an example. */
  given: GivenSense[];
  /** The previous answer's problem, on a retry. */
  problem?: string | null;
}

export const WORDBANK_SYSTEM_PROMPT = `You write flashcard content for Turkish speakers who learn English words.

You receive one English word as JSON: lemma, pos (part of speech), level (CEFR level of the word) and sometimes given: meanings from our dictionary, each with a number n and a Turkish meaning.

If given is present: write one example for each given meaning, exactly as that Turkish meaning says. Do not add other meanings and do not change the given ones.

If given is absent: list the 1 to 3 most common meanings of the word for this part of speech, most common first. Meanings must really differ; never split synonyms into separate meanings: put up to three Turkish equivalents of one meaning together, separated by ", " (for "invitation": "davet, davetiye", not two meanings). Skip rare, technical and slang meanings. For each meaning give:
- meaning_tr: the Turkish meaning, short, lower case unless a proper noun, no explanations in brackets.
- gloss_en: a short English definition of that meaning (at most 12 words).

For every meaning write:
- example_en: one natural, simple English sentence of at most 12 words that a learner at the given level understands. It must contain the word itself, either unchanged or with a regular ending (-s, -es, -ed, -d, -ing, -er, -est). Do not use irregular forms (went, children, better). The sentence must show this meaning, not another one.
- example_tr: a natural Turkish translation of example_en.

Content: everyday, neutral situations. No real people, brands, politics, religion, violence or adult topics.

Answer with JSON only: {"lemma": string, "senses": [{"given": number, "meaning_tr": string, "gloss_en": string, "example_en": string, "example_tr": string}]}. lemma: the word as it is normally written (capital letter only for days, months, languages and the like). given: the number n of the given meaning, or 0 for a meaning you listed yourself; for a given meaning, meaning_tr and gloss_en may be "".`;

export const WORDBANK_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lemma', 'senses'],
  properties: {
    lemma: { type: 'string' },
    senses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['given', 'meaning_tr', 'gloss_en', 'example_en', 'example_tr'],
        properties: {
          given: { type: 'integer' },
          meaning_tr: { type: 'string' },
          gloss_en: { type: 'string' },
          example_en: { type: 'string' },
          example_tr: { type: 'string' },
        },
      },
    },
  },
} as const;

/** What a rejected answer did wrong, told to the model on the retry. */
const PROBLEM_TEXT: Record<string, string> = {
  example_without_word: 'an example sentence did not contain the word (or used an irregular form)',
  example_en_unfit: 'an English example was too long or not plain text',
  example_tr_unfit: 'a Turkish translation was missing, too long or not plain text',
  example_not_translated: 'a translation repeated the English sentence',
  meaning_tr_unfit: 'a Turkish meaning was empty, too long or had brackets or symbols',
  gloss_en_unfit: 'an English definition was empty or too long',
  duplicate_meaning: 'two meanings were the same',
  unknown_given: 'an answer referred to a given meaning that does not exist',
  schema: 'the JSON did not follow the format',
  not_json: 'the answer was not JSON',
  max_tokens: 'the answer was too long',
};

/** The problem text for a stored job error, or null when it was not about the answer. */
export function problemText(code: string | null | undefined): string | null {
  return (code && PROBLEM_TEXT[code]) || null;
}

/** The user turn: the word, its level and the given meanings (numbered); nothing else. */
export function wordUserContent(w: WordInput): string {
  const body: Record<string, unknown> = { lemma: w.lemma_norm, pos: w.pos, level: w.cefr };
  if (w.given.length > 0)
    body.given = w.given.map((g, i) => ({ n: i + 1, meaning_tr: g.meaning_tr }));
  const problem = problemText(w.problem);
  if (problem) body.note = `A previous answer was rejected because ${problem}. Avoid that.`;
  return JSON.stringify(body);
}

export function buildWordRequest(
  w: WordInput,
  opts: { model: string },
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: opts.model,
    max_tokens: WORDBANK_MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: WORDBANK_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      },
    },
    system: [{ type: 'text', text: WORDBANK_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: wordUserContent(w) }],
  };
}

const answerSchema = z.object({
  lemma: z.string(),
  senses: z
    .array(
      z.object({
        given: z.number().int(),
        meaning_tr: z.string(),
        gloss_en: z.string(),
        example_en: z.string(),
        example_tr: z.string(),
      }),
    )
    .max(8),
});

/** One checked meaning of an answer. `given`: the lexicon sense it belongs to, else new. */
export interface ParsedSense {
  given: GivenSense | null;
  meaning_tr: string;
  /** New meanings only (for the lexicon). */
  gloss_en: string | null;
  gloss_key: string | null;
  example_en: string;
  example_tr: string;
}

export type ParsedWord =
  | { kind: 'ok'; lemma: string; senses: ParsedSense[]; dropped: string[] }
  | { kind: 'invalid'; reason: string };

const LINKISH = /https?:|www\.|:\/\/|@|[<>{}`\\|[\]]/u;
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/u;
const clean = (s: string) => s.replace(/\s+/gu, ' ').trim();

/** Plain sentence text: no markup, links or invisible characters; a sane length. */
export function isCleanSentence(s: string, max = 240): boolean {
  return s.length >= 2 && s.length <= max && !LINKISH.test(s) && !INVISIBLE.test(s);
}

const MAX_WORDS = 20;

/** Problems of one example pair, or null when it is fine. */
export function exampleProblem(lemma: string, en: string, tr: string): string | null {
  if (!isCleanSentence(en) || en.split(' ').length > MAX_WORDS) return 'example_en_unfit';
  if (!isCleanSentence(tr, 300)) return 'example_tr_unfit';
  if (!exampleSpan(en, lemma)) return 'example_without_word';
  if (en.toLowerCase() === tr.toLowerCase()) return 'example_not_translated';
  return null;
}

/**
 * Reads and checks one answer: the JSON schema, a Turkish meaning for every new meaning, every
 * example containing the word (or a regular inflection), no near-duplicate meanings (the same
 * part of speech with an overlapping Turkish meaning, "davet" ~ "davetiye, davet"), at most
 * WORDBANK_MAX_SENSES. A meaning that fails is dropped (named in `dropped`); an answer with no
 * meaning left is invalid. Never throws.
 */
export function parseWordAnswer(message: ModelMessage, w: WordInput): ParsedWord {
  if (message.stop_reason === 'refusal') return { kind: 'invalid', reason: 'refusal' };
  if (message.stop_reason === 'max_tokens') return { kind: 'invalid', reason: 'max_tokens' };
  let raw: unknown;
  try {
    raw = JSON.parse(answerText(message));
  } catch {
    return { kind: 'invalid', reason: 'not_json' };
  }
  const a = answerSchema.safeParse(raw);
  if (!a.success) return { kind: 'invalid', reason: 'schema' };

  const lemmaOut = clean(a.data.lemma);
  const lemma =
    lemmaOut.toLowerCase() === w.lemma_norm && lemmaOut.length <= 120 ? lemmaOut : w.lemma_norm;
  const out: ParsedSense[] = [];
  const dropped: string[] = [];
  const usedGiven = new Set<number>();
  for (const s of a.data.senses) {
    const en = clean(s.example_en);
    const tr = clean(s.example_tr);
    const problem = exampleProblem(w.lemma_norm, en, tr);
    if (w.given.length > 0) {
      const g = w.given[s.given - 1];
      if (!g || usedGiven.has(s.given)) {
        dropped.push('unknown_given');
        continue;
      }
      if (problem) {
        dropped.push(problem);
        continue;
      }
      usedGiven.add(s.given);
      out.push({
        given: g,
        meaning_tr: g.meaning_tr,
        gloss_en: null,
        gloss_key: null,
        example_en: en,
        example_tr: tr,
      });
      continue;
    }
    // A word without dictionary meanings: every meaning is new.
    const meaning = clean(s.meaning_tr).replace(/\s*,\s*/g, ', ');
    const gloss = clean(s.gloss_en);
    const key = glossKey(gloss);
    if (!meaning || meaning.length > 120 || !isCleanLexiconText(meaning, 'tr')) {
      dropped.push('meaning_tr_unfit');
      continue;
    }
    if (!gloss || gloss.length > 200 || !key || !isCleanLexiconText(gloss, 'en')) {
      dropped.push('gloss_en_unfit');
      continue;
    }
    if (problem) {
      dropped.push(problem);
      continue;
    }
    const me = { pos: w.pos, meaning_tr: meaning };
    if (
      out.some(
        (o) =>
          isDuplicateSense(me, { pos: w.pos, meaning_tr: o.meaning_tr }) || o.gloss_key === key,
      )
    ) {
      dropped.push('duplicate_meaning');
      continue;
    }
    out.push({
      given: null,
      meaning_tr: meaning,
      gloss_en: gloss,
      gloss_key: key,
      example_en: en,
      example_tr: tr,
    });
  }
  const senses = out.slice(0, WORDBANK_MAX_SENSES);
  if (senses.length === 0) return { kind: 'invalid', reason: dropped[0] ?? 'no_senses' };
  return { kind: 'ok', lemma, senses, dropped };
}
