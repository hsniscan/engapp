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
* Hosting: static build on Cloudflare Pages (see `docs/decisions/0001`).
