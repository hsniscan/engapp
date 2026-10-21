# Data model (v0.1)

The device's IndexedDB (Dexie, `src/data/db.ts`) is the source of truth. Business rules are
pure functions in `src/domain/`; `src/data/` wraps them in Dexie transactions. Screens import
only from `@/data` (`src/data/index.ts`).

## Tables

| Table | Synced | Key / indexes | Notes |
| --- | --- | --- | --- |
| notes | yes | `id`, `term_norm`, `lexicon_term_id`, `updated_at`, `deleted_at`, `*tags` | One live note per `term_norm` (enforced in actions, not by a unique index, so account merges can keep duplicates flagged `possible_duplicate`). |
| senses | yes | `id`, `note_id`, `[note_id+lexicon_sense_id]`, `lexicon_sense_id`, `deleted_at` | `sense_no` is the display order. `meaning_tr_override` beats `meaning_tr`. `span` is `[start, end)` in `source_sentence`. |
| cards | yes | `id`, `note_id`, `sense_id`, `[state+due]`, `due`, `card_type`, `deleted_at` | FSRS fields in UTC ms. `unlocked`, `suspended`. |
| review_logs | yes, insert-only | `id`, `card_id`, `reviewed_at`, `undo_of` | Never updated or deleted. An undo is a new row with `undo_of`. |
| sources | metadata | `id`, `created_at` | |
| settings | yes | `id = 'settings'` | Defaults: `daily_new_limit 10`, `request_retention 0.9`, `timezone` from the device, `day_start_hour 4`, `theme 'system'`, `voice 'en-US'`, `level 'B1'`. |
| outbox | no | `++seq`, `[table+row_id]`, `next_attempt_at` | Rows waiting to be pushed. |
| daily_activity | no (derived) | `date` (local `YYYY-MM-DD`) | `reviews`, `new_cards`, `time_ms`, `review_answers`, `review_passed`, `completed`. |
| meta | no | `key` | `device_id`, `user_id`, `hlc`, `sync_cursor`, `lexicon_cursor`. |
| error_log | no | `++id`, `at` | Newest 200 rows are kept. |
| lexicon_cache, chunk_cache, import_jobs, import_candidates | no | | Owned by the AI and sync layers. |

Every synced mutable row has `id` (UUID v7), `user_id` (null in guest mode), `created_at`,
`updated_at`, `deleted_at` and `hlc`.

## Invariants

1. **Outbox in the same transaction.** Every write to a synced table goes through
   `writeTx` / `SyncWriter` (`src/data/writer.ts`). The writer stamps `updated_at` and a fresh
   HLC, then adds an outbox row (`op: 'upsert'`, or `'delete'` when `deleted_at` is set;
   `payload` is the full row). Outbox rows are append-only on our side. The sync engine
   deletes a row only after the server acknowledges it.
2. **Soft delete only.** Deleting a note soft-deletes its senses and cards. Deleting a sense
   soft-deletes its cards. Tombstones sync like any other change.
3. **Logs are the truth for scheduling.** A card's FSRS state must equal
   `replayCard(logs)`: drop undo rows and the rows they cancel, dedupe by id, sort by
   `(reviewed_at, id)` and replay from an empty card created at `created_at`. The fuzz
   seed is `card id | review time | reps`, so replays match on every device.
   `recomputeAllCards` and `repairIntegrity` restore this invariant.
4. **Unlock rule.** Recognition cards are always unlocked. A production or cloze card
   is unlocked when the note's recognition card is in Review or Relearning, or when the
   card has its own history (`deriveUnlocked`). This rule is re-derived after answers,
   undo, sync and restore.
5. **Card set per note.** Each live note has 1 recognition card. Each live sense has 1
   production card, plus 1 cloze card only when it has `source_sentence` and a valid
   `span`.
6. **HLC.** The format is `"<ms:15>:<counter:5>:<device_id>"`, and the strings compare
   lexicographically. The clock is stored in `meta.hlc` and advanced inside each write
   transaction. Remote and restored stamps are merged with `receive`, so the next local
   edit always orders after them, even when the local clock is wrong.
7. **Local day.** A day runs from `day_start_hour` to the same hour the next day in
   `settings.timezone`, so 03:59 counts as the previous day. Day keys are calendar strings
   and do not shift across DST changes.
