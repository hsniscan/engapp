# QA report — v0.1

Date: 2026-10-21. Build: production (`pnpm build` + `vite preview`), Chromium (Playwright
1.64), headless, Linux container. Base commit 655f1e1 plus the QA changes listed at the end.

How to reproduce: `pnpm e2e` (all end-to-end tests; builds and serves the app itself),
`pnpm e2e perf` (performance only; run alone for stable numbers),
`SCREENSHOTS=1 pnpm e2e a11y` (visual sweep → `docs/screenshots/q-*.png`).

The Supabase backend is mocked in the browser (`tests/e2e/support/backend.ts`): auth session,
`sync_push` / `sync_pull` (last-writer-wins on `hlc`, append-only review logs), lexicon RPCs, and
the edge functions `ai-extract` / `ai-enrich`, which run the **real** server code
(`supabase/functions/_shared`) with an in-memory store and a scripted model that counts calls.

## Acceptance criteria

| #   | Criterion                                                                                      | How it is verified                                                                                                                                                                                                                                                                                                                                                          | Status                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | 14 days of daily review only in Engapp                                                         | Cannot be automated. Supporting: guest flow add → keyboard review → streak 1 (`guest-review.spec.ts`), streak/day-boundary unit tests (`src/domain/streak.test.ts`, `day.test.ts`).                                                                                                                                                                                         | **Needs the 14-day user check** (Hasan's daily one-line notes)                                                |
| 2   | Airplane mode: review, add, streak panel work; sync done within 1 min, no log lost             | `offline-sync.spec.ts`: service worker on, `context.setOffline(true)`, reload, review 3 cards + add a card + open stats, back online → every review log id is on the server. Measured: **4 logs pushed 260–320 ms** after reconnect (limit 60 s). `pwa.spec.ts` reloads every route offline. Session end now calls `requestSync()` too.                                     | **Pass** (real phone in airplane mode recommended once)                                                       |
| 3   | Same card answered differently on two offline devices → both logs kept, state recomputed       | `src/sync/engine.test.ts` › "both devices answer the same card offline: both logs kept, card recomputed identically" (+ delete/edit race, duplicate term, 31 days offline). Server side: `review_logs` append-only in the mock and in the SQL (`supabase/`).                                                                                                                | **Pass** (unit/integration; not in a browser)                                                                 |
| 4   | 1,000 cards: session opens < 1 s, card switch < 100 ms                                         | `perf.spec.ts` with a realistic backup (FSRS histories) restored via the app. See numbers below.                                                                                                                                                                                                                                                                            | **Pass** (desktop-class CPU; check once on a mid-range phone)                                                 |
| 5   | 20-page PDF → candidates within 60 s (quota permitting)                                        | Concurrency 3 with ordered recording (`src/features/import/queue.ts`); `queue.test.ts` › "import queue concurrency": 51,006 chars = 9 chunks at 4.5 s/chunk → **~20 s** (one by one: ~45 s), never more than 3 in flight, results in chunk order. PDF reading itself: `import-pdf.spec.ts` (3-page text PDF, scanned PDF message, not-a-PDF).                               | **Pass with note**: model latency measured as 4.5 s/chunk earlier; confirm once against the real Gemini quota |
| 6   | JSON backup restored into an empty browser → identical cards, history, streak                  | `backup.spec.ts`: mixed ratings, export via "Yedek al", fresh browser context, "Geri yükle" → `notes, senses, cards, review_logs, daily_activity, sources` deep-equal, streak panel text equal.                                                                                                                                                                             | **Pass**                                                                                                      |
| 7   | Lighthouse: installable, accessibility ≥ 95                                                    | Lighthouse 12, mobile + desktop, 6 routes: **accessibility 100 everywhere**. Installability: Lighthouse 12 dropped the PWA category, so `pwa.spec.ts` checks the manifest (standalone, start_url, 192/512/maskable icons), the service worker scope and offline start. axe (WCAG 2.2 AA) on 10 screens × 360/1280 px × light/dark: 0 violations (`a11y.spec.ts`).           | **Pass** (install prompt itself: check on Android Chrome once)                                                |
| 8   | Same text twice → no AI call; lexicon hits don't trigger generation; no duplicate lexicon rows | `import-text.spec.ts`: second import of the same text in the same browser makes **0** `ai-extract` calls (local chunk cache); a fresh browser (second device) gets the answer from the server cache: 2 requests, **1 model call in total**, lexicon senses stay at 12 (no duplicates). Lexicon guard: `supabase/functions/_shared/lexicon-guard.test.ts`, `enrich.test.ts`. | **Pass**                                                                                                      |

Also covered: account linking (`account-link.spec.ts`: sync fails after sign-in → error dialog →
"Misafir olarak devam et" signs out and the app keeps working as guest; second-device question
can be left the same way, nothing pushed), settings (`settings.spec.ts`: daily new limit changes
the home "Yeni" count; theme persists across reload), PWA (`pwa.spec.ts`: SW registers, offline
reload of every route; a route chunk that cannot load shows "Bu ekran yüklenemedi" inside the
shell instead of a blank page). No dialog can trap the user: `AccountLinkDialog` (the only one
without a close button) offers "Misafir olarak devam et" in both phases; every other dialog has
Esc/Cancel.

## Performance (criterion 4)

`perf.spec.ts`, production build, run alone (`--workers 1`):

