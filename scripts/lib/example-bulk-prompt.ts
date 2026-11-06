// Prompts of the bulk example job (decision 0074), all sent as Message Batches (half price).
// Only system content is sent: a bank word, its part of speech, its level, its Turkish
// meanings and sentences (Tatoeba's or the model's own). Nothing a user wrote.
//
//   examples-tag-v1     (Haiku) which meaning of the word each Tatoeba pair shows, if any, is
//                       the pair natural and correctly translated, and which context it fits
//   examples-gen-v1     (Haiku) new sentences only for the meanings Tatoeba could not fill
//   examples-review-v1  (Sonnet) every kept sentence: natural Turkish (no calques, Turkish
//                       word order, tense agreement), shows this meaning, fits the level

import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { DEFAULT_EXAMPLE_CONTEXTS } from '../../supabase/functions/_shared/examples-contracts.ts';
import { answerText, type ModelMessage } from '../../supabase/functions/_shared/image-prompt.ts';
import { MODELS_WITHOUT_REVIEW_THINKING } from '../../supabase/functions/_shared/model-defaults.ts';
import { exampleProblem, isCleanSentence } from './word-bank-prompt.ts';

export const TAG_PROMPT_VERSION = 'examples-tag-v1';
export const GEN_PROMPT_VERSION = 'examples-gen-v1';
export const REVIEW_PROMPT_VERSION = 'examples-review-v1';

export const TAG_MAX_TOKENS = 2000;
export const GEN_MAX_TOKENS = 3000;
export const REVIEW_MAX_TOKENS = 2500;
/** Sentences per review request: the system prompt is paid once per group. */
export const REVIEW_GROUP_SIZE = 20;

/** The contexts sentences are sorted into: the app's default rotation (daily … formal). */
export const BULK_CONTEXTS: readonly string[] = DEFAULT_EXAMPLE_CONTEXTS;

/** A bank word with its meanings, as every prompt sees it. */
export interface WordHead {
  lemma_norm: string;
  pos: string;
  cefr: string;
}

const clean = (s: string) => s.replace(/\s+/gu, ' ').trim();

/**
 * Thinking: Sonnet reviews without extended thinking (a short judgment per sentence, as in the
 * word-bank review); other models think adaptively at effort low.
 */
function thinkingFor(model: string): Anthropic.ThinkingConfigParam {
  return MODELS_WITHOUT_REVIEW_THINKING.some((m) => model.startsWith(m))
    ? { type: 'between_tools' }
    : { type: 'adaptive' };
}

function request(
  model: string,
  system: string,
  user: string,
  schema: unknown,
  maxTokens: number,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: maxTokens,
    thinking: thinkingFor(model),
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: schema as Record<string, unknown> },
    },
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  };
}

function readJson(message: ModelMessage): { ok: true; raw: unknown } | { ok: false; reason: string } {
  if (message.stop_reason === 'refusal') return { ok: false, reason: 'refusal' };
  if (message.stop_reason === 'max_tokens') return { ok: false, reason: 'max_tokens' };
  try {
    return { ok: true, raw: JSON.parse(answerText(message)) };
  } catch {
    return { ok: false, reason: 'not_json' };
  }
}

// ---------------------------------------------------------------------------
// tag: Tatoeba pairs → meaning, natural or not, context
// ---------------------------------------------------------------------------

export const TAG_SYSTEM_PROMPT = `You sort example sentences for Turkish speakers who learn English words.

You receive one English word (lemma, pos = part of speech, level = CEFR level), its numbered Turkish meanings, and numbered candidate sentences: an English sentence and its Turkish translation, both written by volunteers.

For every candidate answer:
- sense: the number of the meaning the word has in this English sentence, or 0 when it has none of them (another meaning, another part of speech, or the word is only part of a longer expression).
- ok: true only if all of these hold: the English is natural and correct; the Turkish is a correct, natural translation (natural Turkish word order, no word-for-word calque, the right tense); the sentence is a good, neutral example for a learner (no violence, adult topics, religion, politics, insults or real people); it is not too odd or too dependent on a missing context.
- context: where the sentence would be heard or read: "daily" (everyday life), "conversation" (spoken, casual), "work" (work or school) or "formal" (formal or written).

Answer with JSON only: {"items": [{"i": number, "sense": number, "ok": boolean, "context": string}]}, one item per candidate.`;

