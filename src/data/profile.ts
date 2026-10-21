// Interest profile (v0.2 İP7): reads for the profile screen and for other features, and the
// few writes that change it. The rule itself is pure: domain/profile.ts.
import {
  type FeedbackSignal,
  orderContexts,
  rankedTopics,
  toggleInList,
  topicWeights,
  type TopicWeight,
} from '../domain/profile';
import { EXAMPLE_TARGET } from '../domain/examples';
import { isTopicKey, parseTopics, type TopicKey } from '../domain/topics';
import type { Id, Millis, Settings } from '../domain/types';
import { db } from './db';
import { ActionError } from './errors';
import { defaultSettings, SETTINGS_ID } from './settings';
import { writeTx } from './writer';

export interface TopicProfile {
  /** Every topic, heaviest first. */
  weights: TopicWeight[];
  /** Topics with a positive weight, heaviest first. */
  ranked: TopicKey[];
  /** settings.interests, known keys only. */
  interests: TopicKey[];
  /** The user has answered the interests question (picked, or chose "Şimdi değil"). */
  asked: boolean;
}

/**
 * Example-sentence verdicts for the profile: live `content_feedback` rows on shared example
 * sentences (İP5, target_kind 'example'), each joined with its sentence's context in the
 * local lexicon_examples cache. A verdict whose sentence is not cached (yet) is left out;
 * 'reject' rows are returned and ignored by the rule.
 */
export async function loadFeedbackSignals(): Promise<FeedbackSignal[]> {
  const rows = (
    await db.content_feedback
      .where('[target_kind+target_id]')
      .between([EXAMPLE_TARGET, ''], [EXAMPLE_TARGET, '￿'], true, true)
      .toArray()
  ).filter((r) => r.deleted_at === null);
  if (rows.length === 0) return [];
  const examples = await db.lexicon_examples.bulkGet(rows.map((r) => r.target_id));
  const out: FeedbackSignal[] = [];
  rows.forEach((r, i) => {
    const ex = examples[i];
    if (ex) out.push({ context: ex.context, verdict: r.verdict, at: r.updated_at });
  });
  return out;
}

/** The profile from synced data (settings, sources, feedback). Safe inside useLiveQuery. */
export async function getTopicProfile(now: Millis = Date.now()): Promise<TopicProfile> {
  // Plain sequential reads: this runs inside liveQueries (getSenseExamples calls it after its
  // own reads; called first, the example reads after it stopped being observed in tests).
  const settings = await db.settings.get(SETTINGS_ID);
  const sources = await db.sources.toArray();
  const feedback = await loadFeedbackSignals();
  const weights = topicWeights({
    now,
    interests: settings?.interests,
    muted: settings?.muted_topics,
    sources,
    feedback,
  });
  return {
    weights,
    ranked: rankedTopics(weights),
    interests: (settings?.interests ?? []).filter(isTopicKey),
    asked: settings?.interests != null,
  };
}

/**
 * The given example-sentence contexts, the user's most interesting first; equal ones keep
 * the given order. getSenseExamples (İP5) uses it to order the context tabs.
 */
export async function getOrderedContexts<C extends string>(
  contexts: readonly C[],
  now: Millis = Date.now(),
): Promise<C[]> {
  return orderContexts(contexts, (await getTopicProfile(now)).weights);
}

type ProfileLists = Pick<Settings, 'interests' | 'muted_topics'>;

/** Read-modify-write of the two lists in one transaction (one outbox row). */
async function updateLists(
  change: (s: ProfileLists) => ProfileLists,
  now: Millis,
): Promise<Settings> {
  return writeTx([db.settings], now, async (w) => {
    const current = (await db.settings.get(SETTINGS_ID)) ?? defaultSettings(now, w.userId);
    const next = change(current);
    return w.put('settings', {
      ...current,
      interests: next.interests,
      muted_topics: next.muted_topics,
    });
  });
}

/** Pick or unpick a topic. Picking a topic that was turned off turns it back on. */
export function setInterest(
  topic: TopicKey,
  on: boolean,
  now: Millis = Date.now(),
): Promise<Settings> {
  return updateLists(
    (s) => ({
      interests: toggleInList(s.interests, topic, on),
      muted_topics: on ? toggleInList(s.muted_topics, topic, false) : (s.muted_topics ?? []),
    }),
    now,
  );
}

/** Replace the picked topics at once (first-run choice). Picked topics are turned back on. */
export function saveInterests(
  topics: readonly TopicKey[],
  now: Millis = Date.now(),
): Promise<Settings> {
  const picked = new Set<string>(topics);
  return updateLists(
    (s) => ({
      // Keep keys a newer version wrote; replace the ones this version shows.
      interests: [...(s.interests ?? []).filter((t) => !isTopicKey(t)), ...topics],
      muted_topics: (s.muted_topics ?? []).filter((t) => !picked.has(t)),
    }),
    now,
  );
}

/**
 * Turn a topic off (it weighs 0 whatever the user imports) or back on. Turning it off also
 * unpicks it; turning it on does not pick it again.
 */
export function setTopicMuted(
  topic: TopicKey,
  muted: boolean,
  now: Millis = Date.now(),
): Promise<Settings> {
  return updateLists(
    (s) => ({
      interests: muted ? toggleInList(s.interests, topic, false) : (s.interests ?? []),
      muted_topics: toggleInList(s.muted_topics, topic, muted),
    }),
    now,
  );
}

/** "Şimdi değil": the question is answered with nothing picked, on every device. */
export function dismissInterestPrompt(now: Millis = Date.now()): Promise<Settings> {
  return updateLists(
    (s) => ({ interests: s.interests ?? [], muted_topics: s.muted_topics ?? [] }),
    now,
  );
}

/**
 * Store a text's topics (from the extract call: pass the chunk topics through
 * aggregateTopics first). Unknown keys are dropped; at most 3.
 */
export async function setSourceTopics(
  sourceId: Id,
  topics: readonly string[],
  now: Millis = Date.now(),
): Promise<void> {
  const clean = parseTopics(topics, 3);
  await writeTx([db.sources], now, async (w) => {
    const source = await db.sources.get(sourceId);
    if (!source) throw new ActionError('not_found');
    const same =
      source.topics != null &&
      source.topics.length === clean.length &&
      source.topics.every((t, i) => t === clean[i]);
    if (!same) await w.put('sources', { ...source, topics: clean });
  });
}
