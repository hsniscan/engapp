# 0010 — Extra study: more new cards, practice rounds, tomorrow's reviews

## Context

After his first full day, Hasan had no way to keep studying ("1 gün çalışınca tekrar
çalışmak için herhangi bir yolu yok"). The home card showed a disabled "Tekrara başla" button.
The v0.2 plan (İP1, Ek A.2, A.3) describes three options behind a "Biraz daha çalış" button.
This record lists what was built and where it differs from the plan.

## Decision

1. **Entry points.** "Biraz daha çalış" appears on the session summary, on the empty review
   screen and in place of the disabled button on the home card once today is done. It opens
   a page (`/more`), not a pop-up menu. The page fits the three options with their counts
   and a short explanation each, works from the keyboard without any focus trap, and is a
   normal URL for the back button. When reviews are still due, the page starts with
   "Tekrara başla" instead of hiding them.
2. **Extra new cards.** `addExtraNew(n)` adds n to the device-local meta key
   `extra_new:<day>`. The key is per day, so it expires by itself; older keys are deleted on
   the next write. The queue allows `daily_new_limit + extra - introducedToday` new cards.
   `introducedToday` still comes from the review logs, so cards opened on another device are
   counted once. There is no separate `extra_new` queue mode: the allowance only raises the
   normal limit, so the normal session (with its 1-new-per-5-reviews rhythm) brings the
   cards. The page offers +5 and +10, or what is actually waiting when fewer are left
   (`extraNewSteps`). The API accepts 1–100.
3. **Practice round.** Practice is not a mode of `getStudyQueue`. `getPracticeCards(filter)`
   selects the cards (`domain/practice.ts`) and a separate screen (`/practice`) runs the
   round with two answers: "Bilemedim" (1) and "Bildim" (2). A missed card comes back once at
   the end of the round. Each answer writes one `practice_logs` row through `writeTx`, and
   nothing else. A property test checks that cards, review logs, `daily_activity`, the streak
   and the queue are identical before and after any practice sequence. The E2E test checks
   the same in the browser.
   - Sources: `hard`, `recent` and `tag`. `deck` and `topic` come with İP8 and İP7. `mode`
     is a free string of 1–32 characters on both sides, not an enum, so those packages need
     no migration.
   - `hard` also counts a "Bilemedim" in practice within the last 14 days, in addition to the
     plan's rules (`lapses ≥ 2`, `difficulty ≥ 7`, or an Again in the last 14 days). A word
     missed in practice is a word you find hard. Order: recent miss first, then lapses and
     difficulty. The plan orders by difficulty only.
   - One card per note per round (siblings ask the same word). Order is seeded by the
     session id.
   - The summary shows cards, how many were known on the first try, the time and up to 3
     words with the most misses. "Bir tur daha" starts a new round with the same choices.
4. **Tomorrow's reviews now.** `getStudyQueue({ mode: 'ahead' })` shows Review-state cards
   due before the end of tomorrow's local day. Learning steps keep their normal timing (a
   step is minutes, not a day). It shows no new cards, and the sibling burial rule still
   applies. Answers are ordinary `answerCard` calls. ts-fsrs uses
   the real elapsed time, so the next interval of a card reviewed early is a little shorter.
   `daily_activity.completed` still looks only at cards due today, so neither extra option
   changes "bugün tamamlandı" or the streak.
5. **Server: registry instead of `_v3` push.** Migration `20261021000900_practice.sql` (the
   name given for this work; the plan's names were indicative) adds the `practice_logs` table
   and the `public.sync_tables(name, insert_only, conflict_key)` registry. `sync_push`,
   `_sync_upsert` and `purge_tombstones` now read the registry in place. A v0.1 client only
   pushes the six tables it knows, so changing `sync_push` itself is safe and avoids a
   `sync_push_v3`. A new `sync_pull_v3` returns every registered table. `sync_pull` and
   `sync_pull_v2` are unchanged, so a v0.1 client never receives `practice_logs`. The
   registry column is `conflict_key text` (`id`, or `user_id,id` for settings), not
   `key_cols text[]`. pgTAP tests are in `supabase/tests/database/05_practice_logs.test.sql`.
6. **Deploy order does not matter.** The client tries `sync_pull_v3`, then `sync_pull_v2`,
   then `sync_pull`. Practice logs stay in the outbox until a pull was answered by v3: the
   meta flag `server_practice_logs` is set only then. A new client against an old backend
   therefore never burns push attempts on rows the server would reject.
7. **Dexie version 3** (`practice_logs: 'id, card_id, practiced_at, session_id'`). The plan
   numbered İP1 as version 2, but v0.1 already shipped version 2 (`source_sentence_tr`). The
   upgrade only adds a table, so the plan's automatic pre-migration backup
   (`pre_migration_backup`) was not built here. It belongs with the first upgrade that
   rewrites rows.
8. **Backups.** `schema_version` 3 writes `practice_logs`. Version 1 and 2 files restore
   unchanged: the table is optional in the schema and absent from their checksum. Restore
   inserts missing practice logs and never removes any.

## Not done (later)

- Practice numbers in Stats. The plan uses them for İP3 level estimation. The current
  metrics grid has no slot, and a new card for one number did not seem worth it yet.
- "Çalışma geçmişini sıfırla" leaves practice logs. Reset cards are New, so they are not
  offered for practice, and the old rows do no harm.
- Known gap: a device still running v0.1 pulls with `sync_pull_v2`. If it pulls after
  another device's practice rows reached the server, its cursor moves past them. After it
  updates to v0.2 it does not get those rows. They stay on the server and on the device
  that wrote them. Only İP3 statistics will read them, and those can use the server data or
  a full resync.
- Remove `sync_pull_v2` and the old `sync_pull` once every device runs v0.2.

## Why

Hasan gets more study the same evening without breaking the parts he trusts: the FSRS
schedule (practice never touches it), the streak and "bugün tamamlandı" (computed only from
real reviews due today) and the outbox model (practice logs are ordinary insert-only rows).
The registry makes the next synced tables (İP3, İP5, İP8) a data change, not new functions.