const TAG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['i', 'sense', 'ok', 'context'],
        properties: {
          i: { type: 'integer' },
          sense: { type: 'integer' },
          ok: { type: 'boolean' },
          context: { type: 'string', enum: [...BULK_CONTEXTS] },
        },
      },
    },
  },
} as const;

export interface TagInput extends WordHead {
  senses: { meaning_tr: string }[];
  candidates: { en: string; tr: string }[];
}

export function tagUserContent(x: TagInput): string {
  const lines = [`word: ${x.lemma_norm} (pos: ${x.pos}, level: ${x.cefr})`, 'meanings:'];
  x.senses.forEach((s, k) => lines.push(`  ${k + 1}) ${s.meaning_tr}`));
  lines.push('candidates:');
  x.candidates.forEach((c, k) => lines.push(`  ${k + 1}) ${c.en} | ${c.tr}`));
  return lines.join('\n');
}

export function buildTagRequest(x: TagInput, opts: { model: string }) {
  return request(opts.model, TAG_SYSTEM_PROMPT, tagUserContent(x), TAG_SCHEMA, TAG_MAX_TOKENS);
}

export interface TagVerdict {
  /** 0-based meaning, or null for none. */
  sense: number | null;
  ok: boolean;
  context: string;
}

const tagAnswer = z.object({
  items: z
    .array(z.object({ i: z.number().int(), sense: z.number().int(), ok: z.boolean(), context: z.string() }))
    .max(64),
});

/**
 * Verdicts per candidate (0-based). A candidate the answer leaves out, or names twice, gets no
 * verdict and is dropped; a meaning number that does not exist means none. Never throws.
 */
export function parseTagAnswer(
  message: ModelMessage,
  x: Pick<TagInput, 'senses' | 'candidates'>,
): { kind: 'ok'; verdicts: Map<number, TagVerdict> } | { kind: 'invalid'; reason: string } {
  const j = readJson(message);
  if (!j.ok) return { kind: 'invalid', reason: j.reason };
  const a = tagAnswer.safeParse(j.raw);
  if (!a.success) return { kind: 'invalid', reason: 'schema' };
  const verdicts = new Map<number, TagVerdict>();
  for (const it of a.data.items) {
    const c = it.i - 1;
    if (c < 0 || c >= x.candidates.length || verdicts.has(c)) continue;
    const sense = it.sense >= 1 && it.sense <= x.senses.length ? it.sense - 1 : null;
    const context = BULK_CONTEXTS.includes(it.context) ? it.context : 'daily';
    verdicts.set(c, { sense, ok: it.ok && sense !== null, context });
  }
  return { kind: 'ok', verdicts };
}

// ---------------------------------------------------------------------------
// generate: the sentences Tatoeba could not give
// ---------------------------------------------------------------------------

export const GEN_SYSTEM_PROMPT = `You write example sentences for Turkish speakers who learn English words.

You receive one English word (lemma, pos = part of speech, level = CEFR level) and some of its numbered Turkish meanings. For each meaning you get: count (how many new sentences to write), contexts (the situations to use, one per sentence, in order) and avoid (sentences it already has: do not repeat them or their idea).

Contexts: "daily" = everyday life, "conversation" = spoken and casual (may be a short line of dialogue), "work" = work or school, "formal" = formal or written.

Every sentence:
- example_en: one natural English sentence of 6 to 14 words that a learner at the given level understands; it shows exactly this meaning and contains the word itself (a phrase as a whole), unchanged or with a normal ending or form (gives, gave, given, giving).
- example_tr: a natural Turkish translation, as a Turkish speaker would say it: Turkish word order, the right tense and person, no word-for-word calque, no English words left in it.
- Vary the subject, tense and situation between sentences. Everyday, neutral situations; no real people, brands, politics, religion, violence or adult topics.

Answer with JSON only: {"sentences": [{"sense": number, "context": string, "example_en": string, "example_tr": string}]}.`;

const GEN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sentences'],
  properties: {
    sentences: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sense', 'context', 'example_en', 'example_tr'],
        properties: {
          sense: { type: 'integer' },
          context: { type: 'string', enum: [...BULK_CONTEXTS] },
          example_en: { type: 'string' },
          example_tr: { type: 'string' },
        },
      },
    },
  },
} as const;

