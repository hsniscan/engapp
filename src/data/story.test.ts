// The daily story on the device (decision 0050): one per study day, the regeneration with an
// avoid list, the encounter counting, and that nothing touches FSRS or review_logs.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiClientError } from '@/ai/client';
import type { StoryRequest, StoryResponse } from '@/ai/story';
import { addNoteWithSenses, db, getText, recordReaderEncounters, updateSettings } from '@/data';
import type { Knowledge } from '@/domain/knowledgeModel';
import { CardState } from '@/domain/types';
import { resetDb } from '@/test/db';
import { validateStoryOutput } from '../../supabase/functions/_shared/story';
import { GOOD_STORY, STORY_TARGETS } from '../../supabase/functions/_shared/testing/story-fixtures';
import { createTodayStory, storyInputs, StoryUnavailable, todayStory } from './story';

const T = Date.UTC(2026, 10, 2, 9);
const DAY = 24 * 3600_000;

function response(story: unknown = GOOD_STORY): StoryResponse {
  const v = validateStoryOutput(story, STORY_TARGETS);
  if (typeof v === 'string') throw new Error(v);
  return { prompt_version: 'story-v1', model: 'haiku', story: v, usage: { used: 1, limit: 1 } };
}

/** Knows every word but `hard`. */
const knowing = (hard: string[] = []): (() => Promise<Knowledge>) => {
  const set = new Set(hard);
  return async () => ({
    lemmatize: (w) => ({ decided: 'decide', borrowed: 'borrow' })[w] ?? w,
    pKnown: (l) => (set.has(l) ? 0 : 1),
  });
};

async function seedWords(terms: string[] = STORY_TARGETS) {
  for (const term of terms) {
    const { note } = await addNoteWithSenses({ term, senses: [{ meaning_tr: 'anlam' }] }, T - 30 * DAY);
    const rec = (await db.cards.where('note_id').equals(note.id).toArray()).find(
      (c) => c.card_type === 'recognition',
    )!;
    await db.cards.update(rec.id, {
      state: CardState.Review,
      due: T - DAY,
      stability: 20,
      ramp_step: 3,
      last_review: T - 10 * DAY,
    });
  }
}

beforeEach(async () => {
  await resetDb();
  await updateSettings({ timezone: 'Europe/Istanbul', interests: ['food', 'travel', 'sports', 'law'], muted_topics: ['sports'] }, T);
});

