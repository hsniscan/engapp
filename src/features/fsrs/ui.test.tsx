import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { default_w } from 'ts-fsrs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, ensureSettings, getSettings, updateSettings } from '@/data';
import { clipToBounds, type OptimizeResult } from '@/domain/fsrsOptimizer';
import type { RatingValue } from '@/domain/types';
import { resetDb } from '@/test/db';
import { makeLog } from '@/test/factories';
import { simulateLogs } from '@/test/fsrsSim';
import { renderRoute } from '@/test/ui';
import { FsrsOptimizerRow, RetentionHelper } from './FsrsSettings';
import { FsrsOptOffer } from './FsrsOptOffer';
import * as runner from './runOptimizer';

vi.mock('./runOptimizer', async (importOriginal) => {
  const real = await importOriginal<typeof import('./runOptimizer')>();
  return { ...real, runOptimizer: vi.fn(real.runOptimizer) };
});

const DEFAULTS = [...default_w];
const LEARNER = clipToBounds(
  DEFAULTS.map((v, i) =>
    i === 0 ? 0.1 : i === 2 ? 1.2 : i === 3 ? 4 : i === 8 ? 1.5 : i === 20 ? 0.35 : v,
  ),
);

async function seed(cards: number): Promise<number> {
  const logs = simulateLogs({ cards, trueW: LEARNER, schedW: DEFAULTS, seed: 3 }).map((l) =>
    makeLog({ card_id: l.card_id, reviewed_at: l.reviewed_at, rating: l.rating as RatingValue }),
  );
  await db.review_logs.bulkAdd(logs);
  return logs.length;
}

beforeEach(async () => {
  await resetDb();
  await ensureSettings(Date.UTC(2026, 9, 22));
});

describe('Settings → Kart zamanlamasını hafızama göre ayarla', { timeout: 30_000 }, () => {
  it('below 1 000 reviews: explains how many are needed, no button', async () => {
    await seed(20);
    renderRoute(<FsrsOptimizerRow />);
    expect(await screen.findByText(/en az 1\.000 tekrar gerekiyor/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ayarla' })).not.toBeInTheDocument();
  });

  it('runs on the device, adopts better params, explains the result and reverts in one tap', async () => {
    const user = userEvent.setup();
    await seed(900);
    renderRoute(<FsrsOptimizerRow />);
    expect(
      await screen.findByText(/Artık kartların zamanlamasını senin hafızana göre/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ayarla' }));
    const result = await screen.findByTestId('fsrs-result', {}, { timeout: 15_000 });
    expect(result).toHaveTextContent(/tahmin isabeti %\d+ iyileşti/);
    expect(result).toHaveTextContent(/günlük tekrarın ~%\d+ (artacak|azalacak)|aşağı yukarı aynı/);
    const s = await getSettings();
    expect(s.fsrs_params).toHaveLength(21);
    expect(s.fsrs_params_prev).toBeNull();
    expect(s.fsrs_opt_at).toEqual(expect.any(Number));
    expect(screen.getByText(/sana özel ayar kullanılıyor/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Eski ayara dön' }));
    await waitFor(async () => expect((await getSettings()).fsrs_params).toBeNull());
    expect(await screen.findByText(/herkes için ortak ayar/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eski ayara dön' })).not.toBeInTheDocument();
  }, 30_000);

  it('keeps the current params and says so when the new ones are not better', async () => {
    const user = userEvent.setup();
    await seed(900);
    const kept: OptimizeResult = {
      adopted: false,
      reason: 'not_better',
      params: DEFAULTS,
      candidate: DEFAULTS,
      current: null,
      next: null,
      accuracyGainPct: 0,
      workloadNow: 50,
      workloadNext: 50,
      reviews: 5000,
      trainItems: 2000,
      testItems: 500,
    };
    vi.mocked(runner.runOptimizer).mockResolvedValueOnce(kept);
    renderRoute(<FsrsOptimizerRow />);
    await user.click(await screen.findByRole('button', { name: 'Ayarla' }));
    expect(await screen.findByTestId('fsrs-result')).toHaveTextContent(/hiçbir şeyi değiştirmedim/);
    const s = await getSettings();
    expect(s.fsrs_params).toBeNull();
    expect(s.fsrs_opt_at).toEqual(expect.any(Number));
    // Ran just now: no suggestion until next month.
    expect(screen.queryByText(/Artık kartların zamanlamasını/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yeniden ayarla' })).toBeInTheDocument();
  });
});

describe('retention helper', () => {
  it('shows expected daily reviews at 85 / 90 / 95 %, more at a higher target', async () => {
    await db.cards.bulkAdd(
      Array.from({ length: 40 }, (_, i) => ({
        id: `c${i}`,
        note_id: `n${i}`,
        state: 2,
        stability: 5 + i,
        deleted_at: null,
        suspended: false,
      })) as never,
    );
    await updateSettings({ daily_new_limit: 0 });
    renderRoute(<RetentionHelper settings={await getSettings()} />);
    const list = await screen.findByTestId('retention-helper');
    const counts = [...list.querySelectorAll('li')].map((li) =>
      Number(/~(\d+)/.exec(li.textContent ?? '')?.[1]),
    );
    expect(counts).toHaveLength(3);
    expect(counts[0]!).toBeLessThan(counts[2]!);
    expect(list).toHaveTextContent('%90 hatırlama');
    expect(list).toHaveTextContent('Şu anki hedefin');
  });
});

describe('home offer', { timeout: 30_000 }, () => {
  it('appears at 1 000 reviews and "Sonra" hides it for a month', async () => {
    const user = userEvent.setup();
    await seed(900);
    renderRoute(<FsrsOptOffer />);
    expect(
      await screen.findByRole('region', { name: 'Algoritmayı hafızana göre ayarlayalım mı?' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ayarla' })).toHaveAttribute(
      'href',
      '/settings/calisma',
    );
    await user.click(screen.getByRole('button', { name: 'Sonra' }));
    await waitFor(() => expect(screen.queryByTestId('fsrs-offer')).not.toBeInTheDocument());
  });

  it('is not shown below 1 000 reviews', async () => {
    await seed(20);
    const { container } = renderRoute(<FsrsOptOffer />);
    await new Promise((r) => setTimeout(r, 200));
    expect(container.querySelector('[data-testid="fsrs-offer"]')).toBeNull();
  });
});
