// The graded reading library's shared contract (decision 0047): levels, topics, lengths, the
// public columns of public.graded_texts and the shapes the app reads. Imported by the jobs
// (scripts/lib/graded-*.ts) and by the web client (src/data/library.ts), so both sides agree.
// Keys are never renamed or removed, only added.

import { z } from 'zod';

/** Prompt versions (stored with every text). */
export const GRADED_PROMPT_VERSION = 'graded-v1';
export const GRADED_CHECK_VERSION = 'gradedcheck-v1';

export const GRADED_LEVELS = ['A2', 'B1', 'B2', 'C1'] as const;
export type GradedLevel = (typeof GRADED_LEVELS)[number];

export const isGradedLevel = (v: unknown): v is GradedLevel =>
  typeof v === 'string' && (GRADED_LEVELS as readonly string[]).includes(v);

/** Running words per text, by level (plan: 150–600 words). */
export const GRADED_LENGTHS: Readonly<Record<GradedLevel, { min: number; max: number }>> = {
  A2: { min: 150, max: 250 },
  B1: { min: 220, max: 350 },
  B2: { min: 320, max: 480 },
  C1: { min: 420, max: 600 },
};

/**
 * Library topics. `core`: the first plan's ten topics (owner's list: iş İngilizcesi,
 * teknoloji, günlük yaşam, seyahat, bilim, sağlık, spor, kültür, tarih, haberler); the rest
 * are the profile's other interests (src/domain/topics.ts), added in later runs.
 * `interests`: the profile topics (TOPIC_KEYS) a text of this topic suits, so "Sana uygun"
 * can prefer the user's interests. Display names: i18n `library.topics.<key>`.
 */
export const GRADED_TOPICS = [
  { key: 'business', core: true, interests: ['business'] },
  { key: 'technology', core: true, interests: ['technology'] },
  { key: 'daily_life', core: true, interests: ['daily_life', 'food'] },
  { key: 'travel', core: true, interests: ['travel'] },
  { key: 'science', core: true, interests: ['science', 'nature'] },
  { key: 'health', core: true, interests: ['health'] },
  { key: 'sports', core: true, interests: ['sports'] },
  { key: 'culture', core: true, interests: ['arts', 'literature', 'film'] },
  { key: 'history', core: true, interests: ['education', 'politics'] },
  { key: 'news', core: true, interests: ['politics', 'law', 'science', 'technology'] },
  { key: 'education', core: false, interests: ['education'] },
  { key: 'food', core: false, interests: ['food'] },
  { key: 'nature', core: false, interests: ['nature'] },
  { key: 'arts', core: false, interests: ['arts'] },
  { key: 'literature', core: false, interests: ['literature'] },
  { key: 'film', core: false, interests: ['film'] },
  { key: 'games', core: false, interests: ['games'] },
  { key: 'politics', core: false, interests: ['politics'] },
  { key: 'law', core: false, interests: ['law'] },
] as const satisfies readonly { key: string; core: boolean; interests: readonly string[] }[];

export type GradedTopic = (typeof GRADED_TOPICS)[number]['key'];
export const GRADED_TOPIC_KEYS: readonly GradedTopic[] = GRADED_TOPICS.map((t) => t.key);
export const CORE_TOPIC_KEYS: readonly GradedTopic[] = GRADED_TOPICS.filter((t) => t.core).map(
  (t) => t.key,
);

export const isGradedTopic = (v: unknown): v is GradedTopic =>
  typeof v === 'string' && (GRADED_TOPIC_KEYS as readonly string[]).includes(v);

/** Profile interests a library topic suits (empty for an unknown topic). */
export function topicInterests(topic: string): readonly string[] {
  return GRADED_TOPICS.find((t) => t.key === topic)?.interests ?? [];
}

// ---------------------------------------------------------------------------
// What the app reads (anon / authenticated column grants in the migration)
// ---------------------------------------------------------------------------

/** Rows per catalogue page (the API's max_rows is 1000). */
export const GRADED_PAGE = 500;

/** The catalogue: everything a list and the suggestions need, without the sentences. */
export const GRADED_CATALOG_COLUMNS =
  'id, level, topic, title, words, tokens, cov_level, lemma_profile, target_lemmas, status, server_seq';

/** A text's body, fetched when it is opened. */
export const GRADED_BODY_COLUMNS = 'id, title, sentences, glosses, status';

const lemmaProfile = z
  .record(z.string().min(1).max(64), z.number().int().positive())
  .refine((r) => Object.keys(r).length <= 2000);

export const gradedCatalogRowSchema = z.object({
  id: z.string().uuid(),
  level: z.string().regex(/^(A1|A2|B1|B2|C1|C2)$/),
  topic: z.string().regex(/^[a-z_]{1,40}$/),
  title: z.string().min(1).max(120),
  words: z.number().int().min(1),
  tokens: z.number().int().min(0),
  cov_level: z.coerce.number().min(0).max(1),
  lemma_profile: lemmaProfile,
  target_lemmas: z.array(z.string().max(64)).max(20).default([]),
  status: z.enum(['checking', 'approved', 'rejected']),
  server_seq: z.coerce.number().int(),
});
export type GradedCatalogRow = z.infer<typeof gradedCatalogRowSchema>;

export const gradedSentenceSchema = z.object({
  en: z.string().min(1).max(600),
  tr: z.string().min(1).max(800),
  /** Object path of the en-US clip in the public `tts` bucket (tts-contract.ts ttsObjectPath). */
  audio_key: z.string().max(200).nullable().default(null),
  /** Paragraph index (0-based, non-decreasing). */
  p: z.number().int().min(0).default(0),
});
export type GradedSentence = z.infer<typeof gradedSentenceSchema>;

export const gradedGlossSchema = z.object({
  word: z.string().min(1).max(64),
  tr: z.string().min(1).max(120),
});
export type GradedGloss = z.infer<typeof gradedGlossSchema>;

export const gradedBodySchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(120),
  sentences: z.array(gradedSentenceSchema).min(1).max(160),
  glosses: z.array(gradedGlossSchema).max(40).default([]),
  status: z.enum(['checking', 'approved', 'rejected']),
});
export type GradedBodyRow = z.infer<typeof gradedBodySchema>;

/** Plain text of a text's sentences: paragraphs separated by a blank line. */
export function gradedPlainText(sentences: readonly Pick<GradedSentence, 'en' | 'p'>[]): string {
  const paras: string[][] = [];
  let cur = -1;
  for (const s of sentences) {
    if (s.p !== cur || paras.length === 0) {
      paras.push([]);
      cur = s.p;
    }
    paras.at(-1)!.push(s.en.trim());
  }
  return paras.map((p) => p.join(' ')).join('\n\n');
}