describe('createTodayStory', () => {
  it('asks once with only the allowed fields, saves the story as the user’s text', async () => {
    await seedWords();
    const ask = vi.fn(async (_r: StoryRequest) => response());
    const id = await createTodayStory({ fetchStory: ask, loadKnowledge: knowing(), now: T });
    expect(ask).toHaveBeenCalledTimes(1);
    const sent = ask.mock.calls[0]![0];
    expect(Object.keys(sent).sort()).toEqual(['difficulty', 'interests', 'level', 'target_lemmas']);
    expect(sent).toMatchObject({ level: 'B1', difficulty: 'dengeli', interests: ['food', 'travel', 'law'] });
    expect([...sent.target_lemmas].sort()).toEqual([...STORY_TARGETS].sort());

    const text = (await getText(id))!;
    expect(text.kind).toBe('story');
    expect(text.title).toBe('The Sunday Cake');
    expect(text.body.split('\n\n')).toHaveLength(4);
    expect(text.story).toMatchObject({ day: '2026-11-02', prompt_version: 'story-v1', glossed: [] });
    expect(text.story!.targets.every((t) => t.used && t.gloss_tr)).toBe(true);
    expect(text.story!.questions).toHaveLength(3);
    // The text is queued for the user's own sync (user_texts), with its extras.
    const out = (await db.outbox.toArray()).find((o) => o.row_id === id)!;
    expect((out.payload as { story?: unknown }).story).toEqual(text.story);
  });

  it('one story per study day: the second call opens the same text without asking', async () => {
    await seedWords();
    const ask = vi.fn(async () => response());
    const id = await createTodayStory({ fetchStory: ask, loadKnowledge: knowing(), now: T });
    expect(await createTodayStory({ fetchStory: ask, loadKnowledge: knowing(), now: T + 3600_000 })).toBe(id);
    expect(ask).toHaveBeenCalledTimes(1);
    expect((await todayStory(T + 3600_000))?.id).toBe(id);
    // The next study day has no story yet.
    expect(await todayStory(T + DAY)).toBeNull();
  });

  it('two taps at once make one request', async () => {
    await seedWords();
    const ask = vi.fn(async () => response());
    const [a, b] = await Promise.all([
      createTodayStory({ fetchStory: ask, loadKnowledge: knowing(), now: T }),
      createTodayStory({ fetchStory: ask, loadKnowledge: knowing(), now: T }),
    ]);
    expect(a).toBe(b);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('over the difficulty: one regeneration with the hard words to avoid, the easier story kept', async () => {
    await seedWords();
    const easier = {
      ...GOOD_STORY,
      title: 'An Easier Cake',
      paragraphs: GOOD_STORY.paragraphs.map((p) => p.replace('fallen flat', 'gone wrong').replace('wonderful', 'good')),
    };
    const ask = vi.fn(async (r: StoryRequest) => (r.avoid?.length ? response(easier) : response()));
    const hard = ['flat', 'wonderful', 'okafor', 'yellow', 'corners', 'knees', 'carefully', 'tasted', 'twice'];
    const id = await createTodayStory({ fetchStory: ask, loadKnowledge: knowing(hard), now: T });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask.mock.calls[1]![0].avoid).toEqual(expect.arrayContaining(['flat', 'wonderful']));
    const text = (await getText(id))!;
    expect(text.title).toBe('An Easier Cake');
  });

  it('still over after the regeneration: shown with its glossed hard words', async () => {
    await seedWords();
    const ask = vi.fn(async () => response());
    const hard = ['neighbour', 'flat', 'wonderful', 'yellow', 'corners', 'knees', 'carefully', 'tasted', 'twice'];
    const id = await createTodayStory({ fetchStory: ask, loadKnowledge: knowing(hard), now: T });
    expect(ask).toHaveBeenCalledTimes(2);
    expect((await getText(id))!.story!.glossed).toEqual([{ lemma: 'neighbour', gloss_tr: 'komşu' }]);
  });

  it('fewer than five words: no request', async () => {
    await seedWords(STORY_TARGETS.slice(0, 4));
    const ask = vi.fn(async () => response());
    await expect(createTodayStory({ fetchStory: ask, loadKnowledge: knowing(), now: T })).rejects.toBeInstanceOf(
      StoryUnavailable,
    );
    expect(ask).not.toHaveBeenCalled();
    expect((await storyInputs(T)).targets).toHaveLength(4);
  });

  it('a used-up text budget: the error reaches the screen, nothing is saved', async () => {
    await seedWords();
    const ask = vi.fn(async () => {
      throw new AiClientError('budget_exhausted', 'monthly text budget', 503);
    });
    await expect(createTodayStory({ fetchStory: ask, loadKnowledge: knowing(), now: T })).rejects.toMatchObject({
      code: 'budget_exhausted',
    });
    expect(await db.texts.count()).toBe(0);
  });
});

describe('story encounters', () => {
  it('count once per opening as "story", never touching FSRS or review_logs', async () => {
    await seedWords();
    const id = await createTodayStory({ fetchStory: async () => response(), loadKnowledge: knowing(), now: T });
    const cardsBefore = await db.cards.toArray();
    const notes = (await getText(id))!.story!.targets.map((t) => t.note_id);

    expect(await recordReaderEncounters(id, 'open-1', notes, T + 60_000, 'story')).toBe(6);
    expect(await recordReaderEncounters(id, 'open-1', notes, T + 120_000, 'story')).toBe(0);
    const rows = await db.encounters.toArray();
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.source === 'story' && r.n === 1 && r.day === '2026-11-02')).toBe(true);

    expect(await db.cards.toArray()).toEqual(cardsBefore);
    expect(await db.review_logs.count()).toBe(0);
  });
});