| Data                                     | Restore | Open, warm (home → first card) | Open, cold (page load of /review) | Switch median / p95 / max |
| ---------------------------------------- | ------- | ------------------------------ | --------------------------------- | ------------------------- |
| 1,002 cards, 4,857 logs (1.8 MB backup)  | 5.4 s   | **75 ms**                      | **183 ms**                        | **12.7 / 16.9 / 17.7 ms** |
| 10,002 cards, 47,661 logs (18 MB backup) | 81 s    | **557 ms**                     | **502 ms**                        | **11.4 / 16.4 / 17.5 ms** |

Before the QA fixes, 10,000 cards had card switches of 4–7 s every few cards (the sync status
indicator re-scanned the whole outbox on every write; now only while a sync is active), warm
open was 929 ms and restore 95–119 s. On CI only the 1,000-card size runs (`E2E_PERF_10K=1` adds
10,000).

### Bundle (initial JS)

|        | Eager JS (raw / gzip)                                                       |
| ------ | --------------------------------------------------------------------------- |
| Before | 409 KB gzip (react 362 KB, db 207 KB, radix 146 KB, motion 137 KB raw, app) |
| After  | **1.12 MB / 341 KB**                                                        |

Changes: `package.json` `sideEffects` so the `@/ui` barrel tree-shakes (Radix Slider, Select,
Checkbox, Tabs, Switch now load with their routes); the page transition is CSS (`animate-page-in`,
reduced-motion aware) instead of `motion` (`AnimatePresence mode="wait"` also delayed every
navigation by the exit animation); `/review` and `/stats` are lazy routes, the review chunk is
prefetched when the browser is idle. pdf.js stays lazy; its 1.26 MB worker is no longer precached
but cached on first use (`docs/decisions/0008-pdf-worker-runtime-cache.md`; offline before the
first PDF now shows a clear message instead of hanging).

Still eager: supabase-js (~55 KB gzip, needed at boot to restore the session), Radix Dialog /
DropdownMenu / Toast / Tooltip.

## Lighthouse 12

`vite preview` (no compression, so mobile numbers are pessimistic; Cloudflare Pages serves
brotli). Fresh profile, so `/review` shows the empty state.

| Route     | Mobile perf / a11y / BP / SEO | Mobile LCP / TBT / CLS | Desktop perf / a11y / BP / SEO |
| --------- | ----------------------------- | ---------------------- | ------------------------------ |
| /         | 78 / 100 / 100 / 91           | 4.0 s / 145 ms / 0     | 99 / 100 / 100 / 91            |
| /review   | 77 / 100 / 100 / 91           | 4.2 s / 74 ms / 0      | 99 / 100 / 100 / 91            |
| /add      | 76 / 100 / 100 / 91           | 4.2 s / 129 ms / 0     | 99 / 100 / 100 / 91            |
| /library  | 74 / 100 / 100 / 91           | 4.4 s / 160 ms / 0     | 99 / 100 / 100 / 91            |
| /stats    | 77 / 100 / 100 / 91           | 4.2 s / 160 ms / 0     | 99 / 100 / 100 / 91            |
| /settings | 74 / 100 / 100 / 91           | 4.3 s / 214 ms / 0.012 | 99 / 100 / 100 / 91            |

SEO 91 was only `robots.txt` (the preview served index.html for it); `public/robots.txt` added.
Mobile LCP is dominated by downloading ~1.1 MB of uncompressed JS on simulated slow 4G; with
compression and after the first visit (service worker) it is much lower.

## Visual sweep

`docs/screenshots/q-<screen>-<360|1280>-<light|dark>.png`: home, review front/back, add
(manual/paste/PDF), library, library with a selection, stats, settings — 40 images, realistic
data (seeded backup, real words and meanings). Fixed during the sweep: the library bulk bar
covered rows for keyboard users → `scroll-padding` for the sticky header, bottom tab bar and a
floating bar (`--floating-bar`), tested in `a11y.spec.ts`; the earlier axe `target-size`
findings on the library at 360 px are gone.

## Remaining risks

- Guest outbox grows without bound (every write is queued until a first sign-in; a 10,000-card
  restore queues ~65,000 rows). Harmless for speed now, but it is storage and a long first push.
- Restoring 10,000 cards takes ~80 s (one awaited write per row in the restore path).
- A headless browser denies persistent storage, so the persistent-storage notice shows;
  on a real phone the result depends on the browser.
- At 360 px toasts can cover the lower part of a form for their 5 s.
- Real-device checks still open: airplane mode on a phone, install prompt on Android, review
  speed on a mid-range phone, Gemini latency against the real quota, the 14-day use.
- Not in this report: features merged on `origin/main` after 655f1e1 (source sentence
  translation, Turkish part-of-speech labels, sentence speak button, vocabulary-list extraction,
  Dexie schema v2). After the merge, run `pnpm e2e`; selectors that may need updating are form
  labels in `tests/e2e/support/app.ts` (`addWord`) and the PDF/import texts.

## QA changes (uncommitted, for the merge)

- Tests: `playwright.config.ts`, `tsconfig.e2e.json`, `tests/e2e/**` (10 specs, 21 tests), CI job
  `e2e` in `.github/workflows/ci.yml`, `.gitignore` for Playwright output.
- App: review session end → `requestSync()`; home recent words → `/library?note=<id>`; import
  queue concurrency 3 with backoff; `RouteErrorPage` (chunk-load errors inside the shell);
  sign-out syncs first and warns about unsent changes; `maxLength` from `src/domain/limits.ts` on
  every text input; lazy `/review` and `/stats`; CSS page transition; pdf worker runtime cache
  and its offline error; startup integrity check deferred (idle, daily, not during review);
  `scroll-padding` for sticky bars; `public/robots.txt`.
- Minimal edits in shared areas: `src/sync/status.ts` (outbox scan only while syncing),
  `src/data/maintenance.ts` (restore uses `bulkGet`).
