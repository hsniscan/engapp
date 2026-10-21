// Interest topics (v0.2 İP7). The keys are language-independent and stable: they are stored
// in settings.interests / settings.muted_topics / sources.topics and returned by the extract
// prompt, so a key is never renamed or removed, only added. Display names live in i18n
// (`topics.<key>` in tr.json / en.json). Order here = order on screen.

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
 * The example-sentence contexts every word starts with (İP5). A context may also be a topic
 * key ("travel", "sports"): those are the contexts that grow with the user's interests.
 */
export const BASE_CONTEXTS = ['daily', 'business', 'technical', 'formal'] as const;
export type BaseContext = (typeof BASE_CONTEXTS)[number];

/** The base context whose sentences sound most like each topic. */
export const TOPIC_CONTEXT: Readonly<Record<TopicKey, BaseContext>> = {
  daily_life: 'daily',
  technology: 'technical',
  science: 'technical',
  business: 'business',
  health: 'daily',
  education: 'formal',
  travel: 'daily',
  food: 'daily',
  sports: 'daily',
  nature: 'daily',
  arts: 'daily',
  literature: 'daily',
  film: 'daily',
  games: 'daily',
  politics: 'formal',
  law: 'formal',
};

/**
 * Topics a liked or skipped example sentence says something about. An interest context
 * ("travel") is its own topic; a base context names the one topic it stands for. "formal"
 * says how a sentence sounds, not what it is about, so it counts for no topic.
 */
export function topicsForContext(context: string): TopicKey[] {
  if (isTopicKey(context)) return [context];
  switch (context) {
    case 'daily':
      return ['daily_life'];
    case 'business':
      return ['business'];
    case 'technical':
      return ['technology'];
    default:
      return [];
  }
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