8. **daily_activity is a cache.**
   - `answerCard` updates it incrementally. `undoAnswer` recounts that day.
   - Sync and restore rebuild it from logs.
   - `completed` means that no unsuspended, unlocked, studied card was left due before the
     day ended. New cards do not count, and buried siblings are excused.

## Queue rules (`domain/queue.ts`)

The queue is built in this order:
1. Due (re)learning steps.
2. Reviews due before the end of the day, oldest due first.
3. New cards, by `created_at`. One new card follows every 5 reviews; this rhythm is kept
   across rebuilds through the session counts.

Rules:
- New cards are limited to `daily_new_limit` minus the cards first answered today.
- Only one card per note is shown per day. If a note had any card answered today, its
  other cards are buried until tomorrow.
- Suspended, deleted and locked cards are excluded.
- When nothing else is left, learning cards due within 20 minutes are shown early. Rebuild
  the queue after every answer.

## Actions API (`@/data`)

All actions take an optional trailing `now` (ms) for tests. They throw `ActionError` with a
`code` of `not_found`, `deleted`, `duplicate_term`, `invalid_input`, `already_undone`,
`not_undoable` or `invalid_backup`.

| Function | Purpose |
| --- | --- |
| `addNoteWithSenses(input)` | Adds a note, or new senses to the live note with the same `term_norm`. A soft-deleted note is reactivated. Senses that match by `lexicon_sense_id` or by normalized meaning are skipped. Cards are created per invariant 5. |
| `editNote(id, patch)` / `editSense(id, patch)` | Edit a note or sense. A rename checks for duplicates. Sentence and span changes create, revive or delete the cloze card. |
| `setSuspended({card_ids} \| {note_id}, bool)` | Suspend or unsuspend cards. |
| `softDeleteNote(id)` / `softDeleteSense(id)` | Soft-delete with the cascade from invariant 2. |
| `createSource(input)` | Saves import source metadata. |
| `answerCard({card_id, rating, duration_ms, shown_sense_id})` | Writes the log, updates the card, unlocks siblings and updates `daily_activity`. All of this is one transaction. |
| `getLastUndoableAnswer()` / `undoAnswer(logId)` | Undo adds a row, recomputes the card, re-locks siblings and recounts the day. |
| `getStudyQueue({session, learnAheadMs})` | Returns the ordered items, each with its card, plus counts, `nextLearningDue` and today's totals. |
| `getCardView(cardId)` | Returns the note, senses, the sense to show, cloze/hint and the 4 interval previews. |
| `getHomeSummary()` / `getStreakSummary()` / `getHeatmap()` | Feed the home line, the stats metrics and the 26-week heatmap. |
| `getNoteDetail`, `findNoteByTerm`, `listNotes`, `listSources`, `pendingChangesCount` | Read helpers. |
| `getSettings` / `ensureSettings` / `updateSettings(patch)` | Settings. `updateSettings` validates with zod and with ts-fsrs. Call `ensureSettings()` at startup. |
| `exportBackup()` → `BackupFile` | Builds the backup and records `last_backup_at`. |
| `restoreBackup(fileOrJson, 'merge' \| 'overwrite')` | Verifies the zod schema and checksum, restores, then recomputes all cards and `daily_activity`. |
| `exportCsv(headers)` | CSV export. |
| `runIntegrityCheck()` / `repairIntegrity()` | Startup check and the "Veri onarımı" repair. |
| `applyRemoteRows(batch)` | Sync pull hook. Mutable rows use last-writer-wins by HLC; logs are inserted if new. Pulled rows are not queued. Touched cards are recomputed (and queued if changed), duplicates are flagged, and `daily_activity` is rebuilt when logs arrive. |
| `adoptGuestData(userId)` | Moves guest data to an account: sets `meta.user_id`, stamps guest rows and queues everything, including logs. |
| `rebuildDailyActivity()`, `recomputeAllCards()` | Maintenance. |
| `logError`, `listErrors`, `clearErrors` | Error log. |

### Restore semantics

- **merge**: Rows missing locally are inserted exactly as stored in the file. For rows on
  both sides, the greater HLC wins. Notes with the same term are flagged
  `possible_duplicate`.
- **overwrite**: The backup's mutable rows replace the local ones and are restamped. Live
  local rows that are absent from the file are soft-deleted.
- **Both modes**: Logs are insert-only, so missing logs are added and none are removed.

Restoring into an empty database and exporting again gives identical tables and checksum.
A property test checks this.