/** One meaning that needs sentences (stored as example_bulk_rows.gen_input while the batch runs). */
export interface GenSense {
  sense_id: string;
  meaning_tr: string;
  count: number;
  contexts: string[];
  avoid: string[];
}

export interface GenInput extends WordHead {
  senses: GenSense[];
}

export function genUserContent(x: GenInput): string {
  return JSON.stringify({
    lemma: x.lemma_norm,
    pos: x.pos,
    level: x.cefr,
    meanings: x.senses.map((s, k) => ({
      n: k + 1,
      meaning_tr: s.meaning_tr,
      count: s.count,
      contexts: s.contexts,
      avoid: s.avoid.slice(0, 6),
    })),
  });
}

export function buildGenRequest(x: GenInput, opts: { model: string }) {
  return request(opts.model, GEN_SYSTEM_PROMPT, genUserContent(x), GEN_SCHEMA, GEN_MAX_TOKENS);
}

export interface GenSentence {
  sense_id: string;
  context: string;
  en: string;
  tr: string;
}

const genAnswer = z.object({
  sentences: z
    .array(
      z.object({
        sense: z.number().int(),
        context: z.string(),
        example_en: z.string(),
        example_tr: z.string(),
      }),
    )
    .max(40),
});

/**
 * The checked sentences of an answer: a known meaning, at most `count` per meaning, the word
 * in the sentence, plain text, a translation, not a repeat. Failures are counted in
 * `dropped`. Never throws.
 */
export function parseGenAnswer(
  message: ModelMessage,
  x: GenInput,
): { kind: 'ok'; sentences: GenSentence[]; dropped: string[] } | { kind: 'invalid'; reason: string } {
  const j = readJson(message);
  if (!j.ok) return { kind: 'invalid', reason: j.reason };
  const a = genAnswer.safeParse(j.raw);
  if (!a.success) return { kind: 'invalid', reason: 'schema' };
  const out: GenSentence[] = [];
  const dropped: string[] = [];
  const used = new Map<number, number>();
  const seen = new Set(x.senses.flatMap((s) => s.avoid.map((t) => t.toLowerCase())));
  for (const s of a.data.sentences) {
    const k = s.sense - 1;
    const sense = x.senses[k];
    if (!sense) {
      dropped.push('unknown_sense');
      continue;
    }
    if ((used.get(k) ?? 0) >= sense.count) {
      dropped.push('too_many');
      continue;
    }
    const en = clean(s.example_en);
    const tr = clean(s.example_tr);
    const problem = exampleProblem(x.lemma_norm, en, tr);
    if (problem) {
      dropped.push(problem);
      continue;
    }
    if (seen.has(en.toLowerCase())) {
      dropped.push('repeat');
      continue;
    }
    seen.add(en.toLowerCase());
    used.set(k, (used.get(k) ?? 0) + 1);
    out.push({
      sense_id: sense.sense_id,
      context: BULK_CONTEXTS.includes(s.context) ? s.context : (sense.contexts[0] ?? 'daily'),
      en,
      tr,
    });
  }
  return { kind: 'ok', sentences: out, dropped };
}

// ---------------------------------------------------------------------------
// review: every kept sentence, before it ships
// ---------------------------------------------------------------------------

