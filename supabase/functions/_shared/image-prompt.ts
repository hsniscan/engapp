// Prompt image-v1: draws one style-B picture for one lexicon sense (decisions 0029, 0030;
// docs/ai-image.md). The system prompt is the style guide + parts library + the six approved
// references: byte-for-byte stable, so it is cached (1-hour TTL). The user turn carries only the
// fields of ImageRequestInput that describe the meaning (lemma, pos, gloss_tr, visual_hint) and,
// on a redraw, a fixed sentence naming what was wrong. Nothing else reaches the model.

import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  generatedImage,
  IMAGE_MAX_BYTES,
  IMAGE_PALETTE,
  IMAGE_PROMPT_VERSION,
  type GeneratedImage,
  type ImageRequestInput,
} from './image-contract.ts';
import { IMAGE_PARTS } from './image-parts.ts';
import { IMAGE_REFS } from './image-refs.ts';

export { IMAGE_PROMPT_VERSION };

/** Room for adaptive thinking plus an SVG of at most IMAGE_MAX_BYTES. */
// 8000 since 2026-10-25: Sonnet drawings use ~1k output tokens; a lower cap lets the budget guard
// reserve for 1,000+ pictures a night.
export const IMAGE_MAX_TOKENS = 8000;

/** What each palette role is for (the prompt's colour table). */
const ROLE_USE: Record<keyof typeof IMAGE_PALETTE, string> = {
  ink: 'darkest detail: eyes, small marks on light shapes',
  inkFlat: 'dark grey parts: handles, poles, tools, wheels',
  inkFaint: 'faint helpers: arrows, ground lines, steam, motion strokes',
  inkOnRed: 'features drawn on top of red or orange shapes',
  paper: 'off-white inner parts on top of a coloured shape (pages, plates)',
  soft: 'the backdrop circle only',
  white: 'snow, highlights (with opacity), teeth; only on top of another shape',
  red: 'red things, danger, anger, heat, roofs',
  orange: 'oranges, fire, warmth, bags, balls, the sun',
  yellow: 'lemons, light, stars; only on top of a darker shape',
  green: 'leaves, plants, grass, "go"',
  sky: 'water drops, ice, sky, glass',
  blue: "main colour of people's clothes, water, cold, calm objects",
  blueDark: 'shade side of blue things, far-side limbs',
  purple: 'flowers, fabric, magic, special objects',
  stem: 'wood, trunks, stems, brown hair, bread crust',
  stone: 'stone, sand, walls, paper bags, light ground',
  stoneDark: 'shade side of stone, railings, metal',
  skin: 'skin of hands and heads',
};

const palette = (Object.keys(IMAGE_PALETTE) as (keyof typeof IMAGE_PALETTE)[])
  .map((role) => `- ${IMAGE_PALETTE[role][0]} ${role}: ${ROLE_USE[role]}`)
  .join('\n');

const parts = IMAGE_PARTS.map((p) => `### ${p.name}\n${p.use}\n${p.svg}`).join('\n\n');

const examples = IMAGE_REFS.map(
  (r) =>
    `### ${r.lemma} (${r.pos})\nInput: ${JSON.stringify({ lemma: r.lemma, pos: r.pos, gloss_tr: r.gloss_tr, visual_hint: r.visual_hint })}\nIdea: ${r.idea}\nOutput: ${JSON.stringify({ drawable: true, svg: r.svg, alt_tr: r.alt_tr, confidence: 0.9 })}`,
).join('\n\n');

