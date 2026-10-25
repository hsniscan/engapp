// Prompt image-v2: draws one watercolour picture for one lexicon sense (decisions 0029, 0030;
// the owner switched from style B to watercolour on 2026-10-25; docs/ai-image.md). The system
// prompt is the style guide + the approved watercolour references: byte-for-byte stable, so it is cached (1-hour TTL). The user turn carries only the
// fields of ImageRequestInput that describe the meaning (lemma, pos, gloss_tr, visual_hint) and,
// on a redraw, a fixed sentence naming what was wrong. Nothing else reaches the model.

import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  generatedImage,
  IMAGE_MAX_BYTES,
  IMAGE_PROMPT_VERSION,
  IMAGE_WC_PALETTE,
  IMAGE_WC_WASHES,
  type GeneratedImage,
  type ImageRequestInput,
} from './image-contract.ts';
import { IMAGE_WC_REFS } from './image-wc-refs.ts';

export { IMAGE_PROMPT_VERSION };

/** Room for adaptive thinking plus an SVG of at most IMAGE_MAX_BYTES. */
// 8000 since 2026-10-25: Sonnet drawings use ~1k output tokens; a lower cap lets the budget guard
// reserve for 1,000+ pictures a night.
export const IMAGE_MAX_TOKENS = 8000;

/** What each watercolour palette role is for (the prompt's colour table). */
const ROLE_USE: Record<keyof typeof IMAGE_WC_PALETTE, string> = {
  pencil: 'every outline (the stroke of the pencil group), eyes, small dark marks',
  pencilSoft: 'faint helpers: arrows, ground lines, motion and steam strokes, distant outlines',
  washSand: 'backdrop wash for indoor, warm or neutral scenes and single objects',
  washSky: 'backdrop wash for sky, weather, water, cold and outdoor air',
  washSage: 'backdrop wash for nature, plants, gardens and fields',
  paper: 'off-white inner parts on top of a coloured shape (pages, plates, screens)',
  white: 'clouds, snow, highlights (with opacity); only on top of another shape',
  skin: 'skin of faces and hands',
  skinShade: 'shade side of skin, ears, a blush',
  hair: 'hair, beards, dark brown things',
  terracotta: 'red things, warm clothes, roofs, apples, anger',
  rust: 'shade of red and brown things (low opacity glazes)',
  coral: 'pink and light red: lips, blossoms, soft warm clothes',
  ochre: 'orange things, oranges, warm light, bread, bags',
  mustard: 'yellow: the sun, lemons, stars, lamps',
  sage: 'grass, leaves, light green things, "go"',
  leaf: 'darker leaves, trees, shade of green things',
  teal: 'calm clothes, glass, cool objects',
  slate: 'trousers, deep water, dark blue objects, shade of blue things',
  waterBlue: 'water, rain, ice, sky details, blue objects',
  plum: 'purple: flowers, fabric, special objects',
  wood: 'wood, trunks, furniture, baskets, bread crust',
  sand: 'sand, paths, paper bags, light stone, floors',
  stone: 'stone, walls, mountains, shade of sand',
  metal: 'metal, tools, cars, wheels, grey objects',
};

const palette = (Object.keys(IMAGE_WC_PALETTE) as (keyof typeof IMAGE_WC_PALETTE)[])
  .map((role) => `- ${IMAGE_WC_PALETTE[role][0]} ${role}: ${ROLE_USE[role]}`)
  .join('\n');

const washes = IMAGE_WC_WASHES.map((w) => IMAGE_WC_PALETTE[w][0]).join(', ');

const examples = IMAGE_WC_REFS.map(
  (r) =>
    `### ${r.lemma} (${r.pos})\nInput: ${JSON.stringify({ lemma: r.lemma, pos: r.pos, gloss_tr: r.gloss_tr, visual_hint: r.visual_hint })}\nIdea: ${r.idea}\nOutput: ${JSON.stringify({ drawable: true, svg: r.svg, alt_tr: r.alt_tr, confidence: 0.9 })}`,
).join('\n\n');

export const IMAGE_SYSTEM_PROMPT = `You draw small flashcard pictures for Turkish speakers learning English words. Each picture shows one meaning of one English word so that a learner who sees only the picture can recall the word. The learners are adults: the pictures are warm and friendly but never childish.

You receive one meaning as JSON: lemma (the English word), pos (part of speech), gloss_tr (the Turkish meaning; draw exactly this meaning, not another sense of the word) and visual_hint (an optional English idea of what to draw, or null). A redraw also has previous_problem: what was wrong with the last attempt; avoid it.

## Style: watercolour and pencil

Soft hand-drawn illustration, like a light watercolour sketch in a good picture book.
- Start with one backdrop wash: a large irregular blob (not a circle, not a rectangle) behind the subject, filled with one of the wash colours (${washes}), opacity 0.7–0.85, with filter="url(#wash)". It softly covers roughly the middle 70–85 % of the canvas.
- Then the drawing: shapes inside one or a few <g filter="url(#line)" stroke="${IMAGE_WC_PALETTE.pencil[0]}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"> groups, so every shape gets a thin, slightly wobbly pencil outline. Fills are flat palette colours, often a little transparent (opacity 0.8–0.95), like a watercolour wash inside the lines.
- Shading: a few extra shapes in a darker colour of the same family at low opacity (0.15–0.3), without outlines (stroke="none" or outside the pencil group), on the shade side. Highlights: white at low opacity. No gradients.
- Thick limbs and poles are two strokes on top of each other: a wider pencil stroke and a narrower coloured stroke, so they read as outlined tubes.
- One clear subject, large and centred, filling about two thirds of the canvas. A tiny scene with a person or context is welcome when it makes the meaning clearer (a child holding a parent's hand for "child"), but at most one or two supporting cues.
- People: simple and friendly, round heads in skin colour with dot eyes, a few strokes of hair, simple clothes in calm colours; no detailed faces unless the meaning is a feeling. Adults look like adults.
- Feelings are a clear face or posture; actions are a figure in mid-action; relations (between, under, behind) are simple objects with one faint arrow; abstract-but-drawable meanings use the most common everyday scene.
- No text of any kind: no letters, digits, words, labels, signs with writing, speech bubbles with words, or symbols that stand for letters.
- Draw nothing frightening, violent, sexual, religious or political; for such words show a calm, neutral cue or decline.

## Colours

Use only these hex values (light theme; the app swaps each for its dark-theme twin). Each role has a purpose:
${palette}

Contrast: the outlines carry the drawing on both themes. white, paper and the wash colours are only for the wash itself or on top of another shape, never as a subject on its own.

## SVG rules

- Exactly one root: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">. No width or height.
- Elements: g, path, circle, ellipse, rect, line, polyline, polygon. Nothing else: no defs, filter, use, clipPath, mask, gradient, pattern, text, image, style, title. The two filters are added by the app; only refer to them with filter="url(#wash)" (the backdrop wash, once) and filter="url(#line)" (the pencil groups).
- Attributes: d, points, cx, cy, r, rx, ry, x, y, x1, y1, x2, y2, width, height, fill, stroke, stroke-width, stroke-linecap, stroke-linejoin, transform, opacity, fill-opacity, stroke-opacity, fill-rule, filter. No id, class, style or href.
- fill and stroke are always one of the palette hex values or none. Give every shape an explicit fill (fill="none" for open strokes).
- Whole numbers or one decimal. Keep the SVG under ${Math.floor(IMAGE_MAX_BYTES / 1024) - 3} KB; around 2–4 KB is typical.

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
  ugly: 'The previous drawing did not match the style; follow the style rules and the examples closely.',
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
