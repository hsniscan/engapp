import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { addNoteWithSenses, answerCard, db, ensureSettings, getStudyQueue } from '@/data';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { HomeScreen } from './HomeScreen';

beforeEach(async () => {
  await resetDb();
  await ensureSettings(Date.now() - 3 * 86_400_000);
});

describe('home', () => {
  it('guides a brand-new user to add the first word', async () => {
    renderRoute(<HomeScreen />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Hoş geldin' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'İlk kelimeni ekle' })).toHaveAttribute('href', '/add');
    expect(screen.queryByRole('link', { name: /Tekrara başla/ })).not.toBeInTheDocument();
  });

  it('shows today’s counts and updates live after an answer', async () => {
    await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] });
    await addNoteWithSenses({ term: 'light', senses: [{ meaning_tr: 'hafif' }] });
    renderRoute(<HomeScreen />);
    const start = await screen.findByRole('link', { name: /Tekrara başla/ });
    expect(start).toHaveAttribute('href', '/review');
    const today = screen.getByRole('region', { name: 'Bugünün tekrarı' });
    expect(within(today).getByText('Yeni').nextElementSibling).toHaveTextContent('2');
    expect(screen.getByRole('img', { name: 'Bugünkü ilerleme: 0 / 2 kart' })).toBeInTheDocument();
    expect(screen.getByText('bank', { selector: '[lang="en"]' })).toBeInTheDocument();

    // Answer both (Easy graduates them): the card switches to the calm "done" state.
    for (const item of (await getStudyQueue()).items)
      await answerCard({ card_id: item.card_id, rating: 4, duration_ms: 5000 });
    expect(await screen.findByText('Bugünlük bitti')).toBeInTheDocument();
    // Done for today: the way on is "Biraz daha çalış", not a disabled review button.
    expect(screen.getByRole('link', { name: 'Biraz daha çalış' })).toHaveAttribute('href', '/more');
    expect(screen.queryByRole('link', { name: 'Tekrara başla' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/Sıradaki tekrar|Yarın/);
    expect(await db.daily_activity.count()).toBe(1);
  });
});
