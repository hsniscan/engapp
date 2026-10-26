// "Bugünün hikâyesi" on this device (v0.5 İP8, decision 0050; rules in domain/story.ts).
// Picks the day's words, asks ai-story once (and once more with an avoid list when the story
// is over the user's difficulty), measures it against what the user knows and saves it as the
// user's own text (kind 'story', extras in texts.story). The story never writes FSRS fields or
// review_logs; the reader counts its words as 'story' encounters.
import { EXTRACT_TOPIC_KEYS } from '../../supabase/functions/_shared/topics-contract';
import { fetchStory, type StoryRequest, type StoryResponse } from '../ai/story';
import { dayEndMs, dayKeyOf } from '../domain/day';
import type { Knowledge } from '../domain/knowledgeModel';
import { tokenizeReaderText } from '../domain/readerTokens';
import {
  MIN_STORY_TARGETS,
  selectStoryTargets,
  storyAvoidList,
  storyBody,
  storyCoverage,
  storyInfo,
  storyLimit,
  type StoryCandidate,
} from '../domain/story';
import type { ReaderText, ReadingDifficulty } from '../domain/texts';
import type { CefrLevel, Id, Millis } from '../domain/types';
import { db } from './db';
import { loadKnowledge } from './knowledge';
import { logError } from './errorLog';
import { dayConfig, getSettings, readingDifficultyOf } from './settings';
import { saveText } from './texts';

export interface StoryInputs {
  day: string;
  level: CefrLevel;
  difficulty: ReadingDifficulty;
  /** Topic keys the server accepts, at most three, muted ones left out. */
  interests: string[];
  targets: StoryCandidate[];
}

const TOPICS: ReadonlySet<string> = new Set(EXTRACT_TOPIC_KEYS);

/** Today's story on this device (or pulled from another), or null. Safe in useLiveQuery. */
export async function todayStory(now: Millis = Date.now()): Promise<ReaderText | null> {
  const day = dayKeyOf(now, dayConfig(await getSettings(now)));
  const rows = await db.texts.where('kind').equals('story').toArray();
  return (
    rows
      .filter((r) => r.deleted_at === null && r.story?.day === day)
      .sort((a, b) => a.created_at - b.created_at)[0] ?? null
  );
}

/** Everything the request needs, read on the device. Safe in useLiveQuery. */
export async function storyInputs(now: Millis = Date.now()): Promise<StoryInputs> {
  const settings = await getSettings(now);
  const cfg = dayConfig(settings);
  const day = dayKeyOf(now, cfg);
  const [notes, cards] = await db.transaction('r', [db.notes, db.cards], () =>
    Promise.all([db.notes.toArray(), db.cards.toArray()]),
  );
  const muted = new Set(settings.muted_topics ?? []);
  const interests = (settings.interests ?? [])
    .filter((t) => TOPICS.has(t) && !muted.has(t))
    .slice(0, 3);
  return {
    day,
    level: settings.level,
    difficulty: readingDifficultyOf(settings),
    interests,
    targets: selectStoryTargets(notes, cards, now, dayEndMs(day, cfg)),
  };
}

export class StoryUnavailable extends Error {
  readonly code = 'not_enough_words' as const;
  constructor() {
    super('not enough words for a story today');
    this.name = 'StoryUnavailable';
  }
}

export interface CreateStoryDeps {
  fetchStory?: (req: StoryRequest) => Promise<StoryResponse>;
  loadKnowledge?: () => Promise<Knowledge>;
  now?: Millis;
}

/** One request per device at a time: a second tap waits for the first. */
let inflight: Promise<Id> | null = null;

/**
 * Today's story: the saved one when there is one, otherwise a new one from ai-story, saved as
 * the user's own text. Returns the text id (the screen opens readerPath(id)). Throws
 * StoryUnavailable with fewer than five words, AiClientError for a server answer.
 */
export function createTodayStory(deps: CreateStoryDeps = {}): Promise<Id> {
  inflight ??= makeStory(deps).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function makeStory(deps: CreateStoryDeps): Promise<Id> {
  const now = deps.now ?? Date.now();
  const existing = await todayStory(now);
  if (existing) return existing.id;
  const input = await storyInputs(now);
  if (input.targets.length < MIN_STORY_TARGETS) throw new StoryUnavailable();
  const ask = deps.fetchStory ?? ((r: StoryRequest) => fetchStory(r));
  const req: StoryRequest = {
    level: input.level,
    difficulty: input.difficulty,
    interests: input.interests as StoryRequest['interests'],
    target_lemmas: input.targets.map((t) => t.lemma),
  };

  let res = await ask(req);
  const k = await (deps.loadKnowledge ?? loadKnowledge)();
  const measure = (r: StoryResponse) =>
    storyCoverage(tokenizeReaderText(storyBody(r.story)), k, r.story.used_lemmas);
  let coverage = measure(res);
  const limit = storyLimit(input.difficulty);
  if (coverage.unknownRate > limit) {
    const avoid = storyAvoidList(coverage);
    if (avoid.length > 0) {
      try {
        const again = await ask({ ...req, avoid });
        const c2 = measure(again);
        if (c2.unknownRate < coverage.unknownRate) {
          res = again;
          coverage = c2;
        }
      } catch (e) {
        // The first story stands; its hardest words are glossed.
        void logError(e, 'story.regenerate');
      }
    }
  }

  // Another device may have made today's story meanwhile (pulled during the call).
  const raced = await todayStory(now);
  if (raced) return raced.id;
  const info = storyInfo(
    res.story,
    input.targets,
    input.day,
    res.prompt_version,
    coverage,
    coverage.unknownRate > limit,
  );
  return saveText(
    { kind: 'story', title: res.story.title, body: storyBody(res.story), story: info },
    now,
  );
}
