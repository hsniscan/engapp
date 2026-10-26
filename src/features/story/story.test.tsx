// "Bugünün hikâyesi" on screen (decision 0050): the Bugün line in each state, and the reader
// with a story (target words in bold, questions, words, 'story' encounters). ai-story is mocked.
import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiClientError } from '@/ai/client';
import { addNoteWithSenses, db, saveText, updateSettings } from '@/data';
import { resetKnowledgeCache } from '@/data/knowledge';
import { setLevelDataForTests } from '@/data/levelData';
import { parseClientLevels } from '@/domain/level';
import type { StoryInfo } from '@/domain/story';
import { CardState } from '@/domain/types';
import { setAuthStateForTesting } from '@/features/auth/session';
import { ReaderPage } from '@/features/reader/ReaderPage';
import { TodayReadingCard } from '@/features/reader/TodayReadingCard';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { validateStoryOutput } from '../../../supabase/functions/_shared/story';
import { GOOD_STORY, STORY_TARGETS } from '../../../supabase/functions/_shared/testing/story-fixtures';
import { storyError } from './storyError';

configure({ asyncUtilTimeout: 5000 });

const fetchStory = vi.hoisted(() => vi.fn());
vi.mock('@/ai/story', () => ({ fetchStory }));

const SIGNED_IN = {
  status: 'signed_in' as const,
  user: { id: 'u1', email: 'h@example.com', name: 'Hasan', avatarUrl: null },
};

function response() {
  const v = validateStoryOutput(GOOD_STORY, STORY_TARGETS);
  if (typeof v === 'string') throw new Error(v);
  return { prompt_version: 'story-v1', model: 'haiku', story: v, usage: { used: 1, limit: 1 } };
}

async function seedWords(terms: string[] = STORY_TARGETS) {
  const ids: string[] = [];
  for (const term of terms) {
    const { note } = await addNoteWithSenses({ term, senses: [{ meaning_tr: 'anlam' }] });
    ids.push(note.id);
    const rec = (await db.cards.where('note_id').equals(note.id).toArray()).find(
      (c) => c.card_type === 'recognition',
    )!;
    await db.cards.update(rec.id, {
      state: CardState.Review,
      due: Date.now() - 3600_000,
      stability: 20,
      ramp_step: 3,
      last_review: Date.now() - 10 * 86_400_000,
    });
  }
  return ids;
}

const setOnline = (v: boolean) =>
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v });

beforeEach(async () => {
  await resetDb();
  resetKnowledgeCache();
  setLevelDataForTests(parseClientLevels('# @min_zipf 3\nwalk\t5.1\tv:A1:j'));
  await updateSettings({ timezone: 'Europe/Istanbul' });
  fetchStory.mockReset();
  setOnline(true);
});
afterEach(() => {
  setLevelDataForTests(null);
  setOnline(true);
});

