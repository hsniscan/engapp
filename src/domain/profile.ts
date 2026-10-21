// Interest profile (v0.2 İP7): how much each topic matters to the user, and why.
// Weights are computed on the device from synced data every time; they are never stored.
//
// Fixed rule (docs/decisions/0015-interests-profile.md):
//   weight = 3 if the user picked the topic
//          + 1 for each imported text about it, halved every 60 days
//          + 0.5 for each liked example sentence about it, halved every 60 days
//          − 0.25 for each skipped one, halved every 60 days
//   never below 0; a topic the user turned off weighs 0.
import { isTopicKey, TOPIC_CONTEXT, TOPIC_KEYS, type TopicKey, topicsForContext } from './topics';
import type { Millis } from './types';

export const PROFILE_RULE = {
  selected: 3,
  text: 1,
  like: 0.5,
  skip: 0.25,
  halfLifeDays: 60,
} as const;

const DAY_MS = 86_400_000;

/** 1 now, 0.5 after one half-life, …; a future timestamp counts as now. */
export function decayFactor(at: Millis, now: Millis, halfLifeDays: number = PROFILE_RULE.halfLifeDays): number {
  const ageDays = Math.max(0, now - at) / DAY_MS;
  return 0.5 ** (ageDays / halfLifeDays);
}

/** What the rule needs from a `sources` row. */
export interface ProfileSource {
  topics?: readonly string[] | null;
  created_at: Millis;
  deleted_at: Millis | null;
}

/**
 * One verdict on an example sentence (İP5 `content_feedback`, joined with the sentence's
 * context). 'reject' means "this sentence is wrong", not "this topic bores me": it is ignored.
 */
export interface FeedbackSignal {
  context: string;
  verdict: 'like' | 'skip' | 'reject';
  at: Millis;
}

export interface ProfileInput {
  now: Millis;
  /** settings.interests; null/undefined = never asked. Unknown keys are ignored. */
  interests?: readonly string[] | null;
  /** settings.muted_topics. */
  muted?: readonly string[] | null;
  sources?: readonly ProfileSource[];
  feedback?: readonly FeedbackSignal[];
}

export interface TopicWeight {
  topic: TopicKey;
  weight: number;
  /** The reasons, for "neden". Counts are plain counts; only the weight decays. */
  selected: boolean;
  muted: boolean;
  texts: number;
  likes: number;
  skips: number;
  /** created_at of the newest text about the topic. */
  lastTextAt: Millis | null;
}

/** Every topic with its weight, heaviest first (ties in list order). */
export function topicWeights(input: ProfileInput): TopicWeight[] {
  const { now } = input;
  const selected = new Set((input.interests ?? []).filter(isTopicKey));
  const muted = new Set((input.muted ?? []).filter(isTopicKey));
  const rows = new Map<TopicKey, TopicWeight & { raw: number }>(
    TOPIC_KEYS.map((topic) => [
      topic,
      {
        topic,
        weight: 0,
        raw: selected.has(topic) ? PROFILE_RULE.selected : 0,
        selected: selected.has(topic),
        muted: muted.has(topic),
        texts: 0,
        likes: 0,
        skips: 0,
        lastTextAt: null,
      },
    ]),
  );

  for (const s of input.sources ?? []) {
    if (s.deleted_at !== null) continue;
    const f = decayFactor(s.created_at, now) * PROFILE_RULE.text;
    for (const topic of new Set((s.topics ?? []).filter(isTopicKey))) {
      const r = rows.get(topic)!;
      r.raw += f;
      r.texts++;
      if (r.lastTextAt === null || s.created_at > r.lastTextAt) r.lastTextAt = s.created_at;
    }
  }

  for (const fb of input.feedback ?? []) {
    if (fb.verdict === 'reject') continue;
    const f = decayFactor(fb.at, now);
    for (const topic of topicsForContext(fb.context)) {
      const r = rows.get(topic)!;
      if (fb.verdict === 'like') {
        r.raw += PROFILE_RULE.like * f;
        r.likes++;
      } else {
        r.raw -= PROFILE_RULE.skip * f;
        r.skips++;
      }
    }
  }

  const out: TopicWeight[] = [];
  for (const { raw, ...r } of rows.values()) {
    // Rounded so that floating noise never reorders equal topics.
    out.push({ ...r, weight: r.muted ? 0 : Math.max(0, Math.round(raw * 1000) / 1000) });
  }
  // Array.prototype.sort is stable: equal weights keep TOPIC_KEYS order.
  return out.sort((a, b) => b.weight - a.weight);
}

/** Topics with a positive weight, heaviest first ("ilgi alanımdan" practice, theme names). */
export function rankedTopics(weights: readonly TopicWeight[]): TopicKey[] {
  return [...weights].filter((w) => w.weight > 0).sort((a, b) => b.weight - a.weight).map((w) => w.topic);
}

/**
 * Orders example-sentence contexts by the profile, heaviest first. A context scores the
 * weight of the topic with the same key (an interest context such as "travel") plus the
 * weights of the topics that fall under it (TOPIC_CONTEXT: technology and science → "technical").
 * Contexts with equal scores — including everything when the profile is empty — keep the
 * order they were given in, so the caller's default order is the fallback.
 */
export function orderContexts<C extends string>(contexts: readonly C[], weights: readonly TopicWeight[]): C[] {
  const score = (c: string): number => {
    let s = 0;
    for (const w of weights) if (w.topic === c || TOPIC_CONTEXT[w.topic] === c) s += w.weight;
    return s;
  };
  return contexts
    .map((c, i) => ({ c, i, s: score(c) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c);
}

// ------------------------------------------------------------------ sync merge

const PROFILE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  settings: ['interests', 'muted_topics'],
  sources: ['topics'],
};

/**
 * A row written by a client that does not know the profile fields arrives without them
 * (null). Like the server's `keep_profile_fields` trigger, keep the local values then: a
 * missing list means "unknown", an empty list means "none".
 */
export function keepProfileFields<T extends object>(table: string, incoming: T, local: object | undefined): T {
  const fields = PROFILE_FIELDS[table];
  if (!fields || !local) return incoming;
  let out = incoming;
  for (const f of fields) {
    const theirs = (incoming as Record<string, unknown>)[f];
    const ours = (local as Record<string, unknown>)[f];
    if (theirs == null && ours != null) out = { ...out, [f]: ours };
  }
  return out;
}

/**
 * Adds or removes `topic` from a stored list, keeping keys this version does not know (a newer
 * device may have written them).
 */
export function toggleInList(list: readonly string[] | null | undefined, topic: TopicKey, on: boolean): string[] {
  const rest = (list ?? []).filter((t) => t !== topic);
  return on ? [...rest, topic] : rest;
}
