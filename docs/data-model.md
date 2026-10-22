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
| review_logs | yes, insert-only | `id`, `card_id`, `reviewed_at`, `undo_of` | Never updated or deleted. An undo is a new row with `undo_of`. `origin` (v0.3 İP1): `anki` for answers imported from an Anki revlog; absent/null = `app` (not indexed, Dexie v12 fills nothing). Imported answers are never offered for undo. |
| practice_logs | yes, insert-only | `id`, `card_id`, `practiced_at`, `session_id` | One row per answer in a practice round: `result` (`known`/`unknown`), `mode` (the source: `hard`, `recent`, `tag`; free text, 1–32 chars), `session_id`, `duration_ms` (≤ 60 s), `device_id`. Never read by scheduling, `daily_activity` or the streak (Dexie v3, decision 0010). |
| decks | yes | `id`, `sort`, `deleted_at` | Smart decks (Dexie v8, ADR 0016): `name` (1–60 chars on the client), `filter` (versioned JSON, see "Smart decks"), `sort` (1..n). The deck is a saved filter: no note ids are stored, membership is computed on the device. |
| theme_previews | no | `id` (`'current'`) | The pending "Kelimelerimi temalara ayır" preview: AI groups with the user's edits (`name`, `removed`, `rejected`) until approved or discarded. Local only; cleared with the account's data. |
| level_tests | yes, insert-only | `id`, `taken_at` | One finished level test: `result_level`, `vocab_estimate`, `reliable`, `false_alarm_rate`, `ratios` (corrected share known per level), `items` (`{w, band, pseudo, answer, mc_ok?}`), `bank_version`, `applied` (false: unreliable and not used), `duration_ms`, `device_id` (Dexie v9, decision 0017). |
| weekly_reports | yes, insert-only | `id`, `week` | One weekly report per week (v0.3 İP7, Dexie v20, decision 0027). `week` is the Monday of the week as a local day key. `summary` holds the numbers computed on the device (`v`, `week_end`, `active_days`, `reviews`, `minutes`, `new_cards`, `new_learned`, `retention {n, passed}`, `groups_days` 7/28, `strongest`/`weakest` `{dimension, key, n, passed}`, `streak`, `goals`, `focus`, `focus_note_ids`, `focus_value`). `comment` is the ai-report text or null, with `comment_model`, `prompt_version` and `device_id`. The server keeps the first row of a week. |
| report_drafts | no | `week` | A report waiting for its AI comment: `report` (the future `weekly_reports` row), `attempts`, `next_attempt_at`, `last_error`. Local only and cleared with the account's data. |
| known_terms | yes | `id`, `term_norm`, `deleted_at` | Words the user knows without a card: `term_norm` (same key as `notes.term_norm`), `source` (`test`/`preview`/`manual`/`auto`), `cefr_at_mark`. One live row per `term_norm`; removing is a tombstone, marking again revives the row. |
| sources | metadata | `id`, `created_at`, `*topics` | `kind`: `text`, `pdf` or (v0.3 İP1) `anki` (one row per imported file name, reused on a re-import; Dexie v12 re-pulls sources once). `topics`: topic keys of the text (`domain/topics.ts`, from the extract call; absent/null = unknown, `[]` = none; Dexie v7, decision 0015). |
| settings | yes | `id = 'settings'` | Defaults: `daily_new_limit 10`, `request_retention 0.9`, `timezone` from the device, `day_start_hour 4`, `theme 'system'`, `voice 'en-US'`, `level 'B1'`. `interests` (picked topic keys; absent/null = never asked, `[]` = asked) and `muted_topics` (weight 0). Topic weights are computed on the device (`domain/profile.ts`), never stored (decision 0015). Level (decision 0017): `level_source` (`default`/`test`/`auto`/`manual`), `level_updated_at`, `level_locked`, `level_change` (the last automatic change and its reason, with `dismissed`). Dexie v9 set `level_source` to `manual` when the level was not B1. `show_easy_candidates` (default false; v0.2 İP4: open the import preview's "Kolay" section; absent or null = false, so older rows and backups need no change). v0.3 İP3 (decision 0021, all optional, absent = default): `daily_capacity_min` (20), `catchup_auto` (true), `vacation` (`{start, end}` local day keys, both included; null = none) and `vacation_history` (earlier vacations, for the streak). Personal FSRS parameters (v0.3 İP4, decision 0022): `fsrs_params` (21 FSRS-6 weights; null = ts-fsrs defaults), `fsrs_params_prev` (the params before the last adoption, for "Eski ayara dön"; null = defaults / nothing to revert) and `fsrs_opt_at` (epoch ms of the last check, adopted or not; drives the monthly offer); the last two are optional (absent = null) and Dexie v15 re-pulls settings once for them. A change of `fsrs_params` (here or pulled) replays every card from its logs. `goals` (v0.3 İP7, decision 0027; optional, absent or null = none): `{week_active_days?, week_minutes?, month_new_terms?}`. Dexie v20 re-pulls settings once for it. `show_image_front` (v0.4 İP3, decision 0031; optional, absent or null = off): also show the sense's picture on card fronts. Dexie v21 re-pulls settings once for it. |
| outbox | no | `++seq`, `[table+row_id]`, `next_attempt_at` | Rows waiting to be pushed. |
| daily_activity | no (derived) | `date` (local `YYYY-MM-DD`) | `reviews`, `new_cards`, `time_ms`, `review_answers`, `review_passed`, `completed`. |
| meta | no | `key` | `device_id`, `user_id`, `hlc`, `sync_cursor`, `lexicon_cursor`, `lexicon_examples_cursor`, `server_practice_logs` (the server answered with `sync_pull_v3`), `server_examples`, `extra_new:<YYYY-MM-DD>` (extra new cards allowed that day, this device only), `family_dismissed_morphemes` (root/affix card suggestions the user closed), `server_tables` / `server_tables_checked_at` (late sync tables the server registry confirmed; when it was last asked), `pull_backfill` (tables to re-pull once, see sync-strategy.md; Dexie v11 adds notes, settings and sources on updated devices for the columns v0.1/İP1 stripped), `level_week:<user or guest>` (the week the weekly level update last ran), `level_test_offer_dismissed`, `load_warning_dismissed` (the day the home load warning was hidden; it stays hidden 7 days, decision 0021), `report_seen:<user or guest>` (the week whose report the user opened or whose home note they closed, decision 0027). |
| error_log | no | `++id`, `at` | Newest 200 rows are kept. |
| lexicon_cache | no | `id`, `term_id`, `lemma_norm`, `updated_at` | Shared lexicon senses the user's senses reference (sync layer). Since Dexie v4 also `cefr`, `cefr_source`, `cefr_list`, `cefr_reason_tr`, `zipf` (word level, see "Word levels"); the v4 upgrade set `lexicon_cursor` back to 0 so they are pulled again with levels. |
| chunk_cache, import_jobs, import_candidates | no | | Owned by the AI layer. Since Dexie v10 (v0.2 İP4, smart extraction) a candidate also has `cefr` / `cefr_source` (its sense's level), `bucket` (`for_you` / `easy` / `known` / `too_hard`; null until the job's last chunk is in), `from_list` (from a vocabulary-list chunk) and `rank` (display order); the v10 upgrade put rows of older jobs in `known` ("zaten var") or `for_you` with their selection unchanged. Decision 0018. |
| anki_imports | no | `id` (= the import's source id), `created_at` | v0.3 İP1 (Dexie v12, decision 0019): one Anki import's counts, the note ids it created and the "Sözlükle eşleştir" queue (`enrich`: status, pending note ids, matched / term-only / unmatched, `paused_until`). Local only; cleared with the account's data. |
| ref_cache | no | `key` | Static reference files fetched lazily, with their checksum. Currently `morphology`: word families, roots and affixes (decision 0014). Device-level: kept when switching or copying accounts (Dexie v6). |
| images | no (read-only cache) | `id`, `sense_id`, `fetched_at` | v0.4 İP3 (Dexie v21, decision 0031): copies of `public.lexicon_images` rows the user may see (`approved`, and `review` rows of senses in their cards): `sense_id` (a **lexicon** sense id), `variant`, `svg` (stored light palette, sanitized again before it is shown), `alt_tr`, `status`, `created_at`, plus `fetched_at`. Capped at ~20 MB. Kept when switching or copying accounts; not in backups. |

Every synced mutable row has `id` (UUID v7), `user_id` (null in guest mode), `created_at`,
`updated_at`, `deleted_at` and `hlc`.

## Invariants

1. **Outbox in the same transaction.** Every write to a synced table goes through
   `writeTx` / `SyncWriter` (`src/data/writer.ts`). The writer stamps `updated_at` and a fresh
   HLC, then adds an outbox row (`op: 'upsert'`, or `'delete'` when `deleted_at` is set;
   `payload` is the full row). The sync engine deletes a row only after the server
   acknowledges it. The only other removal is compaction (decision 0025,
   `src/data/outbox.ts`): entries covered by a newer entry of the same row are dropped (push
   sends only the newest one anyway), and on a never-linked guest device log entries are
   dropped too, because the first sign-in queues every log again.
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
   undo, sync and restore. When a note has more than one recognition card (a split or a
   reset, v0.3 İP6), the rule follows its primary one (`primaryRecognition`: live,
   note-level and not suspended first; decision 0026).
5. **Card set per note.** Each live note has 1 recognition card. Each live sense has 1
   production card, plus 1 cloze card only when it has `source_sentence` and a valid
   `span`. A root/affix note (`term_type = 'affix'`, e.g. "-spect-") has only its recognition
   card (decision 0014), and so has a contrast note (`term_type = 'contrast'`, "affect ↔
   effect", decision 0026). Split senses (one recognition card per sense, `sense_id` set)
   and reset copies are extra cards the user asked for; the card they replace stays,
   suspended, with its logs.
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
- `deck`: notes of a smart deck (`deckId`; the data layer resolves it to note ids).

Each round has one card per note and 10 or 20 cards, shuffled with the session id as seed
(except `hard`). A card answered `unknown` the first time comes back once at the end.
`recordPractice` writes a `practice_logs` row and nothing else. A property test checks that
cards, review logs, `daily_activity`, the streak and the queue are unchanged.

## Tags and smart decks (`domain/tags.ts`, `domain/deckFilter.ts`)

Tags compare case-insensitively with Turkish rules (`İş` = `iş`); a note keeps the first
spelling. New tags are cleaned (one line, no leading `#`, ≤ 40 chars); a note has at most
`LIMITS.tags` (50) tags, and bulk actions leave a full note unchanged and report it.

Deck filter, version 1 (`{v: 1, ...}`; every key optional, an empty filter matches every
word):

| Key | Meaning |
| --- | --- |
| `states` | Any of `new`, `learning`, `learned`, `struggling`, `suspended` (OR). The status comes from the note's recognition card (`learned` = Review); `suspended` = every live card suspended, and such a note has no other status. `struggling` is an overlay: the practice "hard" rule at note level (`lapses ≥ 2`, `difficulty ≥ 7`, or an Again / "Bilemedim" within 14 days). |
| `tags`, `tagMode` | Tags (OR by default, `tagMode: 'all'` = every tag). |
| `addedWithinDays` | Note created within the last N days (the UI offers 7 and 30). |
| `levels` | Reserved for İP2: CEFR levels (`A1`…`C2`, OR). |
| `topics` | Reserved for İP7: topic keys (OR). |

Different keys are AND-ed. A deck that uses `levels` or `topics` is evaluated only when
`deckContext()` (`src/data/decks.ts`) provides `levelOf` / `topicsOf`; until then it shows
no count and no words. A filter with a higher `v` or an unknown key was written by a newer
app: it is shown as "made by a newer version", never evaluated or rewritten, and keeps its
JSON when renamed.

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
| `listDecks()` / `getDeckSummaries()` / `getDeckNoteIds(id)` / `countDeckFilter(filter)` | Smart decks with their counts; a deck's note ids (null when it cannot be evaluated here). |
| `createDeck({name, filter})` / `updateDeck(id, patch)` / `deleteDeck(id)` / `moveDeck(id, ±1)` | Deck CRUD (synced; delete is a tombstone, notes are untouched). |
| `listTags()` / `setNoteTags(noteIds, {add, remove})` / `renameTag(from, to)` / `deleteTag(tag)` | Tags with counts; bulk add/remove in one transaction (`{changed, full}`); rename also updates deck filters. |
| `getThemeSource()` / `saveThemePreview` / `updateThemePreview` / `applyThemePreview()` / `discardThemePreview()` | "Kelimelerimi temalara ayır": the words to send (term + English gloss only) and the local preview; applying turns kept groups into tags in one transaction. |
| `getCardView(cardId)` | Returns the note, senses, the sense to show, cloze/hint, the rotating sentence (İP5), the 4 interval previews and the cached lexicon rows of the senses (their levels). |
| `getHomeSummary()` / `getStreakSummary()` / `getHeatmap()` | Feed the home line, the stats metrics and the 26-week heatmap. |
| `getNoteDetail`, `findNoteByTerm`, `listNotes`, `listSources`, `pendingChangesCount` | Read helpers. |
| `getSettings` / `ensureSettings` / `updateSettings(patch)` | Settings. `updateSettings` validates with zod and with ts-fsrs. Call `ensureSettings()` at startup. |
| `loadOptimizerLogs` / `countOptimizerReviews` / `adoptFsrsParams(params)` / `revertFsrsParams()` / `markFsrsOptRun()` | Personal FSRS parameters (`src/data/fsrsOpt.ts`, decision 0022). Adopt and revert store the settings and replay every card from its logs in one transaction; review logs are only read. |
| `exportBackup()` → `BackupFile` | Builds the backup (`schema_version` 9: `practice_logs` since 3, `notes.level_override` since 4, `content_feedback`/`user_content` since 5, profile fields since 6, `decks` since 7, `level_tests`, `known_terms` and the settings level fields since 8, `weekly_reports` and `settings.goals` since 9; older files still restore, missing fields as null or their defaults and missing tables as none; an overwrite restore of a file without a table leaves the local rows of that table alone) and records `last_backup_at`. |
| `ensureWeeklyReport()` / `finalizeReportDraft(week, comment)` / `listWeeklyReports()` / `getReportNotice()` / `markReportSeen(week)` | Weekly report (`src/data/weeklyReport.ts`, decision 0027). The report is made as a draft after Monday's day start and stored in `weekly_reports` when its comment comes, or without a comment once waiting ends. The runner is `src/features/report/queue.ts`. |
| `getGoalsView()` / `setGoals(goals)` | Goal progress this week and month, with suggestions from the last 8 weeks (`domain/goals.ts`). `setGoals(null)` removes the goals. |
| `saveLevelTest(input)` / `applyTestLevel(level)` | Store a finished level test; a reliable one sets the level (`test`) and marks its "Biliyorum" words known. `applyTestLevel` uses an unreliable result anyway. |
| `getKnownTermKeys()` / `markKnown(term, source)` / `unmarkKnown(term)` / `listKnownTerms()` | Known words (stable API for İP4). |
| `getLevelOverview()` / `runWeeklyLevelUpdate()` / `dismissLevelChange()` / `undoLevelChange()` | The level model, vocabulary counter and weekly update (`domain/levelUpdate.ts`, `domain/vocabSize.ts`). |
| `restoreBackup(fileOrJson, 'merge' \| 'overwrite')` | Verifies the zod schema and checksum, restores in transactions of `RESTORE_CHUNK` (500) rows with bulk reads and writes, then recomputes all cards and `daily_activity` and compacts a guest's outbox (decision 0025). |
| `exportCsv(headers)` | CSV export. |
| `importAnkiPlan(plan, fileName, {onProgress})` | Anki import (decision 0019): writes a `planAnkiImport()` plan (`domain/anki.ts`). New terms get notes, cards and their history (logs `origin = 'anki'`, cards = replay) in transactions of 500 notes; terms the library has get only missing meanings, no history. Re-importing the same file adds nothing. Rebuilds `daily_activity`. |
| `startAnkiEnrich(id)` / `nextAnkiEnrichItems` / `applyAnkiEnrichResult` / `pauseAnkiEnrich` | "Sözlükle eşleştir" queue of an Anki import (runner: `src/features/anki/enrichQueue.ts`). A sense is linked only to a lexicon sense with the same Turkish meaning. |
| `runIntegrityCheck()` / `repairIntegrity()` | Startup check and the "Veri onarımı" repair. |
| `applyRemoteRows(batch)` | Sync pull hook. Mutable rows use last-writer-wins by HLC (an equal HLC only fills columns an older version dropped, `domain/syncMerge.ts`); logs are inserted if new. Pulled rows are not queued. Touched cards are recomputed (and queued if changed; every card when the pulled settings change `fsrs_params`), duplicates are flagged, and `daily_activity` is rebuilt when logs arrive. |
| `adoptGuestData(userId)` | Moves guest data to an account: sets `meta.user_id`, stamps guest rows and queues everything, including logs, then compacts the outbox (one entry per row). |
| `compactOutbox()` / `compactGuestOutbox()` | Outbox compaction (decision 0025): one entry per row; a guest also drops log entries. Runs after a restore, at the first sign-in and with the daily startup check. |
| `copyCardsFromOtherAccount(userId, snapshot)` | Another account's data on this device: copies its live notes, senses and referenced sources into `userId` as new rows (new ids, cards New), applies the account's snapshot and drops the other account's rows, logs, settings and import jobs locally. No history crosses accounts (decision 0008). |
| `resetStudyHistory()` | "Çalışma geçmişini sıfırla": an undo row for every answer that still counts, all cards recomputed (New, re-locked), `daily_activity` rebuilt. Syncs as ordinary log and card rows. |
| `rebuildDailyActivity()`, `recomputeAllCards()` | Maintenance. |
| `getCardLapses(cardId)` / `leechAfterAnswer(cardId, logId)` / `listLeechCards()` / `lapsesByNote()` | Leeches (`src/data/leech.ts`, decision 0026): lapses from the card's effective logs; whether an answer was the 6th lapse; the 6+-lapse cards for Stats. |
| `getLeechSheet(cardId)` / `splitSenses(cardId)` / `resetCard(cardId)` / `undoLeechAction(originalId, createdIds)` | "Bu karta başka yoldan bakalım": the sheet's data; one recognition card per sense or a fresh copy (the original is suspended, logs untouched); undo tombstones the new cards and unsuspends the original. |
| `getConfusables({noteId, limit, familyOf})` / `getConfusionPicker(noteId, query)` / `reportConfusion` / `hideConfusablePair` / `clearConfusion` | Confusable pairs (`src/data/contrast.ts`): scanned near pairs whose words are forgotten plus reported ones, minus hidden pairs and pairs with a card; the "karıştırdığın kelime" picker; report/hide rows in `user_content` (kind `confusion`). |
| `getContrastDraft(pair)` / `cachedContrast` / `storeContrastNote(res)` / `createContrastCard(input)` / `getContrastCard(noteId)` / `saveContrastText(noteId, text)` | Contrast cards: the draft from the cached shared content (works offline), caching an `ai-contrast` answer, the recognition-only note, and the user's difference line (`user_content` kind `contrast`). |
| `logError`, `listErrors`, `clearErrors` | Error log. |

### Restore semantics

- **merge**: Rows missing locally are inserted exactly as stored in the file. For rows on
  both sides, the greater HLC wins. Notes with the same term are flagged
  `possible_duplicate`.
- **overwrite**: The backup's mutable rows replace the local ones and are restamped. Live
  local rows that are absent from the file are soft-deleted.
- **Both modes**: Logs (review and practice) are insert-only, so missing logs are added and
  none are removed. A guest's restored logs are not queued (the first sign-in queues them).
- **Chunks**: each transaction covers `RESTORE_CHUNK` rows and their outbox entries, so an
  interrupted restore leaves part of the file applied; running it again finishes it (rows
  already restored compare equal, known logs are skipped). Tests check that every chunk size
  gives the same result and that a failed chunk is finished by a second run.

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

## Example sentences (v0.2 İP5, decision 0013)

| Table (Dexie v5)   | Synced                      | Indexes                                              | Notes |
| ------------------ | --------------------------- | ---------------------------------------------------- | ----- |
| `lexicon_examples` | pulled only (shared cache)  | `id`, `sense_id`, `[sense_id+level_band]`, `updated_at` | Shared sentences of a lexicon sense: `context`, `level_band` (A2/B1/B2/C1), `text_en`, `span`, `translations` (`{"tr": …}`), `status`. Never user text; written only by `ai-examples`. Retired rows are removed locally. |
| `content_feedback` | yes (per user, LWW)         | `id`, `[target_kind+target_id]`, `deleted_at`         | One row per target (`target_kind` `example`, `false_friend` — a false-friend warning hidden (`skip`) or reported (`reject`), target id = UUID v8 of SHA-256 over ("pair_note", "en-tr", `term_norm\|tr_word`), decision 0014; `mnemonic` — a hidden mnemonic suggestion, decision 0020), `verdict` `like`/`skip`/`reject`. The id is derived from the target (UUID v8 of SHA-256), so two devices write the same row. Taking a verdict back is a tombstone. |
| `user_content`     | yes (per user, LWW)         | `id`, `kind`, `lexicon_sense_id`, `replaces_id`, `deleted_at` | The user's own text: `kind` `example_sentence` (an edited sentence, `replaces_id` = the shared sentence, id derived from it) and `mnemonic` (the user's pick or own text, one row per sense, decision 0020). Private to the account; never written to a shared table. |
| `example_jobs`     | no (device-local queue)     | `key` (`<lexicon sense id>\|<band>`), `status`, `next_attempt_at` | Background preparation: `contexts` asked, `priority` (2 open on screen, 1 new card, 0 backfill), `attempts`, `error`. |

Settings: `example_tr_visible` (null/false: the translation of an example sentence shows on
tap) and `example_contexts` (2–4 context keys; null: `daily`, `conversation`, `work`,
`formal`). Meta: `lexicon_examples_cursor`, `server_examples` (the server has the content
tables), `examples_since`, `examples_backfill`, `example_calls:<YYYY-MM-DD>`.

`getCardView` adds `sentence`: the source sentence and the non-skipped example sentences of
the selected contexts take turns (index `card.reps`), so the front of a recognition card
and the blank of a cloze card change after every answer (a cloze card only uses sentences
where the term is located). The back repeats that sentence.

Backups (`schema_version` 5 and later) carry `content_feedback` and `user_content`; files without them
restore as before, and an overwrite restore of such a file leaves the local rows alone.
Copying cards to another account does not copy them (decision 0009).

## Mnemonics, text topics and model false friends (v0.3 İP2, decision 0020)

| Table (Dexie v13)    | Synced                     | Indexes                                   | Notes |
| -------------------- | -------------------------- | ----------------------------------------- | ----- |
| `lexicon_pair_notes` | no (read-only cache)       | `id`, `[sense_id+kind]`, `term_norm`      | Shared notes of a lexicon sense: `mnemonic_suggestion` (`content = {type: sound/story/image, text_tr, why}`, from `ai-mnemonic`; a local row `none:<sense id>` with `{type: 'none'}` remembers "no good association") and `false_friend` (`{tr_word, en_meaning_tr, tr_meaning_tr, tr_meaning_en, strength, note_tr}`, from `ai-extract` extract-v5). Never user text. Kept when switching or copying accounts. |

- The user's mnemonic: `user_content` with `kind 'mnemonic'`, one row per sense of the user
  (id = UUID v8 of SHA-256 over ("user_content", "mnemonic", sense id)), `sense_id`,
  `lexicon_sense_id` (null for a sense outside the shared lexicon), `replaces_id` = the
  suggestion it came from or null, `text` (1–300 characters), `selected: true`.
- A rejected suggestion: `content_feedback` with `target_kind 'mnemonic'`, `target_id` =
  the suggestion's `lexicon_pair_notes.id`, `verdict 'reject'`.
- `import_jobs.chunk_topics` (not indexed): the topic keys of each processed chunk; the
  last chunk aggregates them into `sources.topics` (`aggregateTopics`). Absent on jobs from
  before v13 (no upgrade needed). Chunk results in `chunk_cache` carry `topics` and, per
  candidate, `false_friend` since extract-v5.

## Account deletion and device wipe (v0.4 İP7, decision 0035)

- Every user-scoped server table has a column referencing `auth.users (id) on delete cascade`;
  `public.user_owned_columns()` lists them from the catalog and the SQL test
  `22_account_delete.test.sql` fails for a `user_id` column without one.
- `public.delete_user_data(user)` (service role only) deletes every row of the user in all those
  tables in one transaction, under the per-user sync lock, and returns the counts per table.
  The `account-delete` function calls it between removing the user's Storage files and
  deleting the auth user. Shared tables (`lexicon_*`, `ref_*`, `ai_system_usage`, `sync_tables`,
  `push_cron_config`) have no user column and are never touched.
- Locally, `wipeLocalDatabase()` (`@/data`) clears every Dexie table in one transaction,
  including `meta` (so `user_id`, the device id and the sync cursors go too: the next start is a
  fresh guest install). `features/account/deletion.ts` adds the audio cache, the `engapp.*`
  localStorage keys and the browser's push subscription.

## Leeches, confusables and contrast cards (v0.3 İP6, decision 0026)

- Nothing is stored for a leech: `lapses ≥ 6` from the effective review logs
  (`domain/leech.ts`). Split and reset add cards and suspend the original; no log changes.
- Dexie v19: no new table or index. The upgrade re-pulls `notes` once (`pull_backfill`) for
  contrast notes written by newer devices.
- `notes.term_type` may be `contrast`: term "a ↔ b" (sorted), sense 1 = the first word,
  sense 2 = the second (meanings copied from the user's senses, sentences from the shared
  content or none), one recognition card, no level.
- `user_content` kind `confusion`: a pair the user reported (`context 'reported'`,
  `selected: true`) or hid (`'hidden'`); id = UUID v8 of SHA-256 over ("user_content",
  "confusion", the sorted normalised terms); `text` "a ↔ b"; `sense_id` / `replaces_id` =
  the two senses. Undo is a tombstone.
- `user_content` kind `contrast`: the difference line of a contrast note (1–300
  characters); id from ("user_content", "contrast", note id); `sense_id` = the note's first
  sense; `replaces_id` = the shared `lexicon_pair_notes` row it came from, or null.
- `lexicon_pair_notes` kind `contrast` (cache of `ai-contrast`): `sense_id` = the smaller
  lexicon sense id, `content_key` = "<smaller>|<larger>", `content = {a, b, difference_tr}`
  with each side `{sense_id, lemma, sentence_en, span, sentence_tr}`. Never user text.

## Pictures (v0.4 İP3 and İP4, decisions 0031 and 0032)

- Dexie v21: the `images` cache table (above) and a one-time re-pull of `settings` for
  `show_image_front`. Server: `settings.show_image_front boolean` (migration
  `20261025000300_image_settings.sql`); `public.lexicon_images` and the review functions
  belong to the pipeline package.
- `user_content` kind `image_choice`: one row per sense of the user (id = UUID v8 of SHA-256
  over ("user_content", "image_choice", sense id)); `sense_id`, `lexicon_sense_id`;
  `replaces_id` = the chosen `lexicon_images.id` or null (no choice); `context` `chosen` or
  `hidden` (= `text`); `selected` = not hidden. "Görseli gizle" hides the sense's picture
  on every card; the row's tombstone or `chosen` shows it again.
- `content_feedback` with `target_kind 'image'`: "Bu görsel anlamı anlatıyor mu?";
  `target_id` = the image id, `verdict` `like` (Evet) or `reject` (Hayır). A rejected
  picture is never picked for that user's cards.
- `user_content` kind `image_feedback`: the reason of a "Hayır" (`content_feedback` has no
  reason column). Id over ("user_content", "image_feedback", image id); `replaces_id` = the
  image id; `context` = `text` = `wrong_meaning`, `unclear`, `ugly` or `other`
  (`IMAGE_REJECT_REASONS`).
- Which picture a card shows (`domain/images.ts` `pickImage`): none when hidden; else the
  chosen one (a "Hayır" on it clears the choice); else the first approved, then the first in
  review, by variant, skipping rejected ones.
- None of these rows is copied to another account (decision 0009).
