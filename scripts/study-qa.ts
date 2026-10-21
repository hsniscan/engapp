/**
 * Visual + a11y + timing QA for the study screens (home, review, stats).
 *   pnpm dev --port 5201 &   then   node scripts/study-qa.ts [baseUrl] [outDir]
 * Seeds demo data through src/features/review/dev/seedDemo.ts (dev server only), takes
 * screenshots at 360/1280 px in light/dark (prefix `f-`), runs axe and prints timings.
 * Set CHROMIUM_PATH to use a preinstalled Chromium. Exits 1 on any axe violation.
 */
import { mkdirSync } from 'node:fs';
import { chromium, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const base = process.argv[2] ?? 'http://localhost:5201';
const out = process.argv[3] ?? 'docs/screenshots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
let violations = 0;

async function axe(page: Page, label: string) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  for (const v of result.violations) {
    violations++;
    console.log(`[${label}] ${v.id}: ${v.help}`);
    for (const n of v.nodes.slice(0, 3))
      console.log('   ', n.target.join(' '), n.failureSummary?.split('\n')[1] ?? '');
  }
}

// Seed once, then reuse the IndexedDB snapshot for every viewport/theme.
const seedCtx = await browser.newContext();
const seedPage = await seedCtx.newPage();
await seedPage.goto(base + '/', { waitUntil: 'networkidle' });
const seeded = await seedPage.evaluate(async () => {
  const m = await import(/* @vite-ignore */ '/src/features/review/dev/seedDemo.ts');
  return m.seedDemo();
});
console.log('seeded', seeded);
const state = await seedCtx.storageState({ indexedDB: true });
await seedCtx.close();

for (const theme of ['light', 'dark'] as const) {
  for (const width of [360, 1280]) {
    const tag = `${width}-${theme}`;
    const opts = {
      viewport: { width, height: width === 360 ? 780 : 860 },
      deviceScaleFactor: width === 360 ? 2 : 1,
      colorScheme: theme,
      reducedMotion: 'reduce' as const,
    };

    // First run: empty database.
    {
      const ctx = await browser.newContext(opts);
      await ctx.addInitScript((t) => localStorage.setItem('engapp.theme', t), theme);
      const page = await ctx.newPage();
      await page.goto(base + '/', { waitUntil: 'networkidle' });
      await page.getByRole('heading', { level: 1 }).waitFor();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/f-home-empty-${tag}.png` });
      await axe(page, `${tag} home-empty`);
      await ctx.close();
    }

    const ctx = await browser.newContext({ ...opts, storageState: state });
    await ctx.addInitScript((t) => localStorage.setItem('engapp.theme', t), theme);
    const page = await ctx.newPage();

    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.getByText('Tekrara başla').first().waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/f-home-${tag}.png`, fullPage: true });
    await axe(page, `${tag} home`);

    await page.goto(base + '/stats', { waitUntil: 'networkidle' });
    await page.getByRole('grid').waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/f-stats-${tag}.png`, fullPage: true });
    await axe(page, `${tag} stats`);

    await page.goto(base + '/', { waitUntil: 'networkidle' });
    const t0 = Date.now();
    await page.locator('a[href="/review"]').first().click();
    await page.locator('[data-card-type]').waitFor();
    if (tag === '1280-light')
      console.log('review open (home click → first card):', Date.now() - t0, 'ms');

    const seen = new Set<string>();
    const switches: number[] = [];
    for (let i = 0; i < 80; i++) {
      const card = page.locator('[data-card-type]');
      if (!(await card.count())) break;
      const type = (await card.getAttribute('data-card-type'))!;
      const first = !seen.has(type);
      if (first) {
        await page.waitForTimeout(250);
        await page.screenshot({ path: `${out}/f-review-${type}-front-${tag}.png` });
        if (seen.size === 0) await axe(page, `${tag} review-front`);
      }
      await page.keyboard.press('Space');
      await page.locator('[data-flipped="true"]').waitFor();
      if (first) {
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${out}/f-review-${type}-back-${tag}.png` });
        if (seen.size === 0) await axe(page, `${tag} review-back`);
        seen.add(type);
      }
      // Time from the answer key to the next card being on screen.
      const ms = await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            const before = document.querySelector('[data-card-type]');
            const start = performance.now();
            window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
            const tick = () => {
              const el = document.querySelector('[data-card-type]');
              if (
                (el && el !== before && el.getAttribute('data-flipped') === 'false') ||
                document.getElementById('summary-title')
              ) {
                resolve(performance.now() - start);
              } else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }),
      );
      switches.push(ms);
      if (await page.locator('#summary-title').count()) break;
    }
    await page.locator('#summary-title').waitFor({ timeout: 15000 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/f-summary-${tag}.png`, fullPage: true });
    await axe(page, `${tag} summary`);
    if (tag === '1280-light') {
      switches.sort((a, b) => a - b);
      console.log(
        `card switch (key → next card painted): n=${switches.length} median=${switches[switches.length >> 1]!.toFixed(1)}ms max=${switches.at(-1)!.toFixed(1)}ms`,
      );
    }
    console.log(tag, 'card types seen:', [...seen].join(', '));

    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.getByText('Bugünlük bitti').first().waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/f-home-done-${tag}.png`, fullPage: true });
    await axe(page, `${tag} home-done`);
    await ctx.close();
  }
}

// 1,000-card timing.
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  const timing = await page.evaluate(async () => {
    const seed = await import(/* @vite-ignore */ '/src/features/review/dev/seedDemo.ts');
    const data = await import(/* @vite-ignore */ '/src/data/index.ts');
    await seed.seedBulk(1000);
    const t = performance.now();
    const q = await data.getStudyQueue();
    const q1 = performance.now() - t;
    const t2 = performance.now();
    await data.getCardView(q.items[0].card_id);
    return {
      queueMs: q1,
      viewMs: performance.now() - t2,
      items: q.items.length,
      cards: await data.db.cards.count(),
    };
  });
  console.log('1000 cards:', timing);
  // In-app navigation (as from the home button), so dev-server module loading is excluded.
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.locator('a[href="/review"]').first().waitFor();
  const t0 = Date.now();
  await page.locator('a[href="/review"]').first().click();
  await page.locator('[data-card-type]').waitFor();
  console.log('1000 cards: home → first card on screen:', Date.now() - t0, 'ms');
  await ctx.close();
}

await browser.close();
console.log(`axe violations: ${violations}`);
process.exit(violations ? 1 : 0);
