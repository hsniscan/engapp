// v0.5.2 (ADR 0062, review B1/B2): learning steps due later today keep Bugün open, and Bugün
// follows the clock without a write (a step falls due, the app comes back to the foreground).
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addNoteWithSenses, answerCard, ensureSettings, getStudyQueue, updateSettings } from '@/data';
import { Rating, type RatingValue } from '@/domain/types';
import { bumpStudyTickForTesting } from '@/features/review/studyClock';
import { getTodayStudy } from '@/features/review/studyModes';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { HomeScreen } from './HomeScreen';

const MIN = 60_000;
// 15 June 2026, 21:30 in Istanbul (mid-month, evening: the case of the review).
const T = Date.UTC(2026, 5, 15, 18, 30);

beforeEach(async () => {
  vi.useFakeTimers({ now: T, toFake: ['Date'] });
  await resetDb();
  await ensureSettings(T - 3 * 86_400_000);
  await updateSettings({ timezone: 'Europe/Istanbul' });
});

afterEach(() => {
  vi.useRealTimers();
});

async function learnOne(rating: RatingValue = Rating.Good) {
  await addNoteWithSenses({ term: 'reluctant', senses: [{ meaning_tr: 'isteksiz' }] });
  const [item] = (await getStudyQueue({ studyMode: 'word' })).items;
  await answerCard({ card_id: item!.card_id, rating, duration_ms: 4000 });
}

describe('learning steps later today', () => {
  it('count as today\'s work, not as done', async () => {
    await learnOne();
    const s = await getTodayStudy(T + MIN);
    expect(s).toMatchObject({ ready: 0, later: 1, left: 1, doneCards: 0 });
    expect(s.nextLearningDue).toBe(T + 10 * MIN);
    const due = await getTodayStudy(T + 11 * MIN);
    expect(due).toMatchObject({ ready: 1, later: 0, nextReady: 'word' });
  });

  it('Bugün waits ("1 kart 10 dk sonra"), then turns ready on resume without a reload', async () => {
    await learnOne();
    renderRoute(<HomeScreen />);
    const waiting = await screen.findByTestId('today-hero-waiting');
    expect(within(waiting).getByRole('heading')).toHaveTextContent('1 kart 10 dk sonra');
    expect(screen.queryByTestId('today-hero-done')).toBeNull();
    expect(screen.queryByTestId('more-study')).toBeNull();

    // Twelve minutes later the app comes back to the foreground: no write, no reload.
    vi.setSystemTime(T + 12 * MIN);
    await act(async () => bumpStudyTickForTesting());
    const hero = await screen.findByTestId('today-hero');
    expect(within(hero).getByTestId('today-split')).toHaveTextContent('1 kart kaldı');
    expect(within(hero).getByTestId('start-study')).toHaveAttribute('href', '/study?mode=mixed');
  });

  it('a new study day shows the new day after resume', async () => {
    await learnOne(Rating.Easy);
    renderRoute(<HomeScreen />);
    expect(await screen.findByTestId('today-hero-done')).toBeInTheDocument();
    // Next morning, 09:00: the card graduated with Easy is not due yet, but the day changed:
    // the new date, and the word's production card (unlocked by the graduation) as today's one
    // new card. The check waits for that end state; while the queries refresh one by one the
    // card can briefly read "Bugün kart yok" (the new day's activity before its queue).
    vi.setSystemTime(T + 11.5 * 60 * MIN);
    await act(async () => bumpStudyTickForTesting());
    await waitFor(() => expect(screen.getByText('Salı, 16 Haziran')).toBeInTheDocument());
    const hero = await screen.findByTestId('today-hero');
    expect(within(hero).getByTestId('today-split')).toHaveTextContent('1 kart kaldı');
    expect(within(hero).getByTestId('study-type-production')).toHaveTextContent('1');
  });
});
