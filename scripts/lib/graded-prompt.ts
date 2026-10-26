// Prompts of the graded library (decision 0047, docs/ai-pipeline.md "Graded library"):
//   graded-v1       (Claude Sonnet, Message Batches) writes one text for a plan slot: title,
//                   sentences with their Turkish translations, target words, glosses.
//   gradedcheck-v1  (Claude Haiku, Message Batches) reads a written text that passed the
//                   coverage check: natural, at its level, safe, factual, nothing copyrighted.
// Only the plan item (level, topic, angle, text type, length) and, on a rewrite, the words to
// avoid are sent; never anything a user wrote (plan criterion 10).

import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { answerText, type ModelMessage } from '../../supabase/functions/_shared/image-prompt.ts';
import {
  GRADED_CHECK_VERSION,
  GRADED_PROMPT_VERSION,
  type GradedLevel,
} from '../../supabase/functions/_shared/graded-contract.ts';
import { TOPIC_HINTS, type PlanItem } from './graded-plan.ts';

export { GRADED_CHECK_VERSION, GRADED_PROMPT_VERSION };

/** Output budget per level (adaptive thinking at effort low + the JSON with translations). */
export const GRADED_MAX_TOKENS: Readonly<Record<GradedLevel, number>> = {
  A2: 6000,
  B1: 7000,
  B2: 8000,
  C1: 10000,
};
export const CHECK_MAX_TOKENS = 3000;

/** What one writer request is built from (graded_jobs.input). */
export interface WriterInput extends PlanItem {
  /** On the rewrite after a failed coverage check: words above the level to avoid. */
  avoid?: string[];
  /** Why the previous answer was rejected (a problem code). */
  problem?: string | null;
}

export const GRADED_SYSTEM_PROMPT = `You write graded reading texts for adult Turkish speakers who are learning English.

You receive one request as JSON: level (CEFR: A2, B1, B2 or C1), topic, angle (what the text is about), genre (the kind of text) and words (the length range in running words). A rewrite also has avoid (words that were too hard last time) and note (what went wrong).

Write one original text for that request.

Level:
- Use only vocabulary and grammar a learner at the given level knows well. At least 95 of every 100 running words must be words of that level or easier; at most 3 in 100 may be from the next level up.
- A word that is harder still may appear only if the text cannot do without it; then add it to glosses with a short Turkish meaning.
- Never use a word listed in avoid, in any form. Say the same thing with easier words.
- Grammar: A2 short simple sentences, present and past tenses; B1 linked sentences, common tenses; B2 varied sentences, some complex structures; C1 natural, rich and precise English.

Content:
- Timeless and fictional: no real news, no dates or events from recent years, no real living people, no brands or companies, no characters, plots or song lyrics from books, films, games or other works.
- People have ordinary first names from many countries.
- Facts must be well established and uncontroversial; explain them simply and correctly.
- No politics opinions, religion, violence, crime details, adult topics, medical advice beyond common sense, or anything that could upset a learner.
- Natural and interesting to an adult: a clear beginning, middle and end; specific details; no lists of facts; no moral lesson at the end.

Form:
- Length: between words.min and words.max running words.
- 2 to 6 paragraphs. The first sentence of each paragraph has new_paragraph true; every other sentence has false.
- sentences: one entry per sentence, in order. en: the English sentence. tr: a natural, fluent Turkish translation of that sentence (not word for word).
- title: a short English title (at most 8 words).
- target_lemmas: 5 to 8 useful words of exactly the given level that the text uses, in dictionary form (lower case).
- glosses: [{word, tr}] for the harder words you could not avoid (usually none).

Answer with JSON only: {"title": string, "sentences": [{"en": string, "tr": string, "new_paragraph": boolean}], "target_lemmas": [string], "glosses": [{"word": string, "tr": string}]}.`;

export const GRADED_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'sentences', 'target_lemmas', 'glosses'],
  properties: {
    title: { type: 'string' },
    sentences: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['en', 'tr', 'new_paragraph'],
        properties: {
          en: { type: 'string' },
          tr: { type: 'string' },
          new_paragraph: { type: 'boolean' },
        },
      },
    },
    target_lemmas: { type: 'array', items: { type: 'string' } },
    glosses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['word', 'tr'],
        properties: { word: { type: 'string' }, tr: { type: 'string' } },
      },
    },
  },
} as const;

const PROBLEM_TEXT: Record<string, string> = {
  at_level: 'too many words were above the level',
  next_level: 'too many words were from the next level up',
  above: 'some words were far above the level and not in glosses',
  too_short: 'the text was shorter than words.min',
  too_long: 'the text was longer than words.max',
  sentence_unfit: 'a sentence or translation was empty, too long or not plain text',
  not_translated: 'a translation repeated the English sentence',
  schema: 'the JSON did not follow the format',
  not_json: 'the answer was not JSON',
  max_tokens: 'the answer was too long',
};

