// Prompt visual-v1 (Haiku): how well can each sense be shown as a picture? (decision 0030,
// docs/ai-image.md). A batch of senses in, one score 0–3 and a short drawing hint per sense out.
// Stored on lexicon_senses (visualizability, visual_hint); senses scoring VISUAL_AUTO_MIN or more
// are queued for a picture automatically, the rest only when a user asks.

import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { VISUAL_PROMPT_VERSION } from './image-contract.ts';
import { answerText, type ModelMessage } from './image-prompt.ts';

export { VISUAL_PROMPT_VERSION };

/** Senses per call. */
export const VISUAL_BATCH = 50;
export const VISUAL_MAX_TOKENS = 8000;

export interface VisualInput {
  sense_id: string;
  lemma: string;
  pos: string;
  gloss_tr: string;
}

export interface VisualScore {
  sense_id: string;
  score: 0 | 1 | 2 | 3;
  hint: string | null;
}

export const VISUAL_SYSTEM_PROMPT = `You help decide which English word meanings get a picture on a flashcard for Turkish speakers. The pictures are small, flat, text-free drawings (one subject on a round backdrop).

You receive a JSON list of meanings: n (a number), lemma (English word), pos (part of speech) and gloss_tr (the Turkish meaning). Judge each meaning exactly as gloss_tr gives it, not other senses of the word.

Score each meaning:
- 3: a concrete thing, animal, place, food or very common scene that anyone recognises at once (apple, bridge, umbrella).
- 2: an action, a feeling, a relation or a property that a simple scene shows clearly without text (climb, angry, between, wet).
- 1: drawable only with a convention or a symbol that may mislead (freedom, justice, sudden).
- 0: no picture helps or any picture would mislead: grammar and function words, most abstract nouns, discourse words (although, whether, concept, therefore).

hint: for scores 1–3, one short English idea of what to draw (at most 120 characters), e.g. "a person going up a steep mountain"; "" for 0.

Answer with JSON only: {"items": [{"n": number, "score": number, "hint": string}]}, one item per meaning, in any order.`;

export const VISUAL_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['n', 'score', 'hint'],
        properties: {
          n: { type: 'integer' },
          score: { type: 'integer' },
          hint: { type: 'string' },
        },
      },
    },
  },
} as const;

/** The user turn: numbered meanings, no ids (the numbers map back to the senses). */
export function visualUserContent(items: readonly VisualInput[]): string {
  return JSON.stringify(
    items.map((s, i) => ({ n: i + 1, lemma: s.lemma, pos: s.pos, gloss_tr: s.gloss_tr })),
  );
}

export function buildVisualRequest(
  items: readonly VisualInput[],
  opts: { model: string },
): Anthropic.MessageCreateParamsNonStreaming {
  if (items.length === 0 || items.length > VISUAL_BATCH) throw new Error('1..50 senses per call');
  return {
    model: opts.model,
    max_tokens: VISUAL_MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: VISUAL_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      },
    },
    system: [{ type: 'text', text: VISUAL_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: visualUserContent(items) }],
  };
}

const visualAnswer = z.object({
  items: z.array(z.object({ n: z.number().int(), score: z.number().int(), hint: z.string() })),
});

/**
 * Scores for the senses the model answered for (out-of-range numbers and duplicates are
 * dropped; a missing sense stays unscored and is asked again in a later run).
 */
export function parseVisualResponse(
  message: ModelMessage,
  items: readonly VisualInput[],
): VisualScore[] {
  if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') return [];
  let raw: unknown;
  try {
    raw = JSON.parse(answerText(message));
  } catch {
    return [];
  }
  const a = visualAnswer.safeParse(raw);
  if (!a.success) return [];
  const out = new Map<string, VisualScore>();
  for (const it of a.data.items) {
    const s = items[it.n - 1];
    if (!s || out.has(s.sense_id) || it.score < 0 || it.score > 3) continue;
    const hint = it.score > 0 ? cleanHint(it.hint) : null;
    out.set(s.sense_id, { sense_id: s.sense_id, score: it.score as VisualScore['score'], hint });
  }
  return [...out.values()];
}

function cleanHint(h: string): string | null {
  const t = h
    .replace(/[<>\p{Cc}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
  return t === '' ? null : t;
}
