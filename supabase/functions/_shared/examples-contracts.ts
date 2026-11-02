// The example-sentence catalogue (v0.2 İP5, docs/decisions/0013): level bands and the open
// context list of public.lexicon_examples. Shared by the web client (src/domain/examples.ts)
// and the Playwright fake backend. The on-demand ai-examples function that used to write the
// sentences was removed in v0.5.2 (ADR 0061): sentences are produced once in bulk and shipped
// as content; the app only displays them.

import type { CEFR_LEVELS } from './contracts.ts';

type CefrLevel = (typeof CEFR_LEVELS)[number];

/** Most contexts a user can choose for the card-front rotation. */
export const MAX_EXAMPLE_CONTEXTS = 4;
/** Fewest contexts a user can choose ("at least two contexts"). */
export const MIN_SELECTED_CONTEXTS = 2;

/**
 * Sentences are written for one of four level bands, so the shared cache serves more users:
 * A1/A2 → A2, B1 → B1, B2 → B2, C1/C2 → C1.
 */
export const LEVEL_BANDS = ['A2', 'B1', 'B2', 'C1'] as const;
export type LevelBand = (typeof LEVEL_BANDS)[number];

export function levelBand(level: CefrLevel): LevelBand {
  switch (level) {
    case 'A1':
    case 'A2':
      return 'A2';
    case 'B1':
      return 'B1';
    case 'B2':
      return 'B2';
    default:
      return 'C1';
  }
}

/**
 * The context catalogue. Order = display order. The Turkish labels live in src/i18n
 * (examples.contexts.<key>). The list is open: the database only checks the key format, and
 * sentences in a context this list does not know are shown with their key.
 */
export const EXAMPLE_CONTEXT_KEYS = [
  'daily',
  'conversation',
  'work',
  'formal',
  'academic',
  'technology',
  'travel',
  'health',
  'money',
  'culture',
  'sports',
  'nature',
] as const;
export type ExampleContext = (typeof EXAMPLE_CONTEXT_KEYS)[number];

export function isExampleContext(key: string): key is ExampleContext {
  return (EXAMPLE_CONTEXT_KEYS as readonly string[]).includes(key);
}

/** Default contexts: four registers almost every word is used in (everyday, spoken, work, formal written). */
export const DEFAULT_EXAMPLE_CONTEXTS: readonly ExampleContext[] = [
  'daily',
  'conversation',
  'work',
  'formal',
];

/** A shared example sentence (lexicon_examples row as the client stores it). */
export interface LexiconExampleRow {
  id: string;
  /** lexicon_senses.id */
  sense_id: string;
  context: string;
  level_band: LevelBand;
  text_en: string;
  /** [start, end) of the term in text_en. */
  span: [number, number];
  /** {"tr": "..."}: translations by language, independent of the language pair. */
  translations: Record<string, string>;
  status: 'active' | 'retired';
  /** epoch ms */
  updated_at: number;
}
