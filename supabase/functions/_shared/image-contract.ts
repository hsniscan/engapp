// Shared contract of v0.4 picture cards (plan/v0.4-plan.md, Annex A.2–A.4). Imported by the
// image pipeline (Deno edge function and the Node batch script) and by the web client. Written
// before the work packages so they can run in parallel; each package fills in its own part and
// keeps these names.
//
// Pictures are SVG drawn in style B ("düz renk": flat shapes, no ink outlines, a soft backdrop
// circle, 256×256). A stored SVG uses ONLY the light-theme hex values below (plus `none`), so a
// raw file previews correctly; the client swaps each light value for its dark twin when the
// dark theme is on. The sanitizer refuses any other colour.

import { z } from 'zod';

/** Every picture is drawn on this canvas. */
export const IMAGE_VIEWBOX = '0 0 256 256';

/** Largest stored SVG, in bytes (UTF-8). */
export const IMAGE_MAX_BYTES = 8192;

/**
 * The palette: role → [light, dark]. Light values are the stored ones. Lowercase hex, unique
 * light values (the dark swap is a plain lookup). Okabe-Ito hues, tuned to the app's warm
 * paper and warm charcoal themes.
 */
export const IMAGE_PALETTE = {
  ink: ['#2b2824', '#ece6dc'],
  inkFlat: ['#5a5249', '#cfc6b8'],
  inkFaint: ['#b8ae9f', '#6e665b'],
  inkOnRed: ['#3a1a08', '#2a1206'],
  paper: ['#fffdf8', '#3a3631'],
  soft: ['#e6edf5', '#253244'],
  white: ['#ffffff', '#f2efe9'],
  red: ['#d55e00', '#e4692a'],
  orange: ['#e69f00', '#ebaa1e'],
  yellow: ['#f0e442', '#e8dc5a'],
  green: ['#009e73', '#1eae84'],
  sky: ['#56b4e9', '#68beec'],
  blue: ['#2a6fb0', '#3f86c8'],
  blueDark: ['#1d5490', '#2c6aa6'],
  purple: ['#cc79a7', '#d88db6'],
  stem: ['#6b4a2b', '#a7774b'],
  stone: ['#cdbfa8', '#8d8170'],
  stoneDark: ['#a8977c', '#6c6253'],
  skin: ['#e9b98c', '#d7a57a'],
} as const satisfies Record<string, readonly [string, string]>;

export type ImagePaletteRole = keyof typeof IMAGE_PALETTE;

/**
 * Watercolour palette (image-v2, owner's choice on 2026-10-25): muted washes with pencil
 * outlines. Same rules as IMAGE_PALETTE (role → [light, dark], unique light values); the two
 * palettes share no hex value, so style-B pictures keep rendering until they are redrawn.
 */
export const IMAGE_WC_PALETTE = {
  pencil: ['#4a4440', '#e6ded2'],
  pencilSoft: ['#8f857a', '#a39a8e'],
  washSand: ['#f1dfc0', '#4b4335'],
  washSky: ['#d6e6ec', '#33434b'],
  washSage: ['#e1e9d2', '#3a4331'],
  paper: ['#fbf6ec', '#47423a'],
  white: ['#fefefe', '#f4f1eb'],
  skin: ['#ecc9a6', '#d8b08c'],
  skinShade: ['#d9a77f', '#bb9068'],
  hair: ['#6b4a35', '#a8825f'],
  terracotta: ['#c2654a', '#d47b60'],
  rust: ['#8e4a36', '#b06650'],
  coral: ['#e88a7a', '#ea9a8b'],
  ochre: ['#e0a06e', '#e4ad7e'],
  mustard: ['#f0c45a', '#e6c264'],
  sage: ['#7f9e6a', '#8fb07a'],
  leaf: ['#5d7d4e', '#7c9c69'],
  teal: ['#8fb3a6', '#86aa9d'],
  slate: ['#5b6b80', '#8496ad'],
  waterBlue: ['#7fa9c4', '#7aa5c0'],
  plum: ['#a98aa8', '#bea0bd'],
  wood: ['#a87a52', '#bb8d63'],
  sand: ['#d9c3a0', '#8f826b'],
  stone: ['#b3a690', '#7a6f5d'],
  metal: ['#9a958e', '#8b867f'],
} as const satisfies Record<string, readonly [string, string]>;

export type ImageWcRole = keyof typeof IMAGE_WC_PALETTE;

/** The backdrop washes: every image-v2 picture starts with one of these under the wash filter. */
export const IMAGE_WC_WASHES = [
  'washSand',
  'washSky',
  'washSage',
] as const satisfies readonly ImageWcRole[];

/** Both palettes, light → dark. */
const ALL_PAIRS: readonly (readonly [string, string])[] = [
  ...Object.values(IMAGE_PALETTE),
  ...Object.values(IMAGE_WC_PALETTE),
];

/** The light hex values a stored SVG may use. */
export const IMAGE_ALLOWED_COLORS: ReadonlySet<string> = new Set(ALL_PAIRS.map(([light]) => light));

/** light hex → dark hex. */
export const IMAGE_DARK_SWAP: ReadonlyMap<string, string> = new Map(
  ALL_PAIRS.map(([light, dark]) => [light, dark]),
);

