import { screen, waitFor, within } from '@testing-library/react';
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
    await db.settings.update('settings', {
      interests: ['travel', 'technology'],
      level: 'B1',
      level_source: 'manual',
      level_updated_at: Date.UTC(2026, 9, 1),
    });
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

  it('an unmeasured user sees "Henüz ölçülmedi" and a test button, never a default B1', async () => {
    renderRoute(<ProfilePage />, { path: '/profile' });
    const level = await screen.findByTestId('profile-level');
    expect(level).toHaveTextContent('Henüz ölçülmedi');
    expect(level).not.toHaveTextContent('B1');
    expect(screen.getByRole('link', { name: 'Teste başla' })).toHaveAttribute(
      'href',
      '/level-test',
    );
    expect(screen.getByTestId('profile-vocab')).toHaveTextContent('Henüz tahmin yok');
  });

  it('a long-time user without a test sees a floor, not "no estimate"', async () => {
    // A learned word: its recognition card reached Öğrenildi.
    const { note } = await addNoteWithSenses({ term: 'tide', senses: [{ meaning_tr: 'gelgit' }] });
    const rec = (await db.cards.where('note_id').equals(note.id).toArray()).find(
      (c) => c.card_type === 'recognition',
    )!;
    await db.cards.update(rec.id, {
      state: 2,
      ramp_step: 3,
      stability: 30,
      learned_at: Date.now() - 86_400_000,
    });
    await markKnown('give up', 'manual');
    renderRoute(<ProfilePage />, { path: '/profile' });
    await waitFor(() => expect(screen.getByTestId('profile-vocab')).toHaveTextContent('en az'), {
      timeout: 8000,
    });
    expect(screen.queryByText('Henüz tahmin yok')).toBeNull();
  });

  it('stats and goals live on İlerleme: no streak or goals card here, ?edit=goals forwards', async () => {
    const { router } = renderRoute(<ProfilePage />, {
      path: '/profile',
      url: '/profile?edit=goals',
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/progress'));
    expect(router.state.location.search).toBe('?edit=goals');
  });
});
