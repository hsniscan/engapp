// Prompt wordbank-review-v1 (decision 0040): a second, stronger model reads finished Kelime
// Bankası rows (decision 0038) in groups and names the meanings that are wrong, odd or
// redundant, with a corrected meaning and/or example, or "drop". Meanings it does not name are
// kept. Only system content is sent: the word, its part of speech, its level and the row's
// meanings with their examples. Nothing a user wrote.

import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { answerText, type ModelMessage } from '../../supabase/functions/_shared/image-prompt.ts';
import type { WordBankSense } from '../../supabase/functions/_shared/wordbank-contract.ts';

export const REVIEW_PROMPT_VERSION = 'wordbank-review-v1';
/** Bank rows per request: the system prompt is paid once per group, not per word. */
export const REVIEW_GROUP_SIZE = 25;
/** Room for every meaning of a full group to be corrected (normally a few hundred are used). */
export const REVIEW_MAX_TOKENS = 6000;

/** One bank row as the review sees it (stored on its review job while the batch runs). */
export interface ReviewRowInput {
  lemma_norm: string;
  pos: string;
  lemma: string;
  cefr: string;
  list_source: string;
  zipf: number | null;
  lexicon_term_id: string | null;
  senses: WordBankSense[];
}

export const REVIEW_SYSTEM_PROMPT = `You check flashcard content for Turkish speakers who learn English words. Another model wrote it; about one meaning in twenty is wrong. Find those.

You receive numbered words. Each has a part of speech, a CEFR level and 1 to 3 numbered meanings. A meaning is: the Turkish meaning | an English example sentence | its Turkish translation.

A meaning is wrong when:
- the Turkish meaning is not a meaning of this word in this part of speech, or a rare, figurative or wrong sense where a common one is expected (scythe: "ölüm meleği" instead of "tırpan");
- the example does not show this meaning, or uses the word in another part of speech or wrongly ("She felt reminiscent" is not English);
- the Turkish translation is wrong, unnatural, has junk text (a stray English word or label), or translates the word with a different meaning than the Turkish meaning says;
- it repeats another meaning of the same word (synonyms belong together in one meaning: "davet, davetiye", not two meanings).

For function words (the, a, in, all, some ...) the Turkish meaning may describe the use ("belirli tanımlık" is fine); the example and its translation must match that use.

For each wrong meaning give one change:
- action "fix": write only the parts that must change; leave the others "". meaning_tr: short Turkish meaning, lower case, synonyms separated by ", ", no brackets. When you change meaning_tr, also give gloss_en: a short English definition of the new meaning (at most 12 words). example_en: a natural English sentence of at most 12 words for a learner at the word's level, containing the word itself unchanged or with a regular ending (-s, -es, -ed, -d, -ing, -er, -est), no irregular forms. When you change example_en, also give example_tr. example_tr: a natural Turkish translation of the (new or old) example_en.
- action "drop": the meaning is redundant or not worth learning. Never drop every meaning of a word: fix the best one instead.
- reason: at most 8 English words, why.

Content: everyday, neutral situations. No real people, brands, politics, religion, violence or adult topics.

Meanings you do not list are kept unchanged. Most words need no change. Answer with JSON only: {"changes": [{"word": number, "meaning": number, "action": "fix" | "drop", "meaning_tr": string, "gloss_en": string, "example_en": string, "example_tr": string, "reason": string}]}; an empty list when everything is right.`;

export const REVIEW_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['changes'],
  properties: {
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'word',
          'meaning',
          'action',
          'meaning_tr',
          'gloss_en',
          'example_en',
          'example_tr',
          'reason',
        ],
        properties: {
          word: { type: 'integer' },
          meaning: { type: 'integer' },
          action: { type: 'string', enum: ['fix', 'drop'] },
          meaning_tr: { type: 'string' },
          gloss_en: { type: 'string' },
          example_en: { type: 'string' },
          example_tr: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
} as const;