describe('Bugün: "Bugünün hikâyesi"', () => {
  it('hidden with fewer than five words', async () => {
    setAuthStateForTesting(SIGNED_IN);
    await seedWords(STORY_TARGETS.slice(0, 3));
    renderRoute(<TodayReadingCard />);
    await screen.findByTestId('today-reading');
    expect(screen.queryByTestId('today-story')).toBeNull();
  });

  it('a guest is invited to sign in, nothing is asked', async () => {
    setAuthStateForTesting({ status: 'guest', user: null });
    await seedWords();
    renderRoute(<TodayReadingCard />);
    const row = await screen.findByTestId('today-story');
    expect(within(row).getByText(/Hazırlanması için giriş yap/)).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Giriş yap' })).toBeInTheDocument();
    expect(fetchStory).not.toHaveBeenCalled();
  });

  it('offline: a calm line and no request', async () => {
    setAuthStateForTesting(SIGNED_IN);
    setOnline(false);
    await seedWords();
    renderRoute(<TodayReadingCard />);
    const row = await screen.findByTestId('today-story');
    expect(within(row).getByText('İnternet bağlantısı gelince hazırlanır.')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Hazırla' })).toBeDisabled();
  });

  it('signed in: "Hazırla" writes the story and opens it in the reader; then it reopens', async () => {
    const user = userEvent.setup();
    setAuthStateForTesting(SIGNED_IN);
    await seedWords();
    fetchStory.mockResolvedValue(response());
    const { router, unmount } = renderRoute(<TodayReadingCard />, { path: '*', url: '/' });
    const row = await screen.findByTestId('today-story');
    expect(within(row).getByText('6 kelimenle kısa bir hikâye ve 3 soru')).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Hazırla' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/oku\//));
    // The first request has no avoid list; a second one (with it) only when the story was over
    // the user's difficulty on this device.
    expect(fetchStory.mock.calls[0]![0]).not.toHaveProperty('avoid');
    const asked = fetchStory.mock.calls.length;
    expect(asked).toBeLessThanOrEqual(2);
    const id = router.state.location.pathname.split('/')[2]!;
    unmount();

    // Already made today: the story opens again, no new request. The unfinished story is the
    // card's own "continue" link, so the line is not repeated.
    renderRoute(<TodayReadingCard />);
    expect(await screen.findByRole('link', { name: /The Sunday Cake/ })).toHaveAttribute('href', `/oku/${id}`);
    expect(screen.queryByTestId('today-story')).toBeNull();
    expect(fetchStory).toHaveBeenCalledTimes(asked);
  });

  it('a used-up text budget: a calm message, no retry button', async () => {
    const user = userEvent.setup();
    setAuthStateForTesting(SIGNED_IN);
    await seedWords();
    fetchStory.mockRejectedValue(new AiClientError('budget_exhausted', 'budget', 503));
    renderRoute(<TodayReadingCard />);
    const row = await screen.findByTestId('today-story');
    await user.click(within(row).getByRole('button', { name: 'Hazırla' }));
    expect(await within(row).findByText(/Bu ayın hikâye hakkı doldu/)).toBeInTheDocument();
    expect(within(row).queryByRole('button')).toBeNull();
    expect(await db.texts.count()).toBe(0);
  });

  it('maps every failure to its line', () => {
    expect(storyError(new AiClientError('daily_limit', ''))).toBe('used');
    expect(storyError(new AiClientError('budget_exhausted', ''))).toBe('budget');
    expect(storyError(new AiClientError('not_signed_in', ''))).toBe('guest');
    expect(storyError(new AiClientError('offline', ''))).toBe('offline');
    expect(storyError(new AiClientError('ai_failed', ''))).toBe('generic');
    expect(storyError(new Error('x'))).toBe('generic');
  });
});

describe('the reader with a story', () => {
  it('bold target words, three questions, the words, and story encounters', async () => {
    const user = userEvent.setup();
    const ids = await seedWords();
    const v = response().story;
    const info: StoryInfo = {
      day: '2026-11-02',
      prompt_version: 'story-v1',
      targets: STORY_TARGETS.map((lemma, i) => ({
        note_id: ids[i]!,
        lemma,
        used: true,
        gloss_tr: v.glosses.find((g) => g.lemma === lemma)!.gloss_tr,
      })),
      questions: v.questions,
      glossed: [{ lemma: 'neighbour', gloss_tr: 'komşu' }],
      unknown_rate: 0.04,
    };
    const id = await saveText({ kind: 'story', title: v.title, body: v.paragraphs.join('\n\n'), story: info });
    const logsBefore = await db.review_logs.count();
    renderRoute(<ReaderPage />, { path: '/oku/:textId', url: `/oku/${id}` });

    await waitFor(() =>
      expect(
        [...screen.getByTestId('reader-text').querySelectorAll('[data-target]')].map((e) => e.textContent),
      ).toEqual(expect.arrayContaining(['decided', 'nervous', 'borrowed', 'recipe', 'journey', 'improve'])),
    );
    expect(screen.getByTestId('story-glossed')).toHaveTextContent('neighbour komşu');
    expect(within(screen.getByTestId('story-words')).getByText('ödünç almak')).toBeInTheDocument();

    const qs = screen.getAllByTestId('story-question');
    expect(qs).toHaveLength(3);
    await user.click(within(qs[0]!).getByRole('button', { name: 'She was late for the bus.' }));
    expect(within(qs[0]!).getByRole('status')).toHaveTextContent('Doğru cevap: Her last cake had gone wrong.');
    await user.click(within(qs[2]!).getByRole('button', { name: 'The recipe' }));
    expect(within(qs[2]!).getByRole('status')).toHaveTextContent('Doğru.');

    await waitFor(async () => expect(await db.encounters.count()).toBe(6));
    const rows = await db.encounters.toArray();
    expect(rows.every((r) => r.source === 'story')).toBe(true);
    expect(await db.review_logs.count()).toBe(logsBefore);
  });
});
