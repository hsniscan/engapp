// "Kelimelerimle metin oluştur" on the device (decision 0056): the request leaves with only the
// allowed fields, the text is saved as the user's own story text, and it never counts as the
// day's story.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoryRequest, StoryResponse } from '@/ai/story';
import { storyWireBody } from '@/ai/story';
import { addNoteWithSenses, db, getText, updateSettings } from '@/data';
import type { Knowledge } from '@/domain/knowledgeModel';
import { resetDb } from '@/test/db';
import { validateStoryOutput } from '../../supabase/functions/_shared/story';
import { GOOD_STORY, STORY_TARGETS } from '../../supabase/functions/_shared/testing/story-fixtures';
import { createPickedStory, loadPicker, pickedTextsToday } from './pickedStory';
import { todayStory } from './story';

const T = Date.UTC(2026, 10, 2, 9);

function response(): StoryResponse {
  const v = validateStoryOutput(GOOD_STORY, STORY_TARGETS);
  if (typeof v === 'string') throw new Error(v);
  return { prompt_version: 'picked-v1', model: 'haiku', story: v, usage: { used: 1, limit: 5 } };
}

const knowing = async (): Promise<Knowledge> => ({ lemmatize: (w) => w, pKnown: () => 1 });

beforeEach(async () => {
  await resetDb();
  await updateSettings(
    {
      timezone: 'Europe/Istanbul',
      interests: ['food', 'travel', 'sports'],
      muted_topics: ['sports'],
    },
    T,
  );
  for (const term of STORY_TARGETS)
    await addNoteWithSenses({ term, senses: [{ meaning_tr: `${term} anlamı` }] }, T - 86_400_000);
});

describe('createPickedStory', () => {
  it('sends only the allowed fields (snapshot) and saves a picked story text', async () => {
    const picker = await loadPicker(T);
    expect(picker.words.map((w) => w.lemma)).toEqual([...STORY_TARGETS].sort());
    expect(picker.interests).toEqual(['food', 'travel']);
    const picks = picker.words.filter((w) => ['borrow', 'decide', 'journey'].includes(w.lemma));

    const ask = vi.fn(async (_r: StoryRequest) => response());
    const id = await createPickedStory(
      { picks, genre: 'dialogue', length: 'short', difficulty: 'rahat' },
      { fetchStory: ask, loadKnowledge: knowing, now: T },
    );
    expect(ask).toHaveBeenCalledTimes(1);
    expect(storyWireBody(ask.mock.calls[0]![0])).toEqual({
      source: 'picked',
      genre: 'dialogue',
      length: 'short',
      level: 'B1',
      difficulty: 'rahat',
      interests: ['food', 'travel'],
      target_lemmas: ['borrow', 'decide', 'journey'],
      avoid: [],
    });

    const text = (await getText(id))!;
    expect(text.kind).toBe('story');
    expect(text.title).toBe('The Sunday Cake');
    expect(text.story).toMatchObject({
      source: 'picked',
      genre: 'dialogue',
      prompt_version: 'picked-v1',
    });
    expect(text.story!.targets.map((t) => t.lemma)).toEqual(['borrow', 'decide', 'journey']);
    expect(await pickedTextsToday(T)).toBe(1);
    // Not the day's story: Bugün still offers its own.
    expect(await todayStory(T)).toBeNull();
  });

  it('refuses fewer than three words without asking', async () => {
    const picker = await loadPicker(T);
    const ask = vi.fn(async () => response());
    await expect(
      createPickedStory(
        {
          picks: picker.words.slice(0, 2),
          genre: 'story',
          length: 'medium',
          difficulty: 'dengeli',
        },
        { fetchStory: ask, loadKnowledge: knowing, now: T },
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(ask).not.toHaveBeenCalled();
    expect(await db.texts.count()).toBe(0);
  });
});

describe('storyWireBody', () => {
  it('a daily story leaves exactly as before v0.5.1 (no source, genre or length)', () => {
    expect(
      storyWireBody({
        level: 'B1',
        difficulty: 'dengeli',
        interests: ['food'],
        target_lemmas: STORY_TARGETS,
      }),
    ).toEqual({
      level: 'B1',
      difficulty: 'dengeli',
      interests: ['food'],
      target_lemmas: STORY_TARGETS,
      avoid: [],
    });
  });
});
