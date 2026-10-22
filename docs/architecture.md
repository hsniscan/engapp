# Architecture

```
 ┌──────────────── Device (browser / PWA) ────────────────┐        ┌──────── Supabase ────────┐
 │  React screens ──read/write──▶ Dexie (IndexedDB)        │        │ Auth (Google)            │
 │        ▲ live queries               │  outbox            │ push   │ Postgres + RLS           │
 │        └──────────────── sync engine ┼──────────────────▶│──────▶ │  user tables, server_seq │
 │                                      │◀──────────────────│◀────── │  lexicon (shared)        │
 │  AI client ── import jobs ───────────┼──────────────────▶│ edge   │ ai-extract / ai-enrich ──┼──▶ Gemini
 │  pdf.js worker, chunking, hashing    │                   │ funcs  │ chunk cache, ai_usage    │
 └──────────────────────────────────────────────────────────┘        └──────────────────────────┘
```

* The local database is the source of truth for the UI. Screens never await the
  network; the sync engine and AI client run in the background and write results
  into Dexie, and screens update through `useLiveQuery`.
* `src/domain/` holds pure logic (FSRS wrapper, queue, recompute, streaks, HLC,
  chunking, backup schema) and is tested without a browser.
* `src/data/` holds Dexie repositories and transactional actions. Every change
  to a synced table writes its outbox row in the same transaction.
* The server stores user rows for backup and cross-device sync and keeps the
  Gemini key. The shared lexicon stores each word sense once for all users.
* Word levels (A1–C2) come from one pure rule (`supabase/functions/_shared/level.ts`,
  re-exported by `src/domain/level.ts`) over licensed reference data (`data/levels/`,
  docs/licenses.md). Edge functions store a level with each new lexicon sense, a nightly
  GitHub Actions job (`scripts/system-jobs.ts`) fills and checks the rest on a system AI
  budget, and the client falls back to a cached level file (decision 0012).
* Reminders (v0.3): Web Push. pg_cron calls the `push-send` edge function every 15 minutes;
  it applies one pure rule (`supabase/functions/_shared/push-rule.ts`, re-exported by
  `src/domain/notify.ts`) to the synced settings, review logs and cards and sends at most one
  notification per user-day. The service worker shows it (`public/push-sw.js`). Decision 0024.
* Weekly report (v0.3): computed on the device after the Monday day start
  (`src/domain/weeklyReport.ts`, `src/data/weeklyReport.ts`, runner
  `src/features/report/queue.ts`). The `ai-report` function receives only the numbers and
  names from fixed lists, and writes a 3–4 sentence Turkish comment whose numbers are checked
  on the server and again on the device (docs/ai-report.md). Reports sync as insert-only rows,
  one per week. Decision 0027.
* Android app (v0.4): Capacitor 8 wraps the same `dist/` build (`android/`,
  `capacitor.config.ts`), served from `https://localhost`. `src/native/` is loaded with
  `import()` only when `isNativeApp()` is true, so the web bundle carries no Capacitor code.
  Native Google sign-in (Credential Manager → `signInWithIdToken`), device TextToSpeech as the
  read-aloud fallback, back-button handling, and local-notification reminders planned on the
  phone by `src/domain/reminderSchedule.ts` from the same push rule (per-device switch; Web Push
  is removed for the account when it is on). CI: `.github/workflows/android.yml`; setup:
  `docs/setup-android.md`. Decision 0033.
* Paylaş → Engapp (v0.4): `/share?text&title&url` is opened by the Android `ACTION_SEND`
  intent (`ShareTargetPlugin`) and by the PWA's Web Share Target; `src/features/share/route.ts`
  sends a short term to `/add`, a passage to a text import job, and a link to a title preview.
  Decision 0034.
* Hosting: static build on Cloudflare Pages (see `docs/decisions/0001`).