export function problemText(code: string | null | undefined): string | null {
  return (code && PROBLEM_TEXT[code]) || null;
}

/** The user turn: the plan item and, on a rewrite, the words to avoid; nothing else. */
export function writerUserContent(w: WriterInput): string {
  const body: Record<string, unknown> = {
    level: w.level,
    topic: TOPIC_HINTS[w.topic],
    angle: w.angle,
    genre: w.genre,
    words: w.words,
  };
  if (w.avoid && w.avoid.length > 0) body.avoid = w.avoid.slice(0, 25);
  const problem = problemText(w.problem);
  if (problem) body.note = `A previous text was rejected because ${problem}. Avoid that.`;
  return JSON.stringify(body);
}

export function buildWriterRequest(
  w: WriterInput,
  opts: { model: string },
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: opts.model,
    max_tokens: GRADED_MAX_TOKENS[w.level],
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: GRADED_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      },
    },
    system: [{ type: 'text', text: GRADED_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: writerUserContent(w) }],
  };
}

const writerAnswer = z.object({
  title: z.string(),
  sentences: z
    .array(z.object({ en: z.string(), tr: z.string(), new_paragraph: z.boolean() }))
    .min(1)
    .max(160),
  target_lemmas: z.array(z.string()).max(30),
  glosses: z.array(z.object({ word: z.string(), tr: z.string() })).max(60),
});

export interface WrittenText {
  title: string;
  /** p: paragraph index. */
  sentences: { en: string; tr: string; p: number }[];
  target_lemmas: string[];
  glosses: { word: string; tr: string }[];
}

export type ParsedWriter = { kind: 'ok'; text: WrittenText } | { kind: 'invalid'; reason: string };

