/**
 * v0.4 İP3 performance: the acceptance numbers of perf.spec.ts (session opens < 1 s, card
 * switch < 100 ms) with a picture on every card. 1,000 cards from the realistic seed; every
 * sense then points at a lexicon sense with a cached picture (raw IndexedDB, as the picture
 * fetcher would have left it). The next card's picture is decoded while the current one is read.
 * Run alone for stable numbers: `pnpm e2e images-perf`. Times are measured inside the page;
 * on CI the bounds are the real budget, locally they scale with the load (support/perf.ts).
 */
import type { Page } from '@playwright/test';
import { expect, test } from './support/app.ts';
import { restoreSeed } from './support/restore.ts';
import { budget, median, p95, perfSlack, round1 as r, slackNow, timeFirstCard } from './support/perf.ts';
import { ALT, SAMPLE_NAMES } from './support/images.ts';
import { SAMPLE_PICTURES } from '../../src/test/imageSamples.ts';

/** Every sense gets a lexicon sense id and one cached picture (the six samples in turn). */
async function addPictures(page: Page): Promise<number> {
  const samples = SAMPLE_NAMES.map((n) => ({ svg: SAMPLE_PICTURES[n].svg, alt: ALT[n] }));
  return page.evaluate(async (pics) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('engapp');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = db.transaction(['senses', 'images'], 'readwrite');
    const senses = tx.objectStore('senses');
    const images = tx.objectStore('images');
    const all = await new Promise<Record<string, unknown>[]>((res) => {
      const q = senses.getAll();
      q.onsuccess = () => res(q.result);
    });
    const uuid = (prefix: string, n: number) => `0199f0a0-0000-7000-${prefix}-${n.toString(16).padStart(12, '0')}`;
    all.forEach((s, i) => {
      const lex = uuid('8000', i);
      senses.put({ ...s, lexicon_sense_id: lex });
      const p = pics[i % pics.length]!;
      images.put({
        id: uuid('9000', i),
        sense_id: lex,
        variant: 0,
        svg: p.svg,
        alt_tr: p.alt,
        status: 'approved',
        created_at: '2026-10-20T01:30:00Z',
        fetched_at: Date.now(),
      });
    });
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
    return all.length;
  }, samples);
}

/**
 * One card switch: flip (not timed; the back must show a decoded picture), wait a reading
 * moment, answer "3", time until the next card is painted.
 */
async function timeSwitch(page: Page, readMs = 250): Promise<number> {
  await page.locator('body').press('Space');
  await expect(page.getByRole('group', { name: 'Ne kadar iyi hatırladın?' })).toBeVisible();
  const img = page.getByTestId('card-picture').locator('img').first();
  await expect(img).toBeVisible();
  expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  await page.waitForTimeout(readMs); // reading time: the next card and its picture are prefetched
  return page.evaluate(async () => {
    const before = document.querySelector('[data-card-type]');
    const t0 = performance.now();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', code: 'Digit3', bubbles: true }));
    await new Promise<void>((resolve, reject) => {
      const check = () => {
        if (/Oturum tamamlandı/.test(document.body.innerText)) {
          reject(new Error('The review session ended before 20 card switches'));
          return true;
        }
        const now = document.querySelector('[data-card-type]');
        return now !== null && now !== before && now.getAttribute('data-flipped') === 'false';
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

test('1,000 cards with pictures: session opens < 1 s, card switch < 100 ms', async ({ page }, info) => {
  const start = perfSlack();
  test.setTimeout(240_000 * start.factor);
  const seeded = await restoreSeed(page, 1_000);
  const pictures = await addPictures(page);

  await page.goto('/');
  await expect(page.getByTestId('start-study')).toBeVisible();
  await page.waitForTimeout(500);
  const warm = (await timeFirstCard(page, 'click')).ms;

  const coldRuns: number[] = [];
  for (let i = 0; i < 3; i++) {
    await page.goto('about:blank');
    await page.goto('/review', { waitUntil: 'commit' });
    coldRuns.push((await timeFirstCard(page, 'none')).at); // from navigation start
  }
  const cold = median(coldRuns);

  const switches: number[] = [];
  for (let i = 0; i < 20; i++) switches.push(await timeSwitch(page, 250 * start.factor)); // a longer read on a busy machine

  const slack = slackNow(start);
  const result = {
    cards: seeded.cards,
    pictures,
    session_open_warm_ms: r(warm),
    session_open_cold_ms: r(cold),
    switch_median_ms: r(median(switches)),
    switch_p95_ms: r(p95(switches)),
    switch_max_ms: r(Math.max(...switches)),
    bound_factor: slack.factor,
    bound_reason: slack.reason,
  };
  console.log(`[perf-images] ${JSON.stringify(result)}`);
  info.annotations.push({ type: 'perf', description: JSON.stringify(result) });

  expect(warm).toBeLessThan(budget(1000, slack));
  expect(cold).toBeLessThan(budget(1000, slack));
  expect(median(switches)).toBeLessThan(budget(100, slack));
  expect(p95(switches)).toBeLessThan(budget(100, slack));
});
