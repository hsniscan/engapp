// Contracts of the ai-examples edge function (v0.2 İP5, docs/decisions/0013). Imported by
// the function (Deno) and by the web client (src/ai/, src/domain/), so both sides share the
// context list, the level bands and the request/response schemas.

import { z } from 'zod';
import { usageInfo, type CEFR_LEVELS } from './contracts.ts';

type CefrLevel = (typeof CEFR_LEVELS)[number];

/** Version of the examples prompt and response schema. Bump with every change (examples-prompt.ts). */
export const EXAMPLES_PROMPT_VERSION = 'examples-v1';

/** Senses per model request ("8 anlam bir çağrıda"). */
export const MAX_EXAMPLE_SENSES = 8;
/** Contexts asked per sense in one request. */
export const MAX_EXAMPLE_CONTEXTS = 4;
/** Contexts a user can choose for the background preparation (MIN keeps "at least two contexts"). */
export const MIN_SELECTED_CONTEXTS = 2;
/** Server validation of one sentence. */
export const MAX_EXAMPLE_WORDS = 25;
export const MAX_EXAMPLE_CHARS = 300;
export const MAX_EXAMPLE_TR_CHARS = 600;

/**
 * Sentences are written for one of four level bands, so the shared cache serves more users:
 * A1/A2 → A2, B1 → B1, B2 → B2, C1/C2 → C1.
 */
export const LEVEL_BANDS = ['A2', 'B1', 'B2', 'C1'] as const;
export type LevelBand = (typeof LEVEL_BANDS)[number];
export const levelBandSchema = z.enum(LEVEL_BANDS);

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
 * The context catalogue. Order = display order. `prompt` is what the model reads; the
 * Turkish labels live in src/i18n (examples.contexts.<key>). The list is open: a new
 * context is a new entry here (and a label), the database only checks the key format.
 */
export const EXAMPLE_CONTEXTS = [
  { key: 'daily', prompt: 'everyday life: home, family, friends, food, shopping, chores, free time' },
  {
    key: 'conversation',
    prompt: 'informal spoken English: chatting with friends, phone calls, text messages',
  },
  { key: 'work', prompt: 'the workplace: offices, meetings, emails, colleagues, customers, careers' },
  {
    key: 'formal',
    prompt: 'formal written English: official letters, announcements, news reports, public notices',
  },
  { key: 'academic', prompt: 'school and university: lessons, exams, essays, lectures, research' },
  { key: 'technology', prompt: 'technology: computers, software, the internet, phones, engineering' },
  { key: 'travel', prompt: 'travel: trips, transport, airports, hotels, directions, holidays' },
  { key: 'health', prompt: 'health: the body, illness, doctors, hospitals, fitness, healthy living' },
  { key: 'money', prompt: 'money: prices, shopping, banks, bills, saving, the economy' },
  { key: 'culture', prompt: 'culture and entertainment: films, books, music, games, art' },
  { key: 'sports', prompt: 'sports: matches, teams, training, competitions' },
  { key: 'nature', prompt: 'nature and science: animals, plants, weather, the environment, space' },
] as const;
export type ExampleContext = (typeof EXAMPLE_CONTEXTS)[number]['key'];
export const EXAMPLE_CONTEXT_KEYS: readonly ExampleContext[] = EXAMPLE_CONTEXTS.map((c) => c.key);

export function isExampleContext(key: string): key is ExampleContext {
  return (EXAMPLE_CONTEXT_KEYS as readonly string[]).includes(key);
}

/**
 * Default contexts: four registers almost every word is used in (everyday, spoken, work,
 * formal written). Topic contexts (technology, travel, …) are chosen in Settings or asked
 * for one by one on a card.
 */
export const DEFAULT_EXAMPLE_CONTEXTS: readonly ExampleContext[] = [
  'daily',
  'conversation',
  'work',
  'formal',
];

/** Key format only (the database CHECK is the same): newer clients may know more contexts. */
export const contextKeySchema = z.string().regex(/^[a-z][a-z_]{1,31}$/);

/** Lexicon ids: UUIDs in production, short ids in the in-memory test store. */
const senseId = z.string().regex(/^[0-9A-Za-z-]{1,64}$/);

export const examplesRequest = z.object({
  /** Lexicon sense ids (lexicon_senses.id). The server reads lemma, pos and gloss itself. */
  sense_ids: z.array(senseId).min(1).max(MAX_EXAMPLE_SENSES),
  level_band: levelBandSchema,
  contexts: z.array(contextKeySchema).min(1).max(MAX_EXAMPLE_CONTEXTS),
  /**
   * "Yenisini üret": one more sentence for this sense and context, different from the
   * existing ones. sense_ids and contexts are then ignored.
   */
  fresh: z.object({ sense_id: senseId, context: contextKeySchema }).optional(),
});
export type ExamplesRequest = z.input<typeof examplesRequest>;

/** A shared example sentence (lexicon_examples row as the client stores it). */
export const lexiconExample = z.object({
  id: z.string(),
  /** lexicon_senses.id */
  sense_id: z.string(),
  context: z.string(),
  level_band: levelBandSchema,
  text_en: z.string(),
  /** [start, end) of the term in text_en (computed by the server). */
  span: z.tuple([z.number().int(), z.number().int()]),
  /** {"tr": "..."}: translations by language, independent of the language pair. */
  translations: z.record(z.string(), z.string()),
  status: z.enum(['active', 'retired']),
  /** epoch ms */
  updated_at: z.number(),
});
export type LexiconExampleRow = z.infer<typeof lexiconExample>;

export const examplesResponse = z.object({
  prompt_version: z.string(),
  ai_called: z.boolean(),
  model: z.string().nullable(),
  level_band: levelBandSchema,
  /** Every active example of the requested senses in this band (all contexts). */
  examples: z.array(lexiconExample),
  /** Examples written by this request. */
  new_ids: z.array(z.string()),
  counts: z.object({
    /** (sense, context) pairs asked for */
    requested: z.number(),
    /** of those, answered from the shared lexicon */
    cached: z.number(),
    /** sentences written and stored by this request */
    generated: z.number(),
    /** sentences the server discarded, by reason */
    dropped: z.record(z.string(), z.number()),
  }),
  usage: usageInfo.nullable(),
});
export type ExamplesResponse = z.infer<typeof examplesResponse>;
