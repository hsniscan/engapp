# 0075 — v0.5.3 restore epoch, Free-plan database limits and cheap cleanup

## Context

The 2026-11 robustness review (`plan/oneriler-2026-11/teknik-notlar/saglamlik.md`, items 1–3)
found three ways the database could fail quietly:

- **Restore breaks sync without an error (item 1).** A dump restores every sequence at its
  backup-night value, while devices keep cursors at the higher values of the day of the
  failure. New writes then get `server_seq` values that devices have already passed and are
  never pulled; rows a device pushed after the backup were acked and left its outbox, so
  nothing pushes them again. The runbook said "nothing is lost on the devices", which was only
  true for rows that were never acked.
- **One account could fill the Free plan's 500 MB in a day (item 2).** The per-user limits
  (300 MB of pushes and 300,000 rows a day, 100 MB of texts per user) were sized for a paid
  plan. A full Free database goes read-only for every user. The 350 MB warning only showed as
  a warning in a run nobody opens; only the 450 MB `fail` e-mailed.
- **Space that holds nothing useful (item 3).** `cron.job_run_details` was never purged;
  `lexicon_images.checks` keeps up to 8 KB of diagnostics per picture forever; every reader's
  `user_texts` row of a library text holds a copy of the shared body.

## Decision

### 1. Restore epoch (migration `20261106000500_sync_epoch.sql`)

- `public.sync_epoch`: one row, `epoch = 1` until the first restore.
- `public.sync_after_restore()` (service role / owner only) is the one step the runbook runs
  after a restore: it moves `sync_seq`, `lexicon_seq`, `word_bank_seq` and `graded_texts_seq` a
  billion past their restored values (so every new write sorts after every cursor a device may
  hold, for the user tables and the shared content feeds alike) and sets the epoch to the
  restore time in ms (always a new value, also when an older backup is restored again).
- `sync_pull_v5` = `sync_pull_v4` plus `{epoch, seq_head}` (`seq_head` = last value of
  `sync_seq`). It is a wrapper, so v4's body is not copied; the client tries v5 → v4 → v3 → v2.
- Client (`src/sync/engine.ts`): the first page of every pull is checked by
  `restoreDetected()`. A changed epoch, or a cursor above `seq_head` (a restore whose
  after-restore step did not run), starts the existing full resync in **restore mode**
  (`meta.restore_resync_pending`, survives an interrupted run). The first epoch a device sees is
  only stored; a device that never stored one treats any epoch but 1 as a restore when it has
  pulled before.
- Restore mode pulls everything from 0 as before but **deletes nothing locally**. Instead
  `requeueRowsServerLacks()` (`src/data/sync.ts`) queues every local synced row the full pull
  did not return, or returned with a lower HLC (insert-only tables: by id), as it is: same HLC,
  full payload. The push is the usual last-writer-wins / insert-if-new, so repeats from several
  devices are harmless and the newest version wins. This brings back, from every device that
  still has them, the rows acked after the backup — the device's own and those it pulled from
  other devices. Usually this is about a day of rows, well inside the daily limits; a larger gap
  waits in the outbox like any other.
- The runbook text is now true: rows on a device that synced before the failure come back; only
  a row that existed nowhere but on the server between the backup and the failure is lost (for
  example from a device that was itself lost meanwhile).

### 2. Free-plan limits and the database guard (`20261106000510_db_guard.sql`)

Measured on the current schema (PGlite with all migrations, 2,000 rows): a review log is
**~400 B on the wire and ~460 B stored** with its two indexes; a card update ~600 B on the
wire; one answer (log + card) ~1 KB. A heavy learner (300 answers a day) pushes ~300 KB a day.

| Limit | Was | Now | Why |
| --- | --- | --- | --- |
| `push_bytes_per_day` | 300 MB | **20 MB** | ~70× a heavy day; caps one account at ~20–25 MB of new rows a day, so the ~290 MB to the guard take ≥ 12 days and the 350 MB e-mail comes first |
| `push_rows_per_day` | 300,000 | **50,000** | 3 years of Anki history (~60k answers, ~24 MB) arrives in 2 days; the outbox waits |
| `push_calls_per_day` | 20,000 | **5,000** | a normal day is a few hundred calls; stops a runaway loop |
| `texts_per_user` | 2,000 | **300** | library texts no longer count (§3) |
| `text_bytes_per_user` | 100 MB | **5 MB** | 250–1,000 articles; 50 heavy readers stay under 250 MB |
| `db_guard_bytes` | — | **420 MB** | leaves 80 MB for the essentials before the 500 MB wall |

`least()` keeps a value the owner already set lower. Existing texts over the new quota stay;
only new ones wait.