export const IMAGE_SYSTEM_PROMPT = `You draw small flashcard pictures for Turkish speakers learning English words. Each picture shows one meaning of one English word so that a learner who sees only the picture can recall the word.

You receive one meaning as JSON: lemma (the English word), pos (part of speech), gloss_tr (the Turkish meaning; draw exactly this meaning, not another sense of the word) and visual_hint (an optional English idea of what to draw, or null). A redraw also has previous_problem: what was wrong with the last attempt; avoid it.

## Style B: flat colour

- Flat filled shapes in the palette below. No outlines around shapes, no gradients, no shadows, no texture, no 3D.
- Lines appear only as shapes of their own (limbs, stems, handles, waves) with round caps and joins.
- Every picture starts with the soft backdrop circle (cx 128, cy 128, r 114). Keep everything inside it; a ground or a slope may be cut to the circle's edge with an arc.
- One clear subject, large and centred, filling about two thirds of the circle. At most one or two supporting cues (raindrops for an umbrella, water under a bridge).
- No text of any kind: no letters, digits, words, labels, signs with writing, speech bubbles with words, or symbols that stand for letters.
- People are simple figures: a skin-coloured circle head, limbs as thick blue strokes (stroke-width 12), far-side limbs in dark blue, no facial features unless the meaning is a feeling. No hair styles, no clothing details, no skin tones other than the skin colour.
- Feelings are a big round face; actions are a figure in mid-action; relations (between, under, behind) are simple blocks or balls with one faint arrow; abstract-but-drawable meanings use the most common everyday scene.
- Draw nothing frightening, violent, sexual, religious or political; for such words show a calm, neutral cue or decline.

## Colours

Use only these hex values (light theme; the app swaps each for its dark-theme twin). Each role has a purpose:
${palette}

Contrast: white, paper, yellow and soft are almost invisible on the backdrop, and ink-on-red is invisible in the dark theme: use them only on top of another shape, never directly on the backdrop.

## SVG rules

- Exactly one root: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">. No width or height.
- Elements: g, path, circle, ellipse, rect, line, polyline, polygon. Nothing else: no defs, use, clipPath, mask, gradient, filter, pattern, text, image, style, title.
- Attributes: d, points, cx, cy, r, rx, ry, x, y, x1, y1, x2, y2, width, height, fill, stroke, stroke-width, stroke-linecap, stroke-linejoin, transform, opacity, fill-opacity, stroke-opacity, fill-rule. No id, class, style or href.
- fill and stroke are always one of the palette hex values or none. Give every shape an explicit fill.
- Whole numbers or one decimal. Keep the SVG under ${Math.floor(IMAGE_MAX_BYTES / 1024) - 2} KB; around 1–3 KB is typical.

## Parts library

Reuse and adapt these parts (move, scale, recolour within the palette) so pictures look like one family.

${parts}

## Answer

Answer with JSON only: {"drawable": boolean, "svg": string, "alt_tr": string, "confidence": number}.
- drawable: false when no picture can show this meaning without text or a misleading symbol (grammar words, most abstract nouns, "although", "whether"); then svg and alt_tr are "" and confidence is 0. Do not force a picture.
- svg: the picture.
- alt_tr: one short Turkish sentence (at most 120 characters) describing what is drawn, for screen readers. Never write the English word in it.
- confidence: 0 to 1, how likely a learner recognises the meaning from the picture alone.

## Approved examples

${examples}`;

/** JSON schema of the answer (structured output). Ranges are checked after parsing. */
export const IMAGE_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['drawable', 'svg', 'alt_tr', 'confidence'],
  properties: {
    drawable: { type: 'boolean' },
    svg: { type: 'string' },
    alt_tr: { type: 'string' },
    confidence: { type: 'number' },
  },
} as const;

/** Why a picture is drawn again: fixed sentences only (never free text). */
export const REDRAW_PROBLEMS = {
  wrong_meaning:
    'The previous drawing did not show this meaning clearly; a learner guessed another word.',
  unclear: 'The previous drawing was hard to read at a small size; use fewer, larger shapes.',
  ugly: 'The previous drawing did not match the style; follow the style rules and the parts library closely.',
  has_text: 'The previous drawing contained text or letter-like marks; use no text at all.',
  clutter: 'The previous drawing was too busy; keep one large subject and at most two cues.',
  low_contrast:
    'The previous drawing used colours that vanish on the backdrop; put light colours only on top of other shapes.',
  invalid_svg:
    'The previous SVG broke the SVG rules (elements, attributes or colours); follow them exactly.',
  other: 'The previous drawing was not accepted; draw it again more simply.',
} as const;
export type RedrawProblem = keyof typeof REDRAW_PROBLEMS;

