# Data model (v0.2)

The device's IndexedDB (Dexie, `src/data/db.ts`) is the source of truth. Business rules are
pure functions in `src/domain/`; `src/data/` wraps them in Dexie transactions. Screens import
only from `@/data` (`src/data/index.ts`).

## Tables

| Table | Synced | Key / indexes | Notes |
| --- | --- | --- | --- |
| notes | yes | `id`, `term_norm`, `lexicon_term_id`, `updated_at`, `deleted_at`, `*tags` | One live note per `term_norm` (enforced in actions, not by a unique index, so account merges can keep duplicates flagged `possible_duplicate`). `level_override` (A1–C2 or null) is the user's own level for the word; null = the computed one (Dexie v4 filled null on old rows). |
| senses | yes | `id`, `note_id`, `[note_id+lexicon_sense_id]`, `lexicon_sense_id`, `deleted_at` | `sense_no` is the display order. `meaning_tr_override` beats `meaning_tr`. `span` is `[start, end)` in `source_sentence`. `source_sentence_tr` is the user's Turkish translation of that sentence (AI or typed; null when none, dropped with its sentence; never in the shared lexicon; Dexie v2 filled null on old rows). |
| cards | yes | `id`, `note_id`, `sense_id`, `[state+due]`, `due`, `card_type`, `deleted_at` | FSRS fields in UTC ms. `unlocked`, `suspended`. |
| review_logs | yes, insert-only | `id`, `card_id`, `reviewed_at`, `undo_of` | Never updated or deleted. An undo is a new row with `undo_of`. |
| practice_logs | yes, insert-only | `id`, `card_id`, `practiced_at`, `session_id` | One row per answer in a practice round: `result` (`known`/`unknown`), `mode` (the source: `hard`, `recent`, `tag`; free text, 1–32 chars), `session_id`, `duration_ms` (≤ 60 s), `device_id`. Never read by scheduling, `daily_activity` or the streak (Dexie v3, decision 0010). |
| sources | metadata | `id`, `created_at` | |
| settings | yes | `id = 'settings'` | Defaults: `daily_new_limit 10`, `request_retention 0.9`, `timezone` from the device, `day_start_hour 4`, `theme 'system'`, `voice 'en-US'`, `level 'B1'`, `show_easy_candidates false` (v0.2 İP4: open the import preview's "Kolay" section; absent or null = false, so older rows and backups need no change). |
| outbox | no | `++seq`, `[table+row_id]`, `next_attempt_at` | Rows waiting to be pushed. |
| daily_activity | no (derived) | `date` (local `YYYY-MM-DD`) | `reviews`, `new_cards`, `time_ms`, `review_answers`, `review_passed`, `completed`. |
| meta | no | `key` | `device_id`, `user_id`, `hlc`, `sync_cursor`, `lexicon_cursor`, `server_practice_logs` (the server answered with `sync_pull_v3`), `extra_new:<YYYY-MM-DD>` (extra new cards allowed that day, this device only). |
| error_log | no | `++id`, `at` | Newest 200 rows are kept. |
| lexicon_cache | no | `id`, `term_id`, `lemma_norm`, `updated_at` | Shared lexicon senses the user's senses reference (sync layer). Since Dexie v4 also `cefr`, `cefr_source`, `cefr_list`, `cefr_reason_tr`, `zipf` (word level, see "Word levels"); the v4 upgrade set `lexicon_cursor` back to 0 so they are pulled again with levels. |
| chunk_cache, import_jobs, import_candidates | no | | Owned by the AI layer. Since Dexie v10 (v0.2 İP4, smart extraction) a candidate also has `cefr` / `cefr_source` (its sense's level), `bucket` (`for_you` / `easy` / `known` / `too_hard`; null until the job's last chunk is in), `from_list` (from a vocabulary-list chunk) and `rank` (display order); the v10 upgrade put rows of older jobs in `known` ("zaten var") or `for_you` with their selection unchanged. Decision 0018. |

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

`getStudyQueue({ mode })` has two modes. `normal` is today's session. `ahead` ("Yarının
kartlarını şimdi tekrar et") takes Review-state cards due before the end of tomorrow's local
day. Learning steps keep their normal timing, and no new cards are added. Sibling burial still applies, and answers are
ordinary `answerCard` calls.

The queue is built in this order:
1. Due (re)learning steps.
2. Reviews due before the end of the day, oldest due first.
3. New cards, by `created_at`. One new card follows every 5 reviews; this rhythm is kept
   across rebuilds through the session counts.

Rules:
- New cards are limited to `daily_new_limit + extra_new:<today>` minus the cards first
  answered today (`newCardsAllowed`). The extra allowance is per device; the cards answered
  today come from the logs, so nothing is counted twice across devices.
- Only one card per note is shown per day. If a note had any card answered today, its
  other cards are buried until tomorrow.
- Suspended, deleted and locked cards are excluded.
- When nothing else is left, learning cards due within 20 minutes are shown early. Rebuild
  the queue after every answer.

## Practice rounds (`domain/practice.ts`)

Practice is not a queue mode, and it never changes a card. `getPracticeCards(filter)` takes
live, unsuspended, unlocked cards with at least one review that still counts:

- `hard`: `lapses ≥ 2`, `difficulty ≥ 7`, or an Again (review) or "Bilemedim" (practice) in
  the last 14 days. Most recent miss first, then lapses and difficulty.
- `recent`: first review within the last 7 days.
- `tag`: notes with that tag.

Each round has one card per note and 10 or 20 cards, shuffled with the session id as seed
(except `hard`). A card answered `unknown` the first time comes back once at the end.
`recordPractice` writes a `practice_logs` row and nothing else. A property test checks that
cards, review logs, `daily_activity`, the streak and the queue are unchanged.

## Actions API (`@/data`)

All actions take an optional trailing `now` (ms) for tests. They throw `ActionError` with a
`code` of `not_found`, `deleted`, `duplicate_term`, `invalid_input`, `already_undone`,
`not_undoable` or `invalid_backup`.

| Function | Purpose |
| --- | --- |
| `addNoteWithSenses(input)` | Adds a note, or new senses to the live note with the same `term_norm`. A soft-deleted note is reactivated. Senses that match a live sense by `lexicon_sense_id`, by normalized meaning, or by the same part of speech and an overlapping Turkish meaning (`davet` ~ `davetiye, davet`) are skipped; with `one_sense_per_sentence` (imports) so is a sense whose sentence a live sense already has. Cards are created per invariant 5. |
| `repairDuplicateSenses()` | One-off idle repair (`src/data/repairs.ts`): within a note, a duplicate sense (same pos and overlapping meaning, or two lexicon senses with the same sentence) whose cards have no effective review history is soft-deleted with its cards; the kept sense takes a richer meaning as `meaning_tr_override`. Studied senses are never deleted. `sense_no` is only a sort order and is not renumbered. |
| `editNote(id, patch)` / `editSense(id, patch)` | Edit a note or sense. A rename checks for duplicates. Sentence and span changes create, revive or delete the cloze card. |
| `setSuspended({card_ids} \| {note_id}, bool)` | Suspend or unsuspend cards. |
| `setLevelOverride(noteId, level \| null)` | The user's own level for a word (null = computed). Synced like any note edit; only this user sees it. |
| `softDeleteNote(id)` / `softDeleteSense(id)` | Soft-delete with the cascade from invariant 2. |
| `createSource(input)` | Saves import source metadata. |
| `answerCard({card_id, rating, duration_ms, shown_sense_id})` | Writes the log, updates the card, unlocks siblings and updates `daily_activity`. All of this is one transaction. |
| `getLastUndoableAnswer()` / `undoAnswer(logId)` | Undo adds a row, recomputes the card, re-locks siblings and recounts the day. |
| `getStudyQueue({session, learnAheadMs, mode})` | Returns the ordered items, each with its card, plus counts, `nextLearningDue`, today's totals, `extraNewToday` and `dayEnd`. |
| `addExtraNew(n)` / `getExtraNewToday()` | "Biraz daha çalış → +n yeni kart": raises today's new-card allowance on this device (1–100). |
| `getMoreStudyOverview()` | The `/more` page: due now, daily limit, extra today, new cards waiting, tomorrow's count and practice source counts. |
| `getPracticeSourceCounts()` / `getPracticeCards(filter, {size, seed})` | Practice selection (see "Practice rounds"). |
| `recordPractice({card_id, result, mode, session_id, duration_ms})` | One practice answer → one `practice_logs` row. |
| `getCardView(cardId)` | Returns the note, senses, the sense to show, cloze/hint, the 4 interval previews and the cached lexicon rows of the senses (their levels). |
| `getHomeSummary()` / `getStreakSummary()` / `getHeatmap()` | Feed the home line, the stats metrics and the 26-week heatmap. |
| `getNoteDetail`, `findNoteByTerm`, `listNotes`, `listSources`, `pendingChangesCount` | Read helpers. |
| `getSettings` / `ensureSettings` / `updateSettings(patch)` | Settings. `updateSettings` validates with zod and with ts-fsrs. Call `ensureSettings()` at startup. |
| `exportBackup()` → `BackupFile` | Builds the backup (`schema_version` 4: `practice_logs` since 3, `notes.level_override` since 4; version 1–3 files still restore, the override as null) and records `last_backup_at`. |
| `restoreBackup(fileOrJson, 'merge' \| 'overwrite')` | Verifies the zod schema and checksum, restores, then recomputes all cards and `daily_activity`. |
| `exportCsv(headers)` | CSV export. |
| `runIntegrityCheck()` / `repairIntegrity()` | Startup check and the "Veri onarımı" repair. |
| `applyRemoteRows(batch)` | Sync pull hook. Mutable rows use last-writer-wins by HLC; logs are inserted if new. Pulled rows are not queued. Touched cards are recomputed (and queued if changed), duplicates are flagged, and `daily_activity` is rebuilt when logs arrive. |
| `adoptGuestData(userId)` | Moves guest data to an account: sets `meta.user_id`, stamps guest rows and queues everything, including logs. |
| `copyCardsFromOtherAccount(userId, snapshot)` | Another account's data on this device: copies its live notes, senses and referenced sources into `userId` as new rows (new ids, cards New), applies the account's snapshot and drops the other account's rows, logs, settings and import jobs locally. No history crosses accounts (decision 0008). |
| `resetStudyHistory()` | "Çalışma geçmişini sıfırla": an undo row for every answer that still counts, all cards recomputed (New, re-locked), `daily_activity` rebuilt. Syncs as ordinary log and card rows. |
| `rebuildDailyActivity()`, `recomputeAllCards()` | Maintenance. |
| `logError`, `listErrors`, `clearErrors` | Error log. |

### Restore semantics

- **merge**: Rows missing locally are inserted exactly as stored in the file. For rows on
  both sides, the greater HLC wins. Notes with the same term are flagged
  `possible_duplicate`.
- **overwrite**: The backup's mutable rows replace the local ones and are restamped. Live
  local rows that are absent from the file are soft-deleted.
- **Both modes**: Logs (review and practice) are insert-only, so missing logs are added and
  none are removed.

Restoring into an empty database and exporting again gives identical tables and checksum.
A property test checks this.

## Word levels (`domain/level.ts`)

A word's level (A1–C2) shown on cards and in the library comes from, best first:

1. `notes.level_override`, the user's own level (synced, this user only);
2. the level stored with the shared lexicon sense (`lexicon_cache.cefr`, resolved on the
   server with the AI guess and the Turkish-learner correction: docs/ai-pipeline.md);
3. the same rule (`resolveLevel`, shared with the server) on the client level file
   `data/levels/client-levels.tsv` (word lists and frequency, ~30 500 lemmas): guests,
   offline, senses added by hand, senses the server has not rated yet.

A note's level is that of its first sense with a level (the meaning the word was added
for); a production or cloze card shows its own sense's level. The client file is a hashed
build asset fetched the first time a screen needs levels (`src/data/levelData.ts`) and kept
by the service worker (CacheFirst, decision 0012); until it has loaded, only stored levels
show.

