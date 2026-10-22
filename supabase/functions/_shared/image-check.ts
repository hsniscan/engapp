// Automatic picture check (decision 0030, docs/ai-image.md):
//   1. token contrast: every colour the SVG uses, against the backdrop, in both themes (pure);
//   2. pixel coverage of the rendered PNGs (the Node job renders them, see scripts/lib/render.ts);
//   3. prompt imagecheck-v1 (Haiku, vision): does the picture show the meaning, any text, clutter?
// A failure gives one redraw with the matching REDRAW_PROBLEMS sentence; a second failure rejects.

import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  IMAGE_CHECK_PROMPT_VERSION,
  IMAGE_DARK_SWAP,
  IMAGE_PALETTE,
  type ImageRequestInput,
} from './image-contract.ts';
import { answerText, type ModelMessage, type RedrawProblem } from './image-prompt.ts';
import { svgColors } from './svg-sanitize.ts';

export { IMAGE_CHECK_PROMPT_VERSION };

export const BACKDROP = IMAGE_PALETTE.soft;
export const BACKDROP_CIRCLE = `<circle cx="128" cy="128" r="114" fill="${BACKDROP[0]}"/>`;

/** Below this ratio against the backdrop a colour is a detail colour (only on other shapes). */
export const DETAIL_CONTRAST = 1.4;
/** At least one colour of the subject must reach this ratio in both themes. */
export const SUBJECT_CONTRAST = 2;

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrastRatio(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export interface ColorContrast {
  color: string;
  light: number;
  dark: number;
}

export interface ContrastReport {
  ok: boolean;
  /** Why it failed: no backdrop circle, or no colour that stands out in both themes. */
  problem: 'no_backdrop' | 'low_contrast' | null;
  colors: ColorContrast[];
  /** Colours below DETAIL_CONTRAST in a theme (allowed only on top of other shapes). */
  detail: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Token contrast check of a sanitised SVG. Pure; runs in the edge function too. */
export function contrastCheck(svg: string): ContrastReport {
  const [bgLight] = BACKDROP;
  const bgDark = IMAGE_DARK_SWAP.get(bgLight)!;
  // The root's fill is only the sanitizer's default for shapes without one: not a drawn colour.
  const colors = svgColors(svg.replace(/^<svg[^>]*>/, ''))
    .filter((c) => c !== bgLight)
    .map((c) => ({
      color: c,
      light: r2(contrastRatio(c, bgLight)),
      dark: r2(contrastRatio(IMAGE_DARK_SWAP.get(c) ?? c, bgDark)),
    }));
  const detail = colors
    .filter((c) => c.light < DETAIL_CONTRAST || c.dark < DETAIL_CONTRAST)
    .map((c) => c.color);
  const hasBackdrop = svg.includes(BACKDROP_CIRCLE);
  const subject = colors.some((c) => c.light >= SUBJECT_CONTRAST && c.dark >= SUBJECT_CONTRAST);
  const problem = !hasBackdrop ? 'no_backdrop' : !subject ? 'low_contrast' : null;
  return { ok: problem === null, problem, colors, detail };
}

// ---------------------------------------------------------------------------
// Pixel coverage (rendered PNGs, Node only)
// ---------------------------------------------------------------------------

/** Share of the backdrop circle covered by pixels that stand out from it in both themes. */
export const MIN_COVERAGE = 0.04;

/**
 * Fraction of the pixels inside the backdrop circle whose colour differs from the backdrop by
 * at least DETAIL_CONTRAST. `rgba` is a size×size RGBA buffer rendered with no background.
 */
export function visibleCoverage(rgba: Uint8Array, size: number, theme: 'light' | 'dark'): number {
  const bg = theme === 'light' ? BACKDROP[0] : BACKDROP[1];
  const bgL = luminance(bg);
  const s = size / 256;
  let inside = 0;
  let visible = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / s - 128;
      const dy = (y + 0.5) / s - 128;
      if (dx * dx + dy * dy > 110 * 110) continue;
      inside++;
      const i = (y * size + x) * 4;
      const a = rgba[i + 3]! / 255;
      if (a < 0.5) continue;
      const lin = (v: number) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      const l = 0.2126 * lin(rgba[i]!) + 0.7152 * lin(rgba[i + 1]!) + 0.0722 * lin(rgba[i + 2]!);
      const ratio = (Math.max(l, bgL) + 0.05) / (Math.min(l, bgL) + 0.05);
      if (ratio >= DETAIL_CONTRAST) visible++;
    }
  }
  return inside === 0 ? 0 : visible / inside;
}

// ---------------------------------------------------------------------------
// imagecheck-v1 (vision)
// ---------------------------------------------------------------------------

export const CHECK_MAX_TOKENS = 4000;

export const IMAGE_CHECK_SYSTEM_PROMPT = `You review small flashcard pictures for Turkish speakers learning English words. Each picture should let a learner recall one meaning of one English word from the picture alone.

You get the meaning as JSON (lemma: the English word, pos: part of speech, gloss_tr: the Turkish meaning) and the same picture twice: on the light theme, then on the dark theme.

Answer with JSON only: {"depicts_sense": boolean, "has_text": boolean, "clutter": boolean, "confidence": number}.
- depicts_sense: true if a learner who knows the meaning would name this word (or an obvious synonym) from the picture, in this meaning; false if it shows another meaning or nothing recognisable.
- has_text: true if any letters, digits, words or letter-like marks appear.
- clutter: true if the picture is too busy to read at 120 pixels, or a part is hard to see on either theme.
- confidence: 0 to 1, how sure you are of depicts_sense.`;

export const IMAGE_CHECK_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['depicts_sense', 'has_text', 'clutter', 'confidence'],
  properties: {
    depicts_sense: { type: 'boolean' },
    has_text: { type: 'boolean' },
    clutter: { type: 'boolean' },
    confidence: { type: 'number' },
  },
} as const;

/** The meaning as the checker sees it (no hint: it judges the picture, not the plan). */
export function checkUserText(input: ImageRequestInput): string {
  return JSON.stringify({ lemma: input.lemma, pos: input.pos, gloss_tr: input.gloss_tr });
}

export function buildCheckRequest(
  input: ImageRequestInput,
  png: { light: string; dark: string },
  opts: { model: string },
): Anthropic.MessageCreateParamsNonStreaming {
  const img = (data: string): Anthropic.ImageBlockParam => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data },
  });
  return {
    model: opts.model,
    max_tokens: CHECK_MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: IMAGE_CHECK_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      },
    },
    system: [
      { type: 'text', text: IMAGE_CHECK_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: checkUserText(input) }, img(png.light), img(png.dark)],
      },
    ],
  };
}

export const visionVerdict = z.object({
  depicts_sense: z.boolean(),
  has_text: z.boolean(),
  clutter: z.boolean(),
  confidence: z.number().min(0).max(1),
});
export type VisionVerdict = z.infer<typeof visionVerdict>;

export function parseCheckResponse(message: ModelMessage): VisionVerdict | null {
  if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') return null;
  try {
    const v = visionVerdict.safeParse(JSON.parse(answerText(message)));
    return v.success ? v.data : null;
  } catch {
    return null;
  }
}

/** Below this the checker is not sure enough that the picture shows the meaning. */
export const MIN_CHECK_CONFIDENCE = 0.6;

/** The first problem of a vision verdict, or null when it passes. */
export function verdictProblem(v: VisionVerdict): RedrawProblem | null {
  if (v.has_text) return 'has_text';
  if (!v.depicts_sense || v.confidence < MIN_CHECK_CONFIDENCE) return 'wrong_meaning';
  if (v.clutter) return 'clutter';
  return null;
}
