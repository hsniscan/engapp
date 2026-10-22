/**
 * Acceptance criterion 4 in the production build: with 1,000 cards (and 10,000, for headroom)
 * a review session opens in < 1 s and a card switch takes < 100 ms.
 *
 *   session open (warm): home → tap "Tekrara başla" → first card on screen (client navigation,
 *                         queue built from IndexedDB, first card view loaded, painted)
 *   session open (cold):  full page load of /review → first card on screen (JS parse included)
 *   card switch:          key "3" on a flipped card → next card painted (median and p95 of 20)
 *
 * Data: a realistic backup (src/domain FSRS histories, tests/e2e/support/seed.ts) restored with
 * the app's own "Geri yükle". Run alone for stable numbers: `pnpm e2e perf`.
 */
import { writeFile } from 'node:fs/promises';
import { expect, test } from './support/app.ts';
import { restoreSeed as restore } from './support/restore.ts';
import type { Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

/** Time from `trigger` until an enabled "Cevabı göster" is painted. */
async function timeFirstCard(page: Page, trigger: 'click' | 'none'): Promise<number> {
  return page.evaluate(async (how) => {
    const ready = () => {
      const b = [...document.querySelectorAll('button')].find(
        (x) => x.textContent?.trim() === 'Cevabı göster',
      );
      return !!b && !b.disabled && !!document.querySelector('[data-card-type]');
    };
    const t0 = performance.now();
    if (how === 'click') (document.querySelector('a[href="/review"]') as HTMLAnchorElement).click();
    await new Promise<void>((resolve) => {
      if (ready()) return resolve();
      const mo = new MutationObserver(() => {
        if (ready()) {
          mo.disconnect();
          resolve();
        }
      });
      mo.observe(document.body, { subtree: true, childList: true, attributes: true });
    });
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); // painted
    return performance.now() - t0;
  }, trigger);
}

/** One card switch: flip (not timed), wait a reading moment, answer "3", time until painted. */
async function timeSwitch(page: Page): Promise<number> {
  await page.locator('body').press('Space');
  await expect(page.getByRole('group', { name: 'Ne kadar iyi hatırladın?' })).toBeVisible();
  await page.waitForTimeout(250); // reading time: the next card is prefetched meanwhile
  return page.evaluate(async () => {
    const before = document.querySelector('[data-card-type]');
    const t0 = performance.now();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', code: 'Digit3', bubbles: true }));
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        // The session ran out of cards: fail now instead of at the test timeout.
        if (document.querySelector('h1, h2') && /Oturum tamamlandı/.test(document.body.innerText))
          throw new Error('The review session ended before 20 card switches (seed too small)');
        const now = document.querySelector('[data-card-type]');
        return now !== null && now !== before && now.getAttribute('data-flipped') === 'false';
      };
      const check = () => {
        try {
          return done();
        } catch (e) {
          reject(e);
          return true;
        }
      };
      if (check()) return resolve();
      const mo = new MutationObserver(() => {
        if (check()) {
          mo.disconnect();
          resolve();
        }
      });
      mo.observe(document.body, { subtree: true, childList: true, attributes: true });
    });
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    return performance.now() - t0;
  });
}

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
const p95 = (a: number[]) => [...a].sort((x, y) => x - y)[Math.ceil(a.length * 0.95) - 1]!;
const r = (n: number) => Math.round(n * 10) / 10;

// 10,000 cards (headroom; the restore alone is timed by restore-perf.spec.ts) runs locally,
// on CI only with E2E_PERF_10K=1.
const SIZES = process.env.CI && !process.env.E2E_PERF_10K ? [1_000] : [1_000, 10_000];

for (const size of SIZES) {
  test(`${size.toLocaleString('en')} cards: session opens < 1 s, card switch < 100 ms`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    const seeded = await restore(page, size);

    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Tekrara başla' })).toBeVisible();
    await page.waitForTimeout(500);
    const warm = await timeFirstCard(page, 'click');

    // Cold: full load of /review; measured from navigation start (performance.now() origin).
    const coldRuns: number[] = [];
    for (let i = 0; i < 3; i++) {
      await page.goto('about:blank');
      await page.goto('/review', { waitUntil: 'commit' });
      await timeFirstCard(page, 'none');
      coldRuns.push(await page.evaluate(() => performance.now()));
    }
    const coldFromNav = median(coldRuns);

    const switches: number[] = [];
    for (let i = 0; i < 20; i++) switches.push(await timeSwitch(page));

    const result = {
      cards: seeded.cards,
      review_logs: seeded.logs,
      backup_mb: r(seeded.bytes / 1e6),
      restore_ms: seeded.restoreMs,
      session_open_warm_ms: r(warm),
      session_open_cold_ms: r(coldFromNav),
      switch_median_ms: r(median(switches)),
      switch_p95_ms: r(p95(switches)),
      switch_max_ms: r(Math.max(...switches)),
    };
    console.log(`[perf] ${JSON.stringify(result)}`);
    await writeFile(info.outputPath(`perf-${size}.json`), JSON.stringify(result, null, 2));
    info.annotations.push({ type: 'perf', description: JSON.stringify(result) });

    expect(warm).toBeLessThan(1000);
    expect(coldFromNav).toBeLessThan(size <= 1000 ? 1000 : 2000);
    expect(median(switches)).toBeLessThan(100);
    expect(p95(switches)).toBeLessThan(100);
  });
}
