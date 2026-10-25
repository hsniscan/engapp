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

describe('progress page', () => {
  it('shows words by stage, with "Zaten bildiğin kelimeler" apart from the learned count', async () => {
    await wordAt('tide', CardState.Learning, 1);
    await wordAt('scarce', CardState.Review, 5, 1);
    await wordAt('curb', CardState.Review, 30, 3);
    await wordAt('vivid', CardState.Review, 120, 5);
    await markKnown('give up', 'test');
    await markKnown('take off', 'preview');

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
    const user = userEvent.setup();
    const { router } = renderRoute(<ProgressPage />, { path: '/progress' });
    expect(await screen.findByRole('heading', { level: 1, name: 'İlerleme' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Devamlılık' })).toBeInTheDocument();
    expect(screen.getByTestId('hard-tile')).toHaveTextContent('Zorlandıkların');
    expect(screen.getByText('Hatırlama')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Haftalık raporun/ }));
    expect(router.state.location.search).toBe('?tab=rapor');
    expect(screen.getByRole('tab', { name: 'Haftalık rapor' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.click(screen.getByRole('tab', { name: 'Gelişim' }));
    expect(router.state.location.search).toBe('?tab=gelisim');
  });
});
