import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, ensureSettings, getSettings, saveLevelTest } from '@/data';
import { LEVELS } from '@/domain/levelTest';
import type { CefrLevel } from '@/domain/types';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { LevelChangeLine, LevelTestOffer } from './LevelHomeNotes';
import { levelDative } from './levelText';
import { VocabTile } from './VocabTile';

const ratios = (r: Partial<Record<CefrLevel, number>>) =>
  Object.fromEntries(LEVELS.map((b) => [b, r[b] ?? 0])) as Record<CefrLevel, number>;

beforeEach(async () => {
  await resetDb();
  await ensureSettings();
});

describe('level test offer', () => {
  it('is offered until dismissed, and not again', async () => {
    const user = userEvent.setup();
    renderRoute(<LevelTestOffer />);
    const offer = await screen.findByTestId('level-offer');
    expect(within(offer).getByRole('link', { name: 'Teste başla' })).toHaveAttribute('href', '/level-test');
    await user.click(within(offer).getByRole('button', { name: 'Gerek yok' }));
    await waitFor(() => expect(screen.queryByTestId('level-offer')).toBeNull());
  });

  it('is not offered once a test was taken (on any device: tests sync)', async () => {
    await saveLevelTest({
      items: [],
      level: 'B2',
      ratios: ratios({ A1: 1, A2: 1, B1: 0.9, B2: 0.8 }),
      reliable: true,
      falseAlarm: 0,
      vocabEstimate: 5000,
      bankVersion: 'b',
      durationMs: 1,
    });
    renderRoute(
      <>
        <LevelTestOffer />
        <VocabTile />
      </>,
    );
    expect(await screen.findByTestId('vocab-tile')).toBeInTheDocument();
    expect(screen.queryByTestId('level-offer')).toBeNull();
    expect(screen.getByTestId('vocab-next')).toHaveTextContent(/^C1'e ~[\d.]+ kelime kaldı$/);
  });
});

describe('vocabulary counter', () => {
  it('without a test or a chosen level it invites to the test, unless the offer already does', async () => {
    renderRoute(<VocabTile />);
    // The offer is visible (fresh user): no second invitation.
    await waitFor(() => expect(screen.queryByTestId('vocab-cta')).toBeNull());
    await db.meta.put({ key: 'level_test_offer_dismissed', value: true });
    expect(await screen.findByTestId('vocab-cta')).toHaveTextContent('Kaç kelime biliyorsun?');
  });
});

describe('level change note', () => {
  it('"Seviyen B1 → B2 oldu. Neden?" explains, and "Geri al" goes back to B1', async () => {
    const user = userEvent.setup();
    const s = await getSettings();
    await db.settings.put({
      ...s,
      level: 'B2',
      level_source: 'auto',
      level_updated_at: Date.now(),
      level_change: { from: 'B1', to: 'B2', week: 0, band: 'B2', ratio: 0.84, ratio_prev: 0.81, known: 46, unknown: 7, dismissed: false },
    });
    renderRoute(<LevelChangeLine />);
    const line = await screen.findByTestId('level-change');
    expect(line).toHaveTextContent('Seviyen B1 → B2 oldu.');
    await user.click(within(line).getByRole('button', { name: 'Neden?' }));
    const dialog = await screen.findByRole('dialog', { name: 'Seviyen B1 → B2 oldu' });
    expect(dialog).toHaveTextContent('B2 kelimelerinin %84 kadarını biliyorsun (bir önceki hafta %81)');
    expect(dialog).toHaveTextContent('46 bildiğin, 7 zorlandığın');
    await user.click(within(dialog).getByRole('button', { name: 'Geri al (B1 kalsın)' }));
    await waitFor(async () => expect(await getSettings()).toMatchObject({ level: 'B1', level_source: 'manual', level_change: null }));
    await waitFor(() => expect(screen.queryByTestId('level-change')).toBeNull());
  });

  it('the close button dismisses it on every device (synced settings)', async () => {
    const user = userEvent.setup();
    const s = await getSettings();
    await db.settings.put({
      ...s,
      level: 'A2',
      level_source: 'auto',
      level_change: { from: 'B1', to: 'A2', week: 0, band: 'B1', ratio: 0.5, ratio_prev: 0.55, known: 5, unknown: 9, dismissed: false },
    });
    renderRoute(<LevelChangeLine />);
    const line = await screen.findByTestId('level-change');
    await user.click(within(line).getByRole('button', { name: 'Kapat' }));
    await waitFor(() => expect(screen.queryByTestId('level-change')).toBeNull());
    expect((await getSettings()).level_change?.dismissed).toBe(true);
    expect(await db.outbox.where('table').equals('settings').count()).toBeGreaterThan(0);
  });
});

describe('levelDative', () => {
  it('reads the level aloud: bir → e, iki → ye', () => {
    expect(LEVELS.map(levelDative)).toEqual(["A1'e", "A2'ye", "B1'e", "B2'ye", "C1'e", "C2'ye"]);
  });
});
