/**
 * Google Play store graphics (v0.4 İP7):
 *   - 6 phone screenshots × light and dark, 1080×1920 PNG, from seeded demo data
 *     (src/features/review/dev/seedDemo.ts): home, review front, review back, add from text,
 *     stats, settings;
 *   - the 512×512 app icon (the Engapp mark, full square: Play applies its own mask);
 *   - the 1024×500 feature graphic, from the design tokens.
 * Output: docs/play-store/screenshots/ and docs/play-store/graphics/.
 *
 *   node scripts/store-shots.ts
 *
 * Starts the Vite dev server itself and drives Playwright's Chromium (already a devDependency;
 * set CHROMIUM_PATH for a preinstalled browser). The app runs signed in to a demo account
 * against the in-process fake backend of the e2e tests (tests/e2e/support/backend.ts): no
 * network, no real account, no live AI call (the text extraction answers from the fake model).
 * Run it from the repository root. No new dependency.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { markSvg } from '../src/ui/brand/mark.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shotsDir = join(root, 'docs/play-store/screenshots');
const gfxDir = join(root, 'docs/play-store/graphics');
mkdirSync(shotsDir, { recursive: true });
mkdirSync(gfxDir, { recursive: true });

/** 360×640 CSS px at 3× = 1080×1920 (9:16, inside Play's 2:1 limit). */
const VIEWPORT = { width: 360, height: 640 };
const SCALE = 3;
/** Fixed clock so the dates, streak and due counts are the same on every run. */
const NOW = Date.UTC(2026, 9, 21, 16, 30); // 21 Oct 2026, 19:30 in Istanbul

/** A made-up demo account: never a real person's name or address. */
const DEMO = { name: 'Deniz Yılmaz', email: 'deniz@example.com' };

// The fake backend answers for this project URL (see tests/e2e/support/backend.ts).
process.env.VITE_SUPABASE_URL = 'https://bikcjlomrjaxymifxogi.supabase.co';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_store_shots';
const server = await createServer({
  root,
  configFile: join(root, 'vite.config.ts'),
  server: { port: 5296, strictPort: false, host: '127.0.0.1' },
  logLevel: 'warn',
  // No .env files: the backend settings come from the two variables above.
  envDir: join(root, 'scripts'),
});
await server.listen();
const base = server.resolvedUrls?.local[0]?.replace(/\/$/, '') ?? 'http://127.0.0.1:5296';

// Loaded through Vite: the e2e support code uses extensionless imports Node cannot resolve.
type BackendModule = typeof import('../tests/e2e/support/backend.ts');
type SpecsModule = typeof import('../src/features/import/testing/fakeSpecs.ts');
const { FakeBackend, fakeSession } = (await server.ssrLoadModule(
  '/tests/e2e/support/backend.ts',
)) as BackendModule;
const { FAKE_SPECS } = (await server.ssrLoadModule(
  '/src/features/import/testing/fakeSpecs.ts',
)) as SpecsModule;
const SAMPLE_TEXT = FAKE_SPECS.slice(0, 12)
  .map((s) => s.sentence)
  .join(' ');
const session = fakeSession() as { user: { email: string; user_metadata: Record<string, string> } };
session.user.email = DEMO.email;
session.user.user_metadata.full_name = DEMO.name;
session.user.user_metadata.name = DEMO.name;
delete session.user.user_metadata.avatar_url; // initials instead of a placeholder picture

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

async function settle(page: Page, ms = 500) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
}

async function shoot(page: Page, name: string, theme: string) {
  await settle(page);
  const path = join(shotsDir, `${name}-${theme}.png`);
  await page.screenshot({ path });
  console.log('wrote', path.slice(root.length + 1));
}