/**
 * The two watercolour filters of image-v2, fixed byte for byte. The model only refers to them
 * (filter="url(#line)" on pencil-drawn groups, filter="url(#wash)" on the backdrop wash); the
 * sanitizer puts this block in when a picture uses them, and no other <defs> is ever accepted.
 * Pictures are shown through <img>, so the ids never meet another picture's.
 */
export const IMAGE_WC_FILTERS = ['line', 'wash'] as const;
export const IMAGE_WC_DEFS =
  '<defs>' +
  '<filter id="line" x="-5%" y="-5%" width="110%" height="110%">' +
  '<feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="3"/>' +
  '<feDisplacementMap in="SourceGraphic" scale="4"/>' +
  '</filter>' +
  '<filter id="wash" x="-15%" y="-15%" width="130%" height="130%">' +
  '<feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="3" seed="7"/>' +
  '<feDisplacementMap in="SourceGraphic" scale="18"/>' +
  '<feGaussianBlur stdDeviation="3"/>' +
  '</filter>' +
  '</defs>';

/** Prompt versions (part of what is stored with each row). */
export const IMAGE_PROMPT_VERSION = 'image-v2';
/** The style-B prompt: its pictures are replaced by image-v2 ones as those are stored. */
export const IMAGE_PROMPT_VERSION_FLAT = 'image-v1';
export const VISUAL_PROMPT_VERSION = 'visual-v1';
export const IMAGE_CHECK_PROMPT_VERSION = 'imagecheck-v1';

/** What a generation request may contain. Nothing else ever reaches the model. */
export const imageRequestInput = z.object({
  sense_id: z.string().uuid(),
  lemma: z.string().min(1).max(120),
  pos: z.string().min(1).max(40),
  gloss_tr: z.string().min(1).max(200),
  visual_hint: z.string().max(300).nullable(),
});
export type ImageRequestInput = z.infer<typeof imageRequestInput>;

/** The model's structured answer for one picture. */
export const generatedImage = z.object({
  svg: z.string().min(1),
  alt_tr: z.string().min(1).max(200),
  confidence: z.number().min(0).max(1),
});
export type GeneratedImage = z.infer<typeof generatedImage>;

/** Visualizability score: 0 abstract … 3 concrete scene. Auto-queued from 2 up. */
// 1 since 2026-10-25: the owner wants every word drawn; the model still declines (drawable:
// false) where no picture fits, and 0 ("a picture would mislead") is never queued.
export const VISUAL_AUTO_MIN = 1;

export const IMAGE_STATUSES = ['checking', 'review', 'approved', 'rejected'] as const;
export type ImageStatus = (typeof IMAGE_STATUSES)[number];

/**
 * A row of public.lexicon_images as the client reads it (approved rows, plus 'review' rows for
 * senses in the reader's own cards). Server-only columns (cost, check details) are left out.
 */
export const lexiconImageRow = z.object({
  id: z.string().uuid(),
  sense_id: z.string().uuid(),
  variant: z.number().int().min(0),
  svg: z.string(),
  alt_tr: z.string(),
  status: z.enum(IMAGE_STATUSES),
  created_at: z.string(),
});
export type LexiconImageRow = z.infer<typeof lexiconImageRow>;

/** Result of the SVG sanitizer (implemented in svg-sanitize.ts, İP2). */
export type SanitizeResult = { ok: true; svg: string } | { ok: false; reason: string };

/** Light → dark: swap every allowed light colour for its dark twin. Pure string work. */
export function svgForTheme(svg: string, theme: 'light' | 'dark'): string {
  if (theme === 'light') return svg;
  return svg.replace(/#[0-9a-fA-F]{6}\b/g, (hex) => IMAGE_DARK_SWAP.get(hex.toLowerCase()) ?? hex);
}

// ---------------------------------------------------------------------------
// Server surface used by the client (İP2 implements, İP3/İP4 call).
// ---------------------------------------------------------------------------

/** `ai-image` edge function: draw one picture now (signed-in users, daily limit, budget). */
export const aiImageRequest = z.object({ sense_id: z.string().uuid() });
export const aiImageResponse = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), image: lexiconImageRow }),
  z.object({
    ok: z.literal(false),
    /** daily_limit: 10 a day used; budget: this month's picture budget is spent;
     *  not_visual: the model declined (nothing sensible to draw); failed: check failed twice. */
    reason: z.enum(['daily_limit', 'budget', 'not_visual', 'failed']),
  }),
]);
export type AiImageResponse = z.infer<typeof aiImageResponse>;

/** Pictures drawn on demand per user per day. */
export const IMAGE_DAILY_LIMIT = 10;

/** Database functions (supabase.rpc). Admin ones check public.app_admins server-side. */
export const IMAGE_RPC = {
  /** () → boolean */
  isAdmin: 'is_app_admin',
  /** (p_limit int) → rows {image: LexiconImageRow, lemma, pos, gloss_tr} oldest first, status 'review' */
  reviewQueue: 'image_review_queue',
  /** (p_image_id uuid, p_decision 'approve'|'reject'|'redraw', p_reason text|null) → void */
  reviewDecide: 'image_review_decide',
} as const;

export const IMAGE_REJECT_REASONS = ['wrong_meaning', 'unclear', 'ugly', 'other'] as const;
export type ImageRejectReason = (typeof IMAGE_REJECT_REASONS)[number];
