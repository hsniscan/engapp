import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests against the production build (`vite build && vite preview`), the same bundle and
 * service worker users get. The Supabase backend is faked in-process (tests/e2e/support/backend.ts).
 *
 * Chromium: CHROMIUM_PATH (or /opt/pw-browsers/chromium when it exists) — otherwise the one
 * `pnpm exec playwright install chromium` downloaded.
 */
import { existsSync } from 'node:fs';

const preinstalled = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const executablePath =
  process.env.CHROMIUM_PATH ?? (existsSync(preinstalled) ? preinstalled : undefined);
const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
    // Fixed so that routes see every request (a service worker would fetch on its own).
    // The PWA test opts back in.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: process.env.E2E_SKIP_BUILD
      ? `pnpm preview --port ${port} --strictPort`
      : `pnpm build && pnpm preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
