import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { default_w } from 'ts-fsrs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeWorkload, db, ensureSettings, getSettings, getWorkloadInput, updateSettings } from '@/data';
import { averagePerDay } from '@/domain/forecast';
import { clipToBounds, type OptimizeResult } from '@/domain/fsrsOptimizer';
import { CardState, type RatingValue } from '@/domain/types';
import { resetDb } from '@/test/db';
import { makeCard, makeLog } from '@/test/factories';
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
  const NOW = Date.now();
  const DAY = 86_400_000;
  const studied = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      makeCard({
        note_id: `n${i}`,
        state: CardState.Review,
        stability: 3 + (i % 20),
        difficulty: 5,
        last_review: NOW - (i % 5) * DAY,
        due: NOW + (i % 7) * DAY,
        reps: 3,
      }),
    );
  const numbers = (list: HTMLElement) =>
    [...list.querySelectorAll('li')].map((li) => Number(/~(\d+)/.exec(li.textContent ?? '')?.[1]));

  it('runs İlerleme’s forecast at 85 / 90 / 95 %: the current one equals its average', async () => {
    await db.cards.bulkAdd(studied(120));
    await updateSettings({ daily_new_limit: 0 });
    renderRoute(<RetentionHelper settings={await getSettings()} />);
    const list = await screen.findByTestId('retention-helper');
    const counts = numbers(list);
    expect(counts).toHaveLength(3);
    // A real spread, not a few percent on top of a fixed new-card figure.
    expect(counts[0]!).toBeLessThanOrEqual(counts[1]!);
    expect(counts[1]!).toBeLessThanOrEqual(counts[2]!);
    const ilerleme = averagePerDay(computeWorkload(await getWorkloadInput()).totals);
    expect(counts[1]).toBe(ilerleme);
    expect(list).toHaveTextContent('%90 hatırlama');
    expect(list).toHaveTextContent('Şu anki hedefin');
    // The long-run difference is large, not a few percent on top of a fixed new-card figure.
    const [low = '', , high = ''] = [...list.querySelectorAll('li')].map((li) => li.textContent ?? '');
    const pctOf = (text: string) => Number(/%(\d+) daha/.exec(text)?.[1]);
    expect(low).toMatch(/Uzun vadede %\d+ daha az tekrar/);
    expect(high).toMatch(/Uzun vadede %\d+ daha çok tekrar/);
    expect(pctOf(low)).toBeGreaterThanOrEqual(20);
    expect(pctOf(high)).toBeGreaterThanOrEqual(40);
    expect(screen.getByText(/bekleyen yeni kelimen yok/)).toBeInTheDocument();
  });

  it('counts the word-only new budget only when new words are waiting', async () => {
    await db.cards.bulkAdd([
      ...studied(30),
      // Only extra-mode first-time cards wait: outside the daily budget (ADR 0079).
      ...Array.from({ length: 50 }, (_, i) => makeCard({ note_id: `x${i}`, card_type: 'production' })),
    ]);
    await updateSettings({ daily_new_limit: 40 });
    renderRoute(<RetentionHelper settings={await getSettings()} />);
    const list = await screen.findByTestId('retention-helper');
    expect(numbers(list)[1]!).toBeLessThan(40);
    expect(screen.getByText(/bekleyen yeni kelimen yok/)).toBeInTheDocument();
  });

  it('with new words waiting, says how many a day are included', async () => {
    await db.cards.bulkAdd([
      ...studied(30),
      ...Array.from({ length: 200 }, (_, i) => makeCard({ note_id: `w${i}` })),
    ]);
    await updateSettings({ daily_new_limit: 10 });
    renderRoute(<RetentionHelper settings={await getSettings()} />);
    expect(await screen.findByText(/günde 10 yeni kelime dahil/)).toBeInTheDocument();
  });

  it('asks to study first when no card was studied yet', async () => {
    renderRoute(<RetentionHelper settings={await getSettings()} />);
    expect(await screen.findByText(/Kartlarını çalışmaya başlayınca/)).toBeInTheDocument();
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
