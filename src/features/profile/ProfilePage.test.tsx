import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { addNoteWithSenses, db, ensureSettings, markKnown } from '@/data';
import { setAuthStateForTesting } from '@/features/auth/session';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { ProfilePage } from './ProfilePage';

beforeEach(async () => {
  await resetDb();
  await ensureSettings();
  setAuthStateForTesting({ status: 'guest', user: null });
});

describe('profile page', { timeout: 20_000 }, () => {
  it('shows the account, level, interests and the way to settings', async () => {
    setAuthStateForTesting({
      status: 'signed_in',
      user: { id: 'u1', email: 'h@example.com', name: 'Hasan', avatarUrl: null },
    });
    await db.settings.update('settings', { interests: ['travel', 'technology'], level: 'B1' });
    renderRoute(<ProfilePage />, { path: '/profile' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Hasan' })).toBeInTheDocument();
    expect(screen.getByText('Google hesabıyla giriş yapıldı')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ayarlar' })).toHaveAttribute('href', '/settings');
    expect(await screen.findByTestId('profile-level')).toHaveTextContent('B1');
    expect(screen.getByText('Tahmini kelime hazinen')).toBeInTheDocument();
    const chips = screen.getByRole('list', { name: 'Seçili ilgi alanları' });
    expect(
      within(chips)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Seyahat', 'Teknoloji']);
    expect(screen.getByRole('link', { name: 'İlgi alanların: Düzenle' })).toHaveAttribute(
      'href',
      '/settings/ilgi-alanlari',
    );
  });

  it('counts words and known words in the shortcuts', async () => {
    await addNoteWithSenses({ term: 'tide', senses: [{ meaning_tr: 'gelgit' }] });
    await markKnown('give up', 'manual');
    renderRoute(<ProfilePage />, { path: '/profile' });
    const all = await screen.findByRole('link', { name: /Tüm kelimelerim/ });
    expect(all).toHaveAttribute('href', '/library');
    await waitFor(() => expect(all).toHaveTextContent('Tüm kelimelerim · 1'), { timeout: 8000 });
    const nav = screen.getByRole('navigation', { name: 'Kısayollar' });
    const known = within(nav).getByRole('link', { name: /Bildiğim kelimeler/ });
    expect(known).toHaveAttribute('href', '/settings/bilinen-kelimeler');
    expect(known).toHaveTextContent('Bildiğim kelimeler · 1');
    expect(screen.getByRole('heading', { level: 1, name: 'Misafir' })).toBeInTheDocument();
  });

  it('sets goals from the goals card', async () => {
    const user = userEvent.setup();
    renderRoute(<ProfilePage />, { path: '/profile' });
    const set = await screen.findByRole('button', { name: 'Hedef koy' });
    await waitFor(() => expect(set).toBeEnabled(), { timeout: 8000 });
    await user.click(set);
    expect(await screen.findByRole('dialog', { name: 'Hedeflerin' })).toBeInTheDocument();
  });

  it('opens the goals dialog from the home link (?edit=goals)', async () => {
    renderRoute(<ProfilePage />, { path: '/profile', url: '/profile?edit=goals' });
    expect(await screen.findByRole('dialog', { name: 'Hedeflerin' }, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByLabelText('Günlük hedef (dakika)')).toBeInTheDocument();
  });
});
