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
import { finishOnboarding } from '@/features/onboarding/state';
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
    // Past the first-run onboarding (features/onboarding has its own tests).
    finishOnboarding();
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
    expect(within(hero).getByRole('heading', { name: 'Bugünün çalışması' })).toBeInTheDocument();
    expect(within(hero).getByTestId('today-split')).toHaveTextContent('2 kart kaldı · 0 tekrar · 2 yeni');
    expect(within(hero).getByRole('progressbar', { name: 'Bugünün çalışması' })).toHaveAttribute(
      'aria-valuetext',
      'Bugün 0 / 2 kart',
    );
    expect(within(hero).getByRole('link', { name: /Çalışmaya başla/ })).toHaveAttribute(
      'href',
      '/study?mode=word',
    );
    // One chip per mode on the Today card: the whole day at a glance (ADR 0055).
    expect(within(hero).getByTestId('study-type-word')).toHaveAccessibleName(/^Kelime\s*2 kart$/);
    // A new user's Üretim has no card open yet: the card says when it opens (v0.5.2).
    expect(within(hero).getByTestId('study-type-production')).toHaveAccessibleName(
      /^Üretim\s*henüz açılmadı$/,
    );
    expect(within(hero).getByTestId('today-locked-hint')).toHaveTextContent('Pekişiyor');
    expect(await screen.findByTestId('home-words')).toHaveTextContent('/ 2 kelimenden');

    // Answer every word card (Easy graduates them): the calm "done" state takes over.
    for (const item of (await getStudyQueue()).items)
      await answerCard({ card_id: item.card_id, rating: 4, duration_ms: 5000 });
    const done = await screen.findByTestId('today-hero-done');
    expect(within(done).getByRole('heading', { name: 'Bugünlük tamam' })).toBeInTheDocument();
    expect(within(done).getByText('0 tekrar · 2 yeni kart')).toBeInTheDocument();
    expect(done).toHaveTextContent('2 / 2');
    expect(within(done).getByRole('status')).toHaveTextContent(/Sıradaki çalışma|Yarın/);
    expect(screen.queryByRole('link', { name: /Devam et|başla/ })).toBeNull();
    expect(await db.daily_activity.count()).toBe(1);
  });

  it('is not done while another mode still has cards; the button starts one mixed session (B3)', async () => {
    await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] });
    // Kelime has nothing today; Üretim has one card open.
    await db.cards.where('card_type').equals('recognition').modify({ suspended: true });
    await db.cards.where('card_type').equals('production').modify({ unlocked: true });
    renderRoute(<HomeScreen />);
    const hero = await screen.findByTestId('today-hero');
    expect(screen.queryByTestId('today-hero-done')).toBeNull();
    expect(within(hero).getByTestId('today-split')).toHaveTextContent('1 kart kaldı');
    expect(within(hero).getByTestId('start-study')).toHaveTextContent('Çalışmaya başla');
    expect(within(hero).getByTestId('start-study')).toHaveAttribute('href', '/study?mode=mixed');
    expect(screen.queryByTestId('more-study')).toBeNull();
  });

  it('offers daily-goal presets when no goal is set, then shows the goal under Kısayollar', async () => {
    await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] });
    renderRoute(<HomeScreen />);
    const goals = await screen.findByTestId('home-goals');
    expect(screen.queryByTestId('goal-day')).toBeNull();
    fireEvent.click(within(goals).getByRole('button', { name: '15 dk' }));
    expect(await screen.findByTestId('goal-day')).toHaveTextContent('0/15 dk');
    expect(screen.queryByTestId('home-goals')).toBeNull();
  });

  it('opens the streak sheet from the streak line', async () => {
    await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] });
    renderRoute(<HomeScreen />);
    fireEvent.click(await screen.findByTestId('today-streak'));
    const sheet = await screen.findByTestId('streak-sheet');
    expect(sheet).toHaveTextContent('en az bir kart');
    expect(await within(sheet).findByTestId('streak-protection')).toHaveTextContent(
      'Bu ay 2 / 2 koruma kaldı.',
    );
    expect(sheet).toHaveTextContent('seriye sayılmaz');
  });

  it('links the goals row to the goal editor', async () => {
    await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] });
    await updateGoals({ day_minutes: 15, week_minutes: 60, target_level: 'C1' });
    renderRoute(<HomeScreen />);
    const shortcuts = await screen.findByTestId('home-shortcuts');
    expect(within(shortcuts).getByTestId('goal-day')).toHaveTextContent('0/15 dk');
    expect(within(shortcuts).getByRole('link', { name: /Hedeflerin/ })).toHaveAttribute(
      'href',
      '/progress?edit=goals',
    );
    expect(within(shortcuts).getByRole('link', { name: /Kelime Bankası/ })).toHaveAttribute(
      'href',
      '/decks?tab=bank',
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
