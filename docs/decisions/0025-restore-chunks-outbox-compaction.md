# 0025 — Restore in chunks, outbox compaction

## Context

v0.3 İP9 (plan "İP9 — Bakım", Annex A.10, acceptance criterion 10). Two risks from the v0.1
QA report:

- Restoring a 10,000-card backup took ~80–100 s. `restoreBackup` ran one transaction and
  awaited one `put` per row (notes, senses, cards, ~47,000 review logs), then the outbox got
  ~65,000 entries and the recompute wrote changed cards one by one.
- A guest's outbox grows without bound: nothing is pushed before the first sign-in, every
  write adds an entry (each answer: one log, one card), `adoptGuestData` queues every log a
  second time, and a 10,000-card restore alone adds ~65,000 entries.

## Decision

1. **Restore in chunks with bulk operations.** Each table is restored in transactions of
   `RESTORE_CHUNK` = 500 rows: one `bulkGet` for the local rows, one `bulkPut` for the rows to
   write, their outbox entries in the same transaction (`SyncWriter.putMany`,
   `putManyAsIs`, `insertLogs`, `insertPracticeLogs`, `insertLevelTests`). The overwrite
   tombstones, the duplicate flags and the recompute (`recomputeCardsIn`) write in bulk too.
   The verify step (zod + checksum) is unchanged.
   *Consequence:* a restore is no longer all-or-nothing. A failure leaves the chunks before it
   applied; running the restore again finishes it, because every step is idempotent (restored
   rows compare equal and are kept, known logs are skipped). Tests check that every chunk
   size gives the same result as one big chunk and that a failed chunk is finished by a
   second run. Each chunk is still atomic with its outbox entries (invariant 1).
2. **Compaction keeps the newest entry per row** (`domain/outbox.ts`, `data/outbox.ts`).
   Push already sends only the newest entry of a `(table, row_id)` and an ack deletes the
   entries up to it, so older entries carry nothing. The kept entry takes over the group's
   highest `attempts` and `next_attempt_at`, which is exactly what `takeOutboxItems` reports
   for the group, so push behaves the same. It is safe at any time, also while a push is in
   flight (an ack never deletes entries above the one it sent). Within a row the newest entry
   has the highest HLC: local writes stamp increasing HLCs, and a restore writes a row as-is
   only when it is missing locally or newer.
3. **Guests: no outbox entries for logs.** On a device never linked to an account
   (`meta.user_id` null) nothing has been pushed, and the first sign-in (`adoptGuestData`)
   queues every review log, practice log, level test and weekly report (İP7) from the tables. Their guest entries
   are therefore redundant: guest compaction drops them, and a guest restore does not queue
   restored logs at all. Mutable rows keep one entry each (a restored row may carry another
   user id and is then pushed from its guest entry, as before).
4. **When compaction runs:** at the end of every restore (guest rules while a guest),
   at the end of `adoptGuestData` (before the first push), and with the daily startup
   integrity check (`features/settings/integrity.ts`).

No Dexie version or migration: no schema change.

## Measurements

`tests/e2e/restore-perf.spec.ts`: the realistic seed of `perf.spec.ts` (10,002 cards, ~48,000
review logs, 18 MB) restored as a guest through the UI, production build, headless Chromium in
the agent sandbox (4 cores shared with other agents, load 3–20), same conditions per pair:

| Build | Restore 10,000 cards | Outbox afterwards |
| --- | --- | --- |
| v0.2 (`main`) | 95–175 s (98–108 s at load 4–5) | ~64,700 entries (~48,000 of them logs) |
| İP9 | 56–65 s (56–58 s at load 4–5) | 16,671 entries, no logs, no duplicates |

In this sandbox the time is IndexedDB-bound: the main thread is idle most of the restore, and
a bare IndexedDB benchmark that only inserts the ~48,000 log rows takes 14–33 s here. What is
left is the writes themselves (~64,000 rows + ~17,000 outbox entries). Chrome on a phone or
laptop writes IndexedDB several times faster, so the < 15 s target has to be confirmed on a
real device; the spec asserts a generous bound (90 s, `E2E_RESTORE_MAX_MS`) and prints the
time.

The restore runs on Ayarlar → Veri, and every chunk commit re-runs the page's live queries.
After the v0.3 merge three of them scan whole tables (Tekrar yükü forecast, the FSRS retention
helper and optimizer review count) and made the same restore ~105 s instead of ~63 s here.
They now pause while a restore runs (`data/restoreState.ts`,
`features/settings/usePausedLiveQuery.ts`) and run once at the end: ~61 s again.

## Why

- Fewer, larger requests are what IndexedDB is fast at; per-row awaits in one huge
  transaction also kept ~130,000 pending writes for a single commit.
- Chunks bound memory and transaction size and keep the UI responsive between commits; the
  loss of atomicity is acceptable because a re-run completes the restore and nothing is ever
  lost (logs are insert-only, mutable rows last-writer-wins).
- Keeping the newest entry is the rule push already applies, so compaction cannot change
  what reaches the server; property tests (`src/sync/outboxCompaction.test.ts`) sync random
  guest histories with and without compaction and require identical server and device state.