const LINKISH = /https?:|www\.|:\/\/|@|[<>{}`\\|[\]]/u;
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/u;
const clean = (s: string) => s.replace(/\s+/gu, ' ').trim();
const isPlain = (s: string, max: number) =>
  s.length >= 1 && s.length <= max && !LINKISH.test(s) && !INVISIBLE.test(s);

/**
 * Reads and checks one writer answer (not the coverage: graded-coverage.ts does that): the
 * JSON schema, plain sentences with real translations, a title, the length range. Target
 * words are kept only if the text uses them; glosses are trimmed. Never throws.
 */
export function parseWriterAnswer(message: ModelMessage, w: WriterInput, words: (sentences: string[]) => number): ParsedWriter {
  if (message.stop_reason === 'refusal') return { kind: 'invalid', reason: 'refusal' };
  if (message.stop_reason === 'max_tokens') return { kind: 'invalid', reason: 'max_tokens' };
  let raw: unknown;
  try {
    raw = JSON.parse(answerText(message));
  } catch {
    return { kind: 'invalid', reason: 'not_json' };
  }
  const a = writerAnswer.safeParse(raw);
  if (!a.success) return { kind: 'invalid', reason: 'schema' };
  const title = clean(a.data.title).replace(/^["'“]+|["'”]+$/gu, '');
  if (!isPlain(title, 120)) return { kind: 'invalid', reason: 'schema' };
  let p = -1;
  const sentences: WrittenText['sentences'] = [];
  for (const [i, s] of a.data.sentences.entries()) {
    const en = clean(s.en);
    const tr = clean(s.tr);
    if (!isPlain(en, 600) || !isPlain(tr, 800) || !/[A-Za-z]/.test(en))
      return { kind: 'invalid', reason: 'sentence_unfit' };
    if (en.toLowerCase() === tr.toLowerCase()) return { kind: 'invalid', reason: 'not_translated' };
    if (s.new_paragraph || i === 0) p++;
    sentences.push({ en, tr, p });
  }
  const n = words(sentences.map((s) => s.en));
  // A little slack around the asked range: the model counts words differently.
  if (n < Math.floor(w.words.min * 0.9)) return { kind: 'invalid', reason: 'too_short' };
  if (n > Math.ceil(w.words.max * 1.1)) return { kind: 'invalid', reason: 'too_long' };
  const lowerText = sentences.map((s) => s.en.toLowerCase()).join(' ');
  const target = [...new Set(a.data.target_lemmas.map((t) => clean(t).toLowerCase()))]
    .filter((t) => t.length >= 2 && t.length <= 64 && /^[\p{L}' -]+$/u.test(t))
    .filter((t) => lowerText.includes(t.slice(0, Math.max(3, t.length - 2))))
    .slice(0, 12);
  const glosses = a.data.glosses
    .map((g) => ({ word: clean(g.word), tr: clean(g.tr) }))
    .filter((g) => isPlain(g.word, 64) && isPlain(g.tr, 120))
    .slice(0, 40);
  return { kind: 'ok', text: { title, sentences, target_lemmas: target, glosses } };
}

// ---------------------------------------------------------------------------
// gradedcheck-v1
// ---------------------------------------------------------------------------

export const CHECK_SYSTEM_PROMPT = `You review short English reading texts written for adult Turkish speakers who are learning English. Each sentence has a Turkish translation.

You receive JSON: level (CEFR), topic, title and sentences [{en, tr}].

Judge the text strictly and answer:
- natural: 1 to 5. 5 = reads like good writing by a native speaker; 3 = understandable but stiff, odd or repetitive; 1 = broken.
- level_fit: "fits" if a learner at that level can read it with little help; "too_easy" if it is clearly easier than the level; "too_hard" if a learner at that level would struggle.
- translation_ok: true if every Turkish translation is correct and natural.
- safe: false if anything is violent, sexual, hateful, political opinion, religious, dangerous advice, or otherwise unsuitable for a general adult audience.
- factual_ok: false if any statement presented as fact is wrong or doubtful.
- copyrighted: true if it uses characters, plots, lyrics or long quotations from existing works, or real brands or real living people.
- problems: short English notes on what is wrong (empty if nothing).

Answer with JSON only: {"natural": integer, "level_fit": "fits" | "too_easy" | "too_hard", "translation_ok": boolean, "safe": boolean, "factual_ok": boolean, "copyrighted": boolean, "problems": [string]}.`;

export const CHECK_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['natural', 'level_fit', 'translation_ok', 'safe', 'factual_ok', 'copyrighted', 'problems'],
  properties: {
    natural: { type: 'integer' },
    level_fit: { type: 'string', enum: ['fits', 'too_easy', 'too_hard'] },
    translation_ok: { type: 'boolean' },
    safe: { type: 'boolean' },
    factual_ok: { type: 'boolean' },
    copyrighted: { type: 'boolean' },
    problems: { type: 'array', items: { type: 'string' } },
  },
} as const;

export interface CheckInput {
  level: string;
  topic: string;
  title: string;
  sentences: { en: string; tr: string }[];
}

export function checkUserContent(c: CheckInput): string {
  return JSON.stringify({
    level: c.level,
    topic: c.topic,
    title: c.title,
    sentences: c.sentences.map((s) => ({ en: s.en, tr: s.tr })),
  });
}

export function buildCheckRequest(
  c: CheckInput,
  opts: { model: string },
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: opts.model,
    max_tokens: CHECK_MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: CHECK_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      },
    },
    system: [{ type: 'text', text: CHECK_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: checkUserContent(c) }],
  };
}

const checkAnswer = z.object({
  natural: z.number().int().min(1).max(5),
  level_fit: z.enum(['fits', 'too_easy', 'too_hard']),
  translation_ok: z.boolean(),
  safe: z.boolean(),
  factual_ok: z.boolean(),
  copyrighted: z.boolean(),
  problems: z.array(z.string()).max(20),
});
export type CheckVerdict = z.infer<typeof checkAnswer>;

/** The lowest naturalness score a text may have. */
export const MIN_NATURAL = 4;

export type ParsedCheck =
  | { kind: 'ok'; verdict: CheckVerdict; approved: boolean; reasons: string[] }
  | { kind: 'invalid'; reason: string };

/** Reads the checker's answer and decides: approved only when every check passes. */
export function parseCheckAnswer(message: ModelMessage): ParsedCheck {
  if (message.stop_reason === 'refusal') return { kind: 'invalid', reason: 'refusal' };
  if (message.stop_reason === 'max_tokens') return { kind: 'invalid', reason: 'max_tokens' };
  let raw: unknown;
  try {
    raw = JSON.parse(answerText(message));
  } catch {
    return { kind: 'invalid', reason: 'not_json' };
  }
  const a = checkAnswer.safeParse(raw);
  if (!a.success) return { kind: 'invalid', reason: 'schema' };
  const v = a.data;
  const reasons: string[] = [];
  if (v.natural < MIN_NATURAL) reasons.push('not_natural');
  if (v.level_fit !== 'fits') reasons.push(`level_${v.level_fit}`);
  if (!v.translation_ok) reasons.push('translation');
  if (!v.safe) reasons.push('unsafe');
  if (!v.factual_ok) reasons.push('factual');
  if (v.copyrighted) reasons.push('copyrighted');
  const verdict = { ...v, problems: v.problems.map((p) => clean(p).slice(0, 200)).slice(0, 10) };
  return { kind: 'ok', verdict, approved: reasons.length === 0, reasons };
}