/** What a rejected change did wrong, told to the model when its word is asked again. */
const PROBLEM_TEXT: Record<string, string> = {
  example_without_word: 'a corrected example did not contain the word (or used an irregular form)',
  example_en_unfit: 'a corrected English example was too long or not plain text',
  example_tr_unfit: 'a corrected Turkish translation was missing, too long or not plain text',
  example_not_translated: 'a corrected translation repeated the English sentence',
  example_tr_missing: 'a new English example came without its Turkish translation',
  meaning_tr_unfit: 'a corrected Turkish meaning was too long or had brackets or symbols',
  gloss_en_unfit: 'a changed Turkish meaning came without a short English definition',
};

export function reviewProblemText(code: string | null | undefined): string | null {
  return (code && PROBLEM_TEXT[code]) || null;
}

/** The user turn: numbered words with their numbered meanings; nothing else. */
export function reviewUserContent(
  rows: readonly (ReviewRowInput & { problem?: string | null })[],
): string {
  const lines: string[] = [];
  rows.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.lemma} (${r.pos}, ${r.cefr})`);
    r.senses.forEach((s, k) =>
      lines.push(`  ${k + 1}) ${s.meaning_tr} | ${s.example_en} | ${s.example_tr}`),
    );
    const p = reviewProblemText(r.problem);
    if (p) lines.push(`  note: a previous correction was rejected because ${p}. Avoid that.`);
  });
  return lines.join('\n');
}

/**
 * Thinking for the review model. Claude Sonnet 5.5 runs without extended thinking (the
 * `between_tools` mode; there are no tools): the task is a short judgment per meaning and
 * thinking would double the output cost. Other models (a variable may name one) use adaptive
 * thinking at effort low.
 */
function thinkingFor(model: string): Anthropic.ThinkingConfigParam {
  return model.startsWith('claude-sonnet-5-5') ? { type: 'between_tools' } : { type: 'adaptive' };
}

export function buildReviewRequest(
  rows: readonly (ReviewRowInput & { problem?: string | null })[],
  opts: { model: string },
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: opts.model,
    max_tokens: REVIEW_MAX_TOKENS,
    thinking: thinkingFor(opts.model),
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: REVIEW_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      },
    },
    system: [{ type: 'text', text: REVIEW_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: reviewUserContent(rows) }],
  };
}

const answerSchema = z.object({
  changes: z
    .array(
      z.object({
        word: z.number().int(),
        meaning: z.number().int(),
        action: z.enum(['fix', 'drop']),
        meaning_tr: z.string(),
        gloss_en: z.string(),
        example_en: z.string(),
        example_tr: z.string(),
        reason: z.string(),
      }),
    )
    .max(200),
});

/** One proposed change, 0-based, text trimmed (not yet checked against the row). */
export interface ReviewChange {
  sense: number;
  action: 'fix' | 'drop';
  meaning_tr: string;
  gloss_en: string;
  example_en: string;
  example_tr: string;
  reason: string;
}

export type ParsedReview =
  | {
      kind: 'ok';
      /** Changes per row index (0-based); a row without changes is kept as it is. */
      changes: Map<number, ReviewChange[]>;
      /** Changes that named a word or meaning that does not exist (ignored). */
      unknown: number;
    }
  | { kind: 'invalid'; reason: string };

const clean = (s: string) => s.replace(/\s+/gu, ' ').trim();

/**
 * Reads one answer: the JSON schema, word and meaning numbers that exist (others are counted
 * and ignored), one change per meaning (the first wins). The text of a change is checked
 * when it is applied (`reviewRow`). Never throws.
 */
export function parseReviewAnswer(
  message: ModelMessage,
  rows: readonly { senses: readonly unknown[] }[],
): ParsedReview {
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
  const changes = new Map<number, ReviewChange[]>();
  let unknown = 0;
  for (const c of a.data.changes) {
    const row = c.word - 1;
    const sense = c.meaning - 1;
    const r = rows[row];
    if (!r || sense < 0 || sense >= r.senses.length) {
      unknown++;
      continue;
    }
    const list = changes.get(row) ?? [];
    if (list.some((x) => x.sense === sense)) continue;
    list.push({
      sense,
      action: c.action,
      meaning_tr: clean(c.meaning_tr).replace(/\s*,\s*/g, ', '),
      gloss_en: clean(c.gloss_en),
      example_en: clean(c.example_en),
      example_tr: clean(c.example_tr),
      reason: clean(c.reason).slice(0, 120),
    });
    changes.set(row, list);
  }
  return { kind: 'ok', changes, unknown };
}