export function isRedrawProblem(v: unknown): v is RedrawProblem {
  return typeof v === 'string' && Object.hasOwn(REDRAW_PROBLEMS, v);
}

/** The user turn: only the meaning (and a fixed redraw sentence). Key order is fixed. */
export function imageUserContent(input: ImageRequestInput, problem?: RedrawProblem | null): string {
  const body: Record<string, string | null> = {
    lemma: input.lemma,
    pos: input.pos,
    gloss_tr: input.gloss_tr,
    visual_hint: input.visual_hint,
  };
  if (problem) body.previous_problem = REDRAW_PROBLEMS[problem];
  return JSON.stringify(body);
}

export interface ImageRequestOptions {
  model: string;
  effort?: 'low' | 'medium' | 'high';
  /** Why the previous attempt failed (a redraw). */
  problem?: RedrawProblem | null;
}

/**
 * Request body for one picture (Messages API; the same body goes into a Message Batch).
 * Adaptive thinking, effort medium by default, structured output, no temperature, no prefill.
 */
export function buildImageRequest(
  input: ImageRequestInput,
  opts: ImageRequestOptions,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: opts.model,
    max_tokens: IMAGE_MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: opts.effort ?? 'medium',
      format: {
        type: 'json_schema',
        schema: IMAGE_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      },
    },
    system: [
      { type: 'text', text: IMAGE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral', ttl: '1h' } },
    ],
    messages: [{ role: 'user', content: imageUserContent(input, opts.problem) }],
  };
}

/** Beta flag of the server-side refusal fallback (`fallbacks: "default"`). */
export const SERVER_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/**
 * The synchronous (instant) request: the same body plus the server-side fallback, so a
 * classifier decline is retried on the model Anthropic recommends for that category.
 * Not for batches (the Batches API rejects `fallbacks`).
 */
export function withServerFallback(
  params: Anthropic.MessageCreateParamsNonStreaming,
): Anthropic.Beta.MessageCreateParamsNonStreaming {
  return {
    ...(params as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming),
    betas: [SERVER_FALLBACK_BETA],
    fallbacks: 'default',
  };
}

const imageAnswer = z.object({
  drawable: z.boolean(),
  svg: z.string(),
  alt_tr: z.string(),
  confidence: z.number(),
});

/** The parts of a Message (or BetaMessage) the parsers read. */
export interface ModelMessage {
  stop_reason: string | null;
  content: readonly { type: string; text?: string }[];
}

export type ParsedImage =
  | { kind: 'image'; image: GeneratedImage }
  /** The model said nothing sensible can be drawn. */
  | { kind: 'declined' }
  /** A safety classifier declined (stop_reason "refusal"), after any fallback. */
  | { kind: 'refused' }
  | { kind: 'invalid'; reason: string };

/** Text of the answer (all text blocks; thinking blocks are skipped). */
export function answerText(message: ModelMessage): string {
  return message.content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}

/** Reads the model's answer. Never throws; the SVG is not sanitised here. */
export function parseImageResponse(message: ModelMessage): ParsedImage {
  if (message.stop_reason === 'refusal') return { kind: 'refused' };
  if (message.stop_reason === 'max_tokens') return { kind: 'invalid', reason: 'max_tokens' };
  let raw: unknown;
  try {
    raw = JSON.parse(answerText(message));
  } catch {
    return { kind: 'invalid', reason: 'not_json' };
  }
  const a = imageAnswer.safeParse(raw);
  if (!a.success) return { kind: 'invalid', reason: 'bad_shape' };
  if (!a.data.drawable) return { kind: 'declined' };
  const g = generatedImage.safeParse({
    svg: a.data.svg.trim(),
    alt_tr: a.data.alt_tr.trim().slice(0, 200),
    confidence: Math.min(1, Math.max(0, a.data.confidence)),
  });
  if (!g.success) return { kind: 'invalid', reason: 'bad_shape' };
  return { kind: 'image', image: g.data };
}
