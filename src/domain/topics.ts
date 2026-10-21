// Interest topics (v0.2 İP7). The keys are language-independent and stable: they are stored
// in settings.interests / settings.muted_topics / sources.topics and returned by the extract
// prompt, so a key is never renamed or removed, only added. Display names live in i18n
// (`topics.<key>` in tr.json / en.json). Order here = order on screen.
import type { ExampleContext } from '../../supabase/functions/_shared/examples-contracts';

export const TOPIC_KEYS = [
  'daily_life',
  'technology',
  'science',
  'business',
  'health',
  'education',
  'travel',
  'food',
  'sports',
  'nature',
  'arts',
  'literature',
  'film',
  'games',
  'politics',
  'law',
] as const;

export type TopicKey = (typeof TOPIC_KEYS)[number];

const TOPIC_SET: ReadonlySet<string> = new Set(TOPIC_KEYS);

export function isTopicKey(value: unknown): value is TopicKey {
  return typeof value === 'string' && TOPIC_SET.has(value);
}

/**
 * Topic → example-sentence contexts it favours, in İP5's catalogue (examples-contracts.ts,
 * EXAMPLE_CONTEXTS). orderContexts scores a context with the weights of the topics that
 * list it, so the context tab of the user's interests opens first.
 * "conversation" and "formal" are registers (how a sentence sounds, not what it is about):
 * politics and law favour "formal" (news, notices), nothing favours "conversation".
 */
export const TOPIC_CONTEXTS: Readonly<Record<TopicKey, readonly ExampleContext[]>> = {
  daily_life: ['daily'],
  technology: ['technology'],
  science: ['nature', 'academic'],
  business: ['work', 'money'],
  health: ['health'],
  education: ['academic'],
  travel: ['travel'],
  food: ['daily'],
  sports: ['sports'],
  nature: ['nature'],
  arts: ['culture'],
  literature: ['culture'],
  film: ['culture'],
  games: ['culture'],
  politics: ['formal'],
  law: ['formal'],
};

/**
 * The one topic a liked or skipped sentence of a context counts for (its main subject).
 * Registers ("conversation", "formal") are absent: feedback on them counts for no topic.
 * Every entry is a context its topic lists in TOPIC_CONTEXTS (tested).
 */
export const CONTEXT_TOPIC: Readonly<Partial<Record<ExampleContext, TopicKey>>> = {
  daily: 'daily_life',
  work: 'business',
  money: 'business',
  academic: 'education',
  technology: 'technology',
  travel: 'travel',
  health: 'health',
  culture: 'arts',
  sports: 'sports',
  nature: 'nature',
};

/** Topics a liked or skipped example sentence says something about (none or one). */
export function topicsForContext(context: string): TopicKey[] {
  const topic = (CONTEXT_TOPIC as Readonly<Record<string, TopicKey | undefined>>)[context];
  return topic ? [topic] : [];
}

/** Accepts "Technology", " daily-life ", "daily life" for daily_life etc. */
function normalizeKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/**
 * Topic keys from untrusted input (an AI response, a pulled row): unknown values are
 * dropped, duplicates removed, order kept, at most `max`.
 */
export function parseTopics(raw: unknown, max = 2): TopicKey[] {
  if (!Array.isArray(raw)) return [];
  const out: TopicKey[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const key = normalizeKey(v);
    if (isTopicKey(key) && !out.includes(key)) out.push(key);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The topics of a whole text from its chunks' topics (each chunk returns 1–2): topics named
 * by at least a quarter of the chunks, most frequent first, at most `max`. A text of one or
 * two chunks keeps everything its chunks named.
 */
export function aggregateTopics(chunkTopics: readonly (readonly unknown[])[], max = 3): TopicKey[] {
  const counts = new Map<TopicKey, number>();
  for (const chunk of chunkTopics) {
    for (const t of parseTopics(chunk, 2)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const min = Math.max(1, Math.ceil(chunkTopics.length / 4));
  return [...counts.entries()]
    .filter(([, n]) => n >= min)
    .sort((a, b) => b[1] - a[1] || TOPIC_KEYS.indexOf(a[0]) - TOPIC_KEYS.indexOf(b[0]))
    .slice(0, max)
    .map(([t]) => t);
}
