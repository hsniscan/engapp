import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { addNoteWithSenses, db, ensureSettings, markKnown } from '@/data';
import { CardState } from '@/domain/types';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { ProgressPage } from './ProgressPage';

beforeEach(async () => {
  await resetDb();
  await ensureSettings();
});

async function wordAt(term: string, state: number, stability: number, ramp_step = 0) {
  const { createdCards } = await addNoteWithSenses({ term, senses: [{ meaning_tr: term }] });
  const rec = createdCards.find((c) => c.card_type === 'recognition')!;
  await db.cards.update(rec.id, { state: state as never, stability, ramp_step, reps: 3 });
}

/** Past study, so İlerleme is past the first-steps stage. */
async function studied(answers = 40) {
  await db.daily_activity.put({
    date: '2026-01-05',
    reviews: answers,
    new_cards: 0,
    time_ms: 60_000,
    review_answers: 0,
    review_passed: 0,
    completed: true,
  });
}

describe('progress page', () => {
  it('a brand-new user sees one "İlk çalışmanı yap" card and the calendar, and when the rest opens', async () => {
    renderRoute(<ProgressPage />, { path: '/progress' });
    const first = await screen.findByTestId('progress-first-steps');
    expect(within(first).getByRole('heading', { name: 'İlk çalışmanı yap' })).toBeInTheDocument();
    expect(within(first).getByRole('link', { name: 'Çalışmaya başla' })).toHaveAttribute(
      'href',
      '/study',
    );
    const list = within(first).getByRole('list', { name: 'Neler, ne zaman açılır' });
    expect(within(list).getByText('Haftalık rapor')).toBeInTheDocument();
    expect(within(list).getByText('10 cevap sonra')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Devamlılık' })).toBeInTheDocument();
    // No wall of zeros.
    expect(screen.queryByRole('region', { name: 'Öğrendiğin kelimeler' })).toBeNull();
    expect(screen.queryByTestId('hard-tile')).toBeNull();
    expect(screen.queryByText('Önümüzdeki 30 gün')).toBeNull();
  });

  it('shows words by stage, with "Zaten bildiğin kelimeler" apart from the learned count', async () => {
    await wordAt('tide', CardState.Learning, 1);
    await wordAt('scarce', CardState.Review, 5, 1);
    await wordAt('curb', CardState.Review, 30, 3);
    await wordAt('vivid', CardState.Review, 120, 5);
    await markKnown('give up', 'test');
    await markKnown('take off', 'preview');
    await studied();

    renderRoute(<ProgressPage />, { path: '/progress' });
    const stages = await screen.findByRole('region', { name: 'Öğrendiğin kelimeler' });
    // Öğrenildi + Kalıcı; the two "Biliyorum" words never count.
    expect(within(stages).getByTestId('learned-total')).toHaveTextContent('2');
    const list = within(stages).getByRole('list', { name: 'Kelimelerin aşamalara göre dağılımı' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => li.textContent?.split('(')[0]?.trim())).toEqual([
      'Öğreniyor1',
      'Pekişiyor1',
      'Öğrenildi1',
      'Kalıcı1',
    ]);
    const known = within(stages).getByTestId('already-known');
    expect(known).toHaveTextContent('Zaten bildiğin kelimeler: 2');
    expect(known).toHaveTextContent('öğrendiğin kelime sayısına eklenmez');
    expect(known).toHaveAttribute('href', '/settings/bilinen-kelimeler');
  });

  it('has the continuity, load, struggling and recall blocks, and the tabs', async () => {
    await studied();
    const user = userEvent.setup();
    const { router } = renderRoute(<ProgressPage />, { path: '/progress' });
    expect(await screen.findByRole('heading', { level: 1, name: 'İlerleme' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Devamlılık' })).toBeInTheDocument();
    const hard = screen.getByTestId('hard-tile');
    expect(hard).toHaveTextContent('Zorlandıkların');
    // Nothing to practise: no link to an empty practice round.
    expect(hard.tagName).not.toBe('A');
    expect(hard).toHaveTextContent('Şu an çalışılacak yok');
    expect(screen.getByText('Hatırlama')).toBeInTheDocument();
    expect(screen.getByText(/20 cevap daha verince/)).toBeInTheDocument();
    // No report yet: says when it comes instead of a link to an empty tab.
    expect(screen.getByTestId('report-locked')).toHaveTextContent('pazartesi');
    await user.click(screen.getByRole('tab', { name: 'Haftalık rapor' }));
    expect(router.state.location.search).toBe('?tab=rapor');
    await user.click(screen.getByRole('tab', { name: 'Gelişim' }));
    expect(router.state.location.search).toBe('?tab=gelisim');
  });

  it('?edit=goals opens the goals dialog (goals are set only here)', async () => {
    renderRoute(<ProgressPage />, { path: '/progress', url: '/progress?edit=goals' });
    expect(
      await screen.findByRole('dialog', { name: 'Hedeflerin' }, { timeout: 8000 }),
    ).toBeInTheDocument();
  });
});
