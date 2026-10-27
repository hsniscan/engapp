// "Kelimelerimle metin oluştur" on this device (v0.5.1, decision 0056; rules in
// domain/pickedStory.ts). The picker's words come from the user's own notes; the text from
// ai-story (source 'picked', its own daily limit) through the daily story's pipeline
// (writeMeasuredStory), saved as the user's own text (kind 'story', story.source 'picked'), so
// the reader marks the words, glosses them and asks the three questions. Like the daily story it
// never writes FSRS fields or review_logs; the reader counts the words as 'story' encounters.
import { EXTRACT_TOPIC_KEYS } from '../../supabase/functions/_shared/topics-contract';
import { dayEndMs, dayKeyOf } from '../domain/day';
import {
  buildPickedRequest,
  pickableWords,
  pickSuggestions,
  validPick,
  type PickOptions,
  type PickSuggestions,
  type PickWord,
} from '../domain/pickedStory';
import { storyInfo, type StoryCandidate } from '../domain/story';
import type { ReadingDifficulty } from '../domain/texts';
import type { CefrLevel, Id, Millis } from '../domain/types';
import { db } from './db';
import { ActionError } from './errors';
import { dayConfig, getSettings, readingDifficultyOf } from './settings';
import { writeMeasuredStory, type CreateStoryDeps } from './story';
import { storyBody } from '../domain/story';
import { saveText } from './texts';

const TOPICS: ReadonlySet<string> = new Set(EXTRACT_TOPIC_KEYS);

export interface PickerData {
  suggestions: PickSuggestions;
  /** Every pickable word, for the search. */
  words: PickWord[];
  level: CefrLevel;
  difficulty: ReadingDifficulty;
  /** Topic keys sent with the request (at most three, muted ones left out). */
  interests: string[];
}

/** What the picker shows. Reads only; safe in useLiveQuery. */
export async function loadPicker(now: Millis = Date.now()): Promise<PickerData> {
  const settings = await getSettings(now);
  const cfg = dayConfig(settings);
  const day = dayKeyOf(now, cfg);
  const [notes, cards, senses] = await db.transaction('r', [db.notes, db.cards, db.senses], () =>
    Promise.all([db.notes.toArray(), db.cards.toArray(), db.senses.toArray()]),
  );
  const muted = new Set(settings.muted_topics ?? []);
  return {
    suggestions: pickSuggestions(notes, cards, senses, dayEndMs(day, cfg)),
    words: pickableWords(notes, cards, senses)
      .map(({ note_id, term, lemma, meaning }) => ({ note_id, term, lemma, meaning }))
      .sort((a, b) => a.lemma.localeCompare(b.lemma)),
    level: settings.level,
    difficulty: readingDifficultyOf(settings),
    interests: (settings.interests ?? []).filter((t) => TOPICS.has(t) && !muted.has(t)).slice(0, 3),
  };
}

export interface PickedStoryInput extends PickOptions {
  picks: readonly PickWord[];
  /** Topic keys; absent = the user's interests. */
  interests?: readonly string[];
}

/** One request per device at a time: a second tap waits for the first. */
let inflight: Promise<Id> | null = null;

/**
 * Writes a text around the picked words and saves it as the user's own text. Returns its id
 * (the screen opens readerPath(id)). Throws ActionError('invalid_input') for a pick outside
 * 3–8 words, AiClientError for a server answer (daily_limit when today's texts are used up).
 */
export function createPickedStory(
  input: PickedStoryInput,
  deps: CreateStoryDeps = {},
): Promise<Id> {
  inflight ??= makePicked(input, deps).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function makePicked(input: PickedStoryInput, deps: CreateStoryDeps): Promise<Id> {
  const now = deps.now ?? Date.now();
  const picks = [...new Map(input.picks.map((p) => [p.lemma, p])).values()];
  if (!validPick(picks.length)) throw new ActionError('invalid_input', 'pick 3 to 8 words');
  const settings = await getSettings(now);
  const muted = new Set(settings.muted_topics ?? []);
  const interests = (input.interests ?? settings.interests ?? [])
    .filter((t) => TOPICS.has(t) && !muted.has(t))
    .slice(0, 3);
  const req = buildPickedRequest(picks, input, settings.level, interests);
  const { res, coverage, overLimit } = await writeMeasuredStory(req, input.difficulty, deps);
  const day = dayKeyOf(now, dayConfig(settings));
  const targets: StoryCandidate[] = picks.map((p) => ({
    note_id: p.note_id,
    lemma: p.lemma,
    reason: 'recent',
  }));
  const info = {
    ...storyInfo(res.story, targets, day, res.prompt_version, coverage, overLimit),
    source: 'picked' as const,
    genre: input.genre,
  };
  return saveText(
    { kind: 'story', title: res.story.title, body: storyBody(res.story), story: info },
    now,
  );
}

/** Picked texts made on this device today (the screen's "bugün n/5"; the server decides). */
export async function pickedTextsToday(now: Millis = Date.now()): Promise<number> {
  const day = dayKeyOf(now, dayConfig(await getSettings(now)));
  const rows = await db.texts.where('kind').equals('story').toArray();
  return rows.filter(
    (r) => r.deleted_at === null && r.story?.day === day && r.story.source === 'picked',
  ).length;
}
