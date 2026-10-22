# 0027 — Weekly report and goals

## Context

v0.3 İP7 (plan "İP7 — Haftalık rapor ve hedefler", Annex A.8, acceptance criterion 4). After
the Monday day start the user gets a short report on last week: active days, reviews, new
words learned, overall retention, the strongest and weakest group, the streak and goal
progress. It also gives one concrete suggestion with a button. The AI writes a few Turkish
sentences about these numbers and must never produce a number itself. The report must work
offline: the numbers come at once and the comment later. Reports and goals belong to the
account and never move to another account (decision 0009).

## Decision

1. **All numbers are computed on the device**, by fixed rules (`src/domain/weeklyReport.ts`,
   pure):
   - The week is Monday to Sunday in local days (`timezone` + `day_start_hour`). The report
     about the last complete week is made on the first open after Monday's day start (by the
     runner after start-up, hourly, on `online`, after sign-in, or when the report tab
     opens). It is not made when nothing was studied before that week ended.
   - Active days, reviews, minutes and new cards come from `daily_activity`. New learned is
     the number of notes whose first card first reached Review that week.
   - Retention and the strongest and weakest groups use the Gelişim rule (decision 0023):
     the first answer per card and local day while in Review, at least 20 answers, the
     deterministic tie-break, and "none" groups left out. The window is the week. When no
     group has 20 answers in the week, the window is the 28 days ending with it, and the
     report says so. The strongest group is left out when it is the weakest one, or when it
     has the same rate.
   - The streak is `domain/streak.ts` at the end of the week; vacation days are neutral.
   - Acceptance criterion 4: `weeklyReport.scenarios.test.ts` has 20 fixed scenarios in which
     the named weakest group is the expected one.
2. **The focus is chosen on the device, from a fixed list, by a fixed priority.** This
   deviates from Annex A.8, where the model returned the focus. The device keeps the choice
   so that the button always matches the text and the model cannot invent an action. The
   priority:
   1. `lower_new_limit`: the 30-day forecast exceeds capacity and a lower limit fits. The
      button sets the daily new-card limit.
   2. `come_back`: at most 2 active days, with vacation days counting as excused. The button
      opens the review.
   3. `practice_weakest`: the weakest group is below 80 % or at least 5 points under the
      overall rate, and has at least 3 missed words. The button opens a practice round over
      those notes.
   4. `practice_gap`: recognition is ahead of production by at least 10 points, with at least
      3 notes. The button opens a practice round.
   5. `mnemonic_hard`: at least 3 words with a card forgotten at least 3 times. The button
      opens the first word in the library. İP6 has its own leech rule, which this does not
      replace.
   6. `add_words`: no new card is waiting. The button opens Add.
   7. `keep_going`: the button opens the review.

   An unknown key from a newer app version is shown as `keep_going`.
3. **ai-report (`report-v1`) receives only numbers and names from fixed lists.**
   - The request schema (`supabase/functions/_shared/report-contracts.ts`) has no free-text
     field. Group keys must come from fixed lists (term type, level, topic key, part of
     speech, card type). A source is always sent without its key, so its title never leaves
     the device.
   - The model returns 2–4 sentences, which the server checks one by one: clean Turkish text,
     no links, no emoji, at most 240 characters, no duplicates.
   - Every number in a sentence must be one of the request's numbers. This covers digits,
     percentages and Turkish number words, including suffixed forms ("beşinde"). "bir" is
     allowed. A sentence with any other number is dropped, and the device runs the same
     check again before it stores the comment.
   - Fewer than 2 clean sentences is `ai_failed`. The quota goes through `ai_consume`, and
     the model comes from the environment, as for the other functions. Details:
     docs/ai-report.md.
4. **Storage.**
   - `weekly_reports` is a synced, insert-only table (migration `20261023000900`, Dexie v20)
     holding one row per user and week. It has a unique index on `(user_id, week)`. A
     `BEFORE INSERT` trigger returns null for a second row of the same week, so the second
     device's push is acked (it never waits in the outbox) and skipped.
   - Each report has a random uuidv7 id, not one derived from the week. The first report that
     reaches the server is the week's report. On pull, it replaces the device's own report of
     that week, along with its outbox row and its draft.
   - `report_drafts` (local only, keyed by week) holds the report while its comment has not
     come. A draft becomes the final report when the comment arrives. It becomes final without
     a comment on a permanent error, after 4 failed attempts, after 7 days, once a newer week
     has a report, or at once in a build without a backend. The daily AI limit postpones the
     comment by 6 hours and does not count as a failure.
   - Only a final report is synced, so a report never changes after the push. That keeps the
     table insert-only.
   - Backups (`schema_version` 9) carry `weekly_reports`. A restore adds the reports of weeks
     the device does not have.
5. **Goals.**
   - `settings.goals = {week_active_days?, week_minutes?, month_new_terms?}` is an optional
     jsonb column. A null value or a missing key means no goal. It is a late column
     (`LATE_COLUMNS`), so Dexie v20 re-pulls settings and reports once, and `_sync_upsert`
     keeps it when an older app pushes settings without it.
   - Progress counts the current week (days and minutes) and the current month (new words
     learned). It is shown as rings on the continuity tab.
   - The suggested value is the 80th percentile (type 7) of the last 8 complete weeks,
     counted from the first active week. Days are rounded to whole days. Minutes and monthly
     words are rounded to 5; the monthly value is the weekly number × 30/7.
   - With fewer than 2 weeks of history, the suggestions are 4 days, 60 minutes and 40 words.
   - The user sets the goal. Nothing is set without them.
6. **Accounts.** Reports, drafts and goals are study data of the account. Copying cards from
   another account and "start with this account's data" leave them behind, and a guest's
   reports go to the account with the guest data (`src/features/auth/link.test.ts`). The
   "report seen" mark of the home note is kept per account on the device.

## Consequences

- The comment can arrive hours after the numbers. The screen says the comment will come
  once the device is online.
- If two devices both make the week's report, the one that syncs first wins, comment
  included. The other device's comment is lost. A comment is short and replaceable, so this
  is accepted.
- The focus rule is fixed in code. Changing it changes only future reports, because a stored
  report keeps its own focus key and note ids.
- pgTAP `20_weekly_reports.test.sql` was written but not run here (no local Supabase stack).
  CI runs it with the other database tests.