export const REVIEW_SYSTEM_PROMPT = `You are a native Turkish editor who also knows English well. You check example sentences for Turkish speakers who learn English words, before they are shown in a flashcard app.

You receive numbered items. Each item: the English word (part of speech, CEFR level), the Turkish meaning it should show, the English sentence and its Turkish translation. Items marked "fixed English" come from a volunteer corpus: their English must not be changed.

An item is wrong when:
- the Turkish translation is not natural Turkish: a word-for-word calque ("Şaşkınlığına, ilk ödülü kazandı"), English word order ("Her yaz domates yetiştiriyoruz serada"), a wrong tense, person or case, a repetition, an English word left in it, or a meaning that differs from the English;
- the English sentence does not show the given Turkish meaning of the word (another meaning or another part of speech), is unnatural or wrong English, or is much too hard for the level;
- the content is odd, forced, or not neutral (violence, adult topics, religion, politics, insults, real people).

For each wrong item give one change:
- action "fix": write only what must change, leave the rest "". example_tr: the corrected, natural Turkish translation. example_en: a corrected English sentence of at most 14 words that contains the word (a phrase as a whole) — only for items without "fixed English"; when you change example_en, also give example_tr.
- action "reject": the item cannot be saved with a small fix (for "fixed English" items: whenever the English itself is the problem).
- reason: at most 8 English words.

Items you do not list are kept unchanged; most items need no change. Answer with JSON only: {"changes": [{"item": number, "action": "fix" | "reject", "example_en": string, "example_tr": string, "reason": string}]}; an empty list when everything is right.`;

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['changes'],
  properties: {
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['item', 'action', 'example_en', 'example_tr', 'reason'],
        properties: {
          item: { type: 'integer' },
          action: { type: 'string', enum: ['fix', 'reject'] },
          example_en: { type: 'string' },
          example_tr: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
} as const;

export interface ReviewItemInput extends WordHead {
  meaning_tr: string;
  en: string;
  tr: string;
  /** Tatoeba: the English may not change. */
  fixedEnglish: boolean;
}

export function reviewUserContent(items: readonly ReviewItemInput[]): string {
  return items
    .map(
      (x, k) =>
        `${k + 1}. ${x.lemma_norm} (${x.pos}, ${x.cefr}) = ${x.meaning_tr}${x.fixedEnglish ? ' [fixed English]' : ''}\n   EN: ${x.en}\n   TR: ${x.tr}`,
    )
    .join('\n');
}

export function buildReviewRequest(items: readonly ReviewItemInput[], opts: { model: string }) {
  return request(
    opts.model,
    REVIEW_SYSTEM_PROMPT,
    reviewUserContent(items),
    REVIEW_SCHEMA,
    REVIEW_MAX_TOKENS,
  );
}

/** What the review decided for one item. */
export type ReviewOutcome =
  | { kind: 'approve' }
  | { kind: 'fix'; en: string; tr: string; trEdited: boolean; enEdited: boolean; reason: string }
  | { kind: 'reject'; reason: string };

const reviewAnswer = z.object({
  changes: z
    .array(
      z.object({
        item: z.number().int(),
        action: z.enum(['fix', 'reject']),
        example_en: z.string(),
        example_tr: z.string(),
        reason: z.string(),
      }),
    )
    .max(100),
});

/**
 * One outcome per item: unlisted items are approved; a fix is checked (the word is still in
 * the English, plain text, a real translation) and a fix that fails, or that changes a fixed
 * English sentence, rejects the item. Never throws.
 */
export function parseReviewAnswer(
  message: ModelMessage,
  items: readonly ReviewItemInput[],
): { kind: 'ok'; outcomes: ReviewOutcome[] } | { kind: 'invalid'; reason: string } {
  const j = readJson(message);
  if (!j.ok) return { kind: 'invalid', reason: j.reason };
  const a = reviewAnswer.safeParse(j.raw);
  if (!a.success) return { kind: 'invalid', reason: 'schema' };
  const outcomes: ReviewOutcome[] = items.map(() => ({ kind: 'approve' }));
  const done = new Set<number>();
  for (const c of a.data.changes) {
    const k = c.item - 1;
    const x = items[k];
    if (!x || done.has(k)) continue;
    done.add(k);
    const reason = clean(c.reason).slice(0, 120) || c.action;
    if (c.action === 'reject') {
      outcomes[k] = { kind: 'reject', reason };
      continue;
    }
    const newEn = clean(c.example_en);
    const newTr = clean(c.example_tr);
    const enEdited = newEn !== '' && newEn !== x.en;
    if (enEdited && x.fixedEnglish) {
      outcomes[k] = { kind: 'reject', reason: `english: ${reason}` };
      continue;
    }
    // A new English sentence needs its own translation.
    if (enEdited && !newTr) {
      outcomes[k] = { kind: 'reject', reason: `untranslated fix: ${reason}` };
      continue;
    }
    const en = enEdited ? newEn : x.en;
    const tr = newTr || x.tr;
    if (exampleProblem(x.lemma_norm, en, tr) || !isCleanSentence(tr, 300)) {
      outcomes[k] = { kind: 'reject', reason: `bad fix: ${reason}` };
      continue;
    }
    if (!enEdited && tr === x.tr) continue; // a "fix" that changes nothing
    outcomes[k] = { kind: 'fix', en, tr, trEdited: tr !== x.tr, enEdited, reason };
  }
  return { kind: 'ok', outcomes };
}
