import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addNoteWithSenses,
  createSource,
  db,
  ensureSettings,
  getSettings,
  setSourceTopics,
} from '@/data';
import { HomeScreen } from '@/features/home/HomeScreen';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { InterestsBody } from './InterestsPage';

beforeEach(async () => {
  await resetDb();
  await ensureSettings(Date.now() - 3 * 86_400_000);
});

describe('first-run interests question on the home screen', () => {
  it('asks once: picking and saving answers it for good', async () => {
    await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] });
    const user = userEvent.setup();
    renderRoute(<HomeScreen />);
    const card = await screen.findByRole('region', { name: 'Hangi konular ilgini çekiyor?' });
    const save = within(card).getByRole('button', { name: 'Kaydet' });
    expect(save).toBeDisabled();
    await user.click(within(card).getByRole('button', { name: 'Teknoloji' }));
    await user.click(within(card).getByRole('button', { name: 'Seyahat' }));
    expect(within(card).getByRole('button', { name: 'Teknoloji' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(card).getByRole('button', { name: '2 konuyu kaydet' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Hangi konular ilgini çekiyor?' })).toBeNull(),
    );
    expect((await getSettings()).interests).toEqual(['technology', 'travel']);
  });

  it('"Şimdi değil" hides it and does not pick anything', async () => {
    await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] });
    const user = userEvent.setup();
    renderRoute(<HomeScreen />);
    await user.click(await screen.findByRole('button', { name: 'Şimdi değil' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Şimdi değil' })).toBeNull());
    expect((await getSettings()).interests).toEqual([]);
  });

  it('is not shown to a brand-new user before the first word, nor once answered', async () => {
    renderRoute(<HomeScreen />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Hoş geldin' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Hangi konular ilgini çekiyor?')).toBeNull();
  });
});

describe('interests page', () => {
  it('shows weights with reasons, and turns a topic off and on', async () => {
    const s = await createSource({ kind: 'text', title: 'a' });
    await setSourceTopics(s.id, ['technology']);
    await db.settings.update('settings', { interests: ['travel'] });
    const user = userEvent.setup();
    renderRoute(<InterestsBody />, { path: '/settings/ilgi-alanlari' });

    const weights = await screen.findByRole('region', { name: 'Profilin' });
    const bars = within(weights).getAllByRole('progressbar');
    expect(bars.map((b) => b.getAttribute('aria-label'))).toEqual(['Seyahat', 'Teknoloji']);
    expect(within(weights).getByText('Sen seçtin')).toBeInTheDocument();
    expect(within(weights).getByText('1 metin yükledin')).toBeInTheDocument();

    await user.click(within(weights).getByRole('button', { name: 'Teknoloji konusunu kapat' }));
    const muted = await screen.findByRole('region', { name: 'Kapalı konular' });
    expect((await getSettings()).muted_topics).toEqual(['technology']);
    expect(within(weights).queryByText('1 metin yükledin')).toBeNull();

    await user.click(within(muted).getByRole('button', { name: 'Teknoloji konusunu aç' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Kapalı konular' })).toBeNull(),
    );
    expect((await getSettings()).muted_topics).toEqual([]);
  });

  it('picks topics with the chips', async () => {
    const user = userEvent.setup();
    renderRoute(<InterestsBody />, { path: '/settings/ilgi-alanlari' });
    expect(await screen.findByText(/Henüz bir şey yok/)).toBeInTheDocument();
    const pick = screen.getByRole('region', { name: 'İlgi alanların' });
    await user.click(within(pick).getByRole('button', { name: 'Hukuk' }));
    await waitFor(async () => expect((await getSettings()).interests).toEqual(['law']));
    expect(await screen.findByRole('progressbar', { name: 'Hukuk' })).toBeInTheDocument();
  });
});