- **Guard.** `db_guard_refresh()` stores `pg_database_size()` in a one-row table every 15
  minutes (pg_cron `engapp-db-guard`) and in the nightly check, so a push never measures the
  database. While the size is above `db_guard_bytes`, BEFORE triggers refuse per row, with
  SQLSTATE `53400` and a `storage_full` message: a new `user_texts` body (insert or body change;
  progress, finishing and deleting still sync) and `review_logs` with `origin = 'anki'`.
  Answers given in the app, cards, notes, senses, settings and everything else keep syncing.
  Content jobs (pictures, library texts) are not blocked by the guard: a failing job mid-batch
  would waste AI spend; they show in `top_tables` and stop being a concern once the owner acts
  on the e-mail. A later change may let the jobs skip their run while `db_guard_active()`.
- **Client.** A per-row `53400` is not the row's fault: the row is *held* (`holdOutboxItems`)
  for 6 hours without counting an attempt (it never becomes "stuck"), and `meta.sync_held`
  records the reason and the waiting rows. Ayarlar → Hesap and the sync indicator say in plain
  Turkish what waits and that reviews keep syncing (`syncPanel.heldStorage`,
  `syncPanel.heldTexts`). A forced "Şimdi eşitle" tries held rows at once.
- **E-mail at 350 MB.** `scripts/ops-health.sh` treats a `warn` of the checks in `ESCALATE`
  (default `db_size`) as a failure, so the nightly run turns red and GitHub e-mails the owner,
  like the 450 MB `fail`. It also prints `ops_storage_health()`: `db_guard` (fail while the
  guard refuses writes), `top_tables` (the ten largest tables, so growth has a name) and
  `cron_history`. `ops_health()` itself is unchanged (another package may change it). The
  runbook's "move to a paid plan" advice is replaced by free steps.

### 3. Cheap cleanup (`20261106000520_db_cleanup.sql`)

- pg_cron `engapp-purge-cron-history` (03:41 UTC) deletes `cron.job_run_details` older than 7
  days; `ops_health` looks at the last day only.
- `purge_image_checks(30, 90)` (pg_cron 03:43 UTC): a picture approved or rejected 30 days ago
  keeps only the scalar facts of `checks` (vision verdict and cost, confidence, attempt,
  problem, replaced_by, the review decision and time; reports such as coverage and contrast
  details go). A picture rejected 90 days ago also drops its SVG (allowed by the table's check;
  nobody sees it and nothing reads it again).
- **Library texts by reference.** A `user_texts` row of kind `graded` with a `graded_id` is
  stored with an empty body (trigger `graded_body_ref`); the client sends `''` too
  (`slimTextPayload`). The device keeps its own plain-text copy (decision 0054):
  `keepGradedBody` never replaces a non-empty local body with the empty server body, and a
  device that pulls such a row and has the library sentences cached rebuilds the body at once,
  locally (no outbox entry); otherwise opening the text fills it as before (`openGradedText`).
  Existing rows are emptied with their HLC unchanged, so no device (older app versions
  included: an equal HLC is skipped) takes the empty body over its own copy. Library rows no
  longer count towards the text quota. Daily stories stay copied: their body exists nowhere
  else.
- Not done here (larger, or need the dashboard): `top_tables` replaces guessing; deleting the
  Supabase `tts` Storage copies (setup step 19.9) is a manual step; archiving old review logs
  needs its own decision.

## Why

- An epoch plus a sequence jump makes the restore path explicit and testable, costs one tiny
  extra function call per pull page, and reuses the full resync that already exists. The
  `seq_head` check catches the restore whose after-restore step was forgotten.
- Re-pushing what the server lacks, instead of deleting it, is the only way the rows acked after
  the backup come back; LWW by HLC makes it safe to do from several devices at once.
- A cached size keeps the guard free on every push. Refusing per row with the existing `53400`
  means no new error path on the server and old clients just keep the rows in their outbox.
- Stripping library bodies on the server and keeping the device copy changes no reader code.

## Consequences

- Deploy order does not matter: an older client ignores `epoch`/`seq_head`; a newer client
  against an older backend falls back to v4 (one extra failed call per pull until the
  migration lands).
- Old app versions after a restore still miss what the backup lost (they have no epoch check)
  until they update; the sequence jump at least makes them pull every new row.
- The tests: pgTAP `75_sync_epoch` (restore simulation on the server) and `75_db_guard`
  (limits, guard, health, cleanup, library reference); Vitest `src/sync/restoreEpoch.test.ts`
  (epoch handling, a restore simulation with three devices, the forgotten after-restore step,
  an interrupted restore resync, held rows, library texts), `scripts/ops-health.test.ts`,
  `src/features/auth/syncHeld.test.tsx`.