try {
  for (const theme of ['light', 'dark'] as const) {
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: SCALE,
      isMobile: true,
      hasTouch: true,
      colorScheme: theme,
      reducedMotion: 'reduce',
      locale: 'tr-TR',
      timezoneId: 'Europe/Istanbul',
      serviceWorkers: 'block',
    });
    await ctx.addInitScript(
      ({ theme, now }) => {
        localStorage.setItem('engapp.theme', theme);
        // A fixed clock for the whole page (Date only; timers keep running).
        const RealDate = Date;
        const offset = now - RealDate.now();
        class FixedDate extends RealDate {
          constructor(...args: unknown[]) {
            if (args.length === 0) super(RealDate.now() + offset);
            else super(...(args as [number]));
          }
          static now() {
            return RealDate.now() + offset;
          }
        }
        (globalThis as { Date: DateConstructor }).Date = FixedDate as DateConstructor;
      },
      { theme, now: NOW },
    );
    const backend = new FakeBackend();
    await backend.install(ctx);
    // Later routes win: the demo account's profile instead of the e2e test user's.
    await ctx.route(`${process.env.VITE_SUPABASE_URL}/auth/v1/user`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
        body: JSON.stringify(session.user),
      }),
    );
    const page = await ctx.newPage();
    await page.goto(`${base}/`);
    await settle(page, 300);
    // Demo words with ~4 months of history, made as a guest; then the demo account signs in
    // and takes them over (first sign-in on a device with guest data and an empty account).
    await page.evaluate(
      async ([seedPath, dataPath]) => {
        const seed = await import(/* @vite-ignore */ seedPath!);
        await seed.resetLocalData();
        await seed.seedDemo({ days: 120, seed: 7 });
        const data = await import(/* @vite-ignore */ dataPath!);
        await data.ensureSettings();
        await data.updateSettings({
          interests: ['travel', 'business', 'technology'],
          last_backup_at: Date.now() - 86_400_000,
        });
      },
      ['/src/features/review/dev/seedDemo.ts', '/src/data/index.ts'],
    );
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key!, value!),
      ['sb-bikcjlomrjaxymifxogi-auth-token', JSON.stringify(session)],
    );
    await page.goto(`${base}/`);
    await page
      .getByRole('status', { name: 'Senkron durumu: Senkronlandı' })
      .waitFor({ timeout: 60_000 });
    // The one-time prompts (level test offer, last week's report) answered, like a settled user.
    await page.evaluate(
      async ([dataPath, levelPath]) => {
        const data = await import(/* @vite-ignore */ dataPath!);
        const level = await import(/* @vite-ignore */ levelPath!);
        await data.setMeta(level.OFFER_DISMISSED_KEY, true);
        const notice = await data.getReportNotice();
        if (notice) await data.markReportSeen(notice.week);
      },
      ['/src/data/index.ts', '/src/features/leveltest/levelText.ts'],
    );

    await page.goto(`${base}/`);
    await shoot(page, '1-home', theme);

    await page.goto(`${base}/review`);
    await settle(page);
    await shoot(page, '2-review-front', theme);
    await page.getByRole('button', { name: /Cevabı göster/ }).click();
    await shoot(page, '3-review-back', theme);

    // Add from text: the fake model's candidates, in the import preview.
    await page.goto(`${base}/add?tab=paste`);
    await page.getByLabel('İngilizce metin').fill(SAMPLE_TEXT);
    await page.getByLabel('Başlık').fill('Şehirler ve iklim');
    await page.getByRole('button', { name: 'Kelimeleri çıkar' }).click();
    await page.getByRole('link', { name: 'Önizlemeyi aç' }).click({ timeout: 60_000 });
    await page.waitForURL(/\/import\//);
    await settle(page);
    // Past the summary, onto the candidate cards.
    await page.evaluate(() => window.scrollBy(0, 330));
    await shoot(page, '4-add-from-text', theme);

    await page.goto(`${base}/stats`);
    await shoot(page, '5-stats', theme);

    await page.goto(`${base}/settings`);
    await shoot(page, '6-settings', theme);
    await ctx.close();
  }

  // ---------------------------------------------------------------- icon and feature graphic
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.setViewportSize({ width: 512, height: 512 });
  await page.setContent(
    `<html><body style="margin:0">${markSvg({ tile: 'square', scale: 0.5 }).replace('<svg ', '<svg width="512" height="512" ')}</body></html>`,
  );
  await page.screenshot({ path: join(gfxDir, 'icon-512.png') });
  console.log('wrote docs/play-store/graphics/icon-512.png');

  await page.goto(`${base}/`); // same origin: the app's fonts and tokens are available
  await page.setViewportSize({ width: 1024, height: 500 });
  await page.evaluate((mark) => {
    document.documentElement.dataset.theme = 'light';
    document.body.innerHTML = `
      <div id="fg" style="position:fixed;inset:0;display:flex;align-items:center;gap:56px;
        padding:0 72px;background:var(--canvas);color:var(--fg);font-family:var(--font-sans, system-ui)">
        <div style="flex:none;width:208px;height:208px">${mark}</div>
        <div style="display:flex;flex-direction:column;gap:18px;min-width:0">
          <div style="font-family:'Source Serif 4',serif;font-weight:600;font-size:64px;line-height:1;letter-spacing:-0.01em">Engapp</div>
          <div style="font-family:'Source Serif 4',serif;font-size:34px;line-height:1.2;color:var(--fg)">İngilizce kelimeler,<br>her gün biraz.</div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:19px">
            <span style="padding:7px 14px;border-radius:999px;background:var(--accent-soft);color:var(--accent-text)">Aralıklı tekrar</span>
            <span style="padding:7px 14px;border-radius:999px;background:var(--accent-soft);color:var(--accent-text)">Metinden kart</span>
            <span style="padding:7px 14px;border-radius:999px;background:var(--accent-soft);color:var(--accent-text)">İnternetsiz</span>
          </div>
        </div>
      </div>`;
  }, markSvg({ tile: 'rounded' }).replace('<svg ', '<svg width="208" height="208" '));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(gfxDir, 'feature-graphic-1024x500.png') });
  console.log('wrote docs/play-store/graphics/feature-graphic-1024x500.png');
} finally {
  await browser.close();
  await server.close();
}
