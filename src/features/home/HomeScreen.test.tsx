import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addNoteWithSenses,
  answerCard,
  db,
  ensureSettings,
  getMeta,
  getStudyQueue,
  setMeta,
  updateGoals,
} from '@/data';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { useAddSheetOpen } from '@/features/add/addSheetStore';
import { HomeScreen } from './HomeScreen';
import { STAGE_RULE_NOTE_KEY } from './todayQueries';

beforeEach(async () => {
  await resetDb();
  await ensureSettings(Date.now() - 3 * 86_400_000);
});

function SheetProbe() {
  return <span data-testid="sheet-state">{useAddSheetOpen() ? 'open' : 'closed'}</span>;
}

describe('Bugün', () => {
  it('welcomes a brand-new user and opens the Add sheet', async () => {
    renderRoute(
      <>
        <HomeScreen />
        <SheetProbe />
      </>,
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Hoş geldin' }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('today-hero')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'İlk kelimeni ekle' }));
    expect(screen.getByTestId('sheet-state')).toHaveTextContent('open');
    // A first-time user never needs the "rule changed" note.
    await act(async () => {});
    expect(await getMeta(STAGE_RULE_NOTE_KEY)).toBe(true);
  });

  it('shows the whole day with a chip per mode and updates live after answers', async () => {
    await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] });
    await addNoteWithSenses({ term: 'light', senses: [{ meaning_tr: 'hafif' }] });
    renderRoute(<HomeScreen />);

    const hero = await screen.findByTestId('today-hero');
    expect(within(hero).getByRole('heading', { name: '2 kart kaldı' })).toBeInTheDocument();
    expect(within(hero).getByText(/0 tekrar · 2 yeni/)).toBeInTheDocument();
    expect(within(hero).getByRole('img', { name: 'Bugün 0 / 2 kart' })).toBeInTheDocument();
    expect(within(hero).getByRole('link', { name: /Başla/ })).toHaveAttribute(
      'href',
      '/study?mode=word',
    );
    // One chip per mode in the hero: the whole day at a glance (ADR 0055).
    expect(within(hero).getByTestId('study-type-word')).toHaveAttribute('href', '/study?mode=word');
    expect(within(hero).getByTestId('study-type-word')).toHaveAccessibleName('Kelime: 2 kart');
    expect(within(hero).getByTestId('study-type-production')).toHaveAccessibleName(
      'Üretim: Bugün yok',
    );
    expect(await screen.findByTestId('home-words')).toHaveTextContent('/ 2 kelimenden');

    // Answer every word card (Easy graduates them): the calm "done" state takes over.
    for (const item of (await getStudyQueue()).items)
      await answerCard({ card_id: item.card_id, rating: 4, duration_ms: 5000 });
    const done = await screen.findByTestId('today-hero-done');
    expect(within(done).getByRole('heading', { name: 'Bugünlük tamam' })).toBeInTheDocument();
    expect(within(done).getByText('0 tekrar · 2 yeni kelime')).toBeInTheDocument();
    expect(within(done).getByRole('status')).toHaveTextContent(/Sıradaki tekrar|Yarın/);
    expect(screen.queryByRole('link', { name: /Devam et|Başla/ })).toBeNull();
    expect(await db.daily_activity.count()).toBe(1);
  });

  it('shows goals with their targets and the level path', async () => {
    await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] });
    await updateGoals({ day_minutes: 15, week_minutes: 60, target_level: 'C1' });
    renderRoute(<HomeScreen />);
    const goals = await screen.findByTestId('home-goals');
    expect(within(goals).getByTestId('goal-day')).toHaveTextContent('0/15 dk');
    expect(await within(goals).findByText(/0\/60/)).toBeInTheDocument();
    expect(within(goals).getByText('Seviye tahmini: B1')).toBeInTheDocument();
    expect(
      within(goals).getByRole('list', { name: 'Seviye yolu: şimdi B1, sıradaki hedef C1' }),
    ).toBeInTheDocument();
    expect(within(goals).getByRole('link', { name: 'Hedefleri düzenle' })).toHaveAttribute(
      'href',
      '/profile?edit=goals',
    );
  });

  it('shows the stricter-rule note once to an existing user, until it is closed', async () => {
    await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] });
    // The Dexie v26 upgrade arms the note on devices that already had data.
    await setMeta(STAGE_RULE_NOTE_KEY, false);
    renderRoute(<HomeScreen />);
    const note = await screen.findByTestId('stage-rule-note');
    expect(note).toHaveTextContent('Öğrenilmiş sayma kuralı değişti');
    expect(note).toHaveTextContent('üç ayrı günde doğru bilinince öğrenildi sayılıyor');
    fireEvent.click(within(note).getByRole('button', { name: 'Kapat' }));
    await screen.findByTestId('home-words');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByTestId('stage-rule-note')).toBeNull();
    expect(await getMeta(STAGE_RULE_NOTE_KEY)).toBe(true);
  });

  it('never shows the note on a fresh install', async () => {
    await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] });
    renderRoute(<HomeScreen />);
    await screen.findByTestId('home-words');
    expect(screen.queryByTestId('stage-rule-note')).toBeNull();
  });

  it('keeps the note hidden once seen', async () => {
    await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] });
    await setMeta(STAGE_RULE_NOTE_KEY, true);
    renderRoute(<HomeScreen />);
    await screen.findByTestId('home-words');
    expect(screen.queryByTestId('stage-rule-note')).toBeNull();
  });
});
