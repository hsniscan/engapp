# 0021 — Load management: capacity, forecast, catch-up, vacation

## Context

v0.3 İP3 (plan Ek A.4, acceptance criteria 1–3). A break must not punish the learner, the
review load of the coming days must be visible before it arrives, and a planned vacation must
not break the streak. Hasan approved: the streak is frozen on vacation days (neither breaks
nor grows), the default capacity is 20 minutes, catch-up is on by default.

## Decision

1. **Pure rules in `src/domain/`.** `capacity.ts` (minutes → cards), `forecast.ts` (30-day
   expected-value forecast, warning, suggested limit), `catchup.ts` (today's plan: cap, order,
   ramp) and `vacation.ts` (ranges, streak freeze, review-ahead offer). `src/data/load.ts`
   only reads Dexie and caches. Public API for other packages: `capacityCards(settings, logs,
   now?)`, `isOnVacation(settings, day)`, `isVacationDay`, `planLoad`, `forecastWorkload`.
2. **Settings (synced, optional).** `daily_capacity_min` (null = 20, 5–180 in the UI, 1–600 on
   the server), `catchup_auto` (null = on), `vacation: {start, end} | null` (local day keys,
   both ends included) and — beyond the plan — `vacation_history` (earlier vacations, at most
   20). Without the history, replacing or ending a vacation would turn its days back into
   missed days and break a streak that had been frozen. Migration
   `20261023000300_load_management.sql` adds the four nullable columns with CHECKs, plus
   `public.on_vacation(vacation, day)` and `public.settings_local_day(timezone,
   day_start_hour)` for server jobs (the push package skips users on vacation). No backup
   version bump: the fields are optional and not defaulted, like `show_easy_candidates`.
   Dexie **v14** re-pulls settings once (an older app version may have stripped the columns);
   `syncMerge` restores them on equal HLC (`catchup_auto` uses `undefined` as its unset value,
   because a stored `false` is a real choice).
3. **Capacity.** Seconds per card = median `duration_ms` of the non-undone answers in the 30
   days before today (fallback 10 s under 20 answers, clamped 3–60 s). Cards =
   floor(minutes·60 / seconds). Answers include new cards, so the pace is what a day costs.
4. **Catch-up is queue-only and stateless.** The plan is derived from facts every device can
   rebuild: the backlog at the start of today and yesterday (Review-state cards due before the
   day's end; cards answered since yesterday are replayed to see where they stood). When the
   start-of-day backlog exceeds capacity, today's queue holds at most `capacity − reviews done
   today` reviews (done = backlog − still due, so another device's answers count), ordered by
   relative overdueness `(now − due) / max(scheduled_days, 1)`, and no new cards. Learning and
   relearning steps are never capped. Nothing is written: `cards` and `review_logs` change only
   through ordinary answers (property test + recompute equality in `catchup.test.ts`).
   The day facts are cached per day and recomputed when older logs arrive (sync, restore).
5. **Ramp.** New cards: 0 on a catch-up day, on vacation and on the first day back; ½ (rounded
   up) on the day after a catch-up day and on the second day back; then the full limit. The
   plan's wording "paused, then 0 → ½ → full" is read as: the paused days are the 0 days.
   For three days after a vacation catch-up switches itself on even when turned off
   (criterion 3).
6. **Vacation.** No new cards on vacation days (the server helper lets push skip them).
   Reviews are still offered if the user opens the app. Streak: an inactive day inside any
   vacation (current or history) is skipped by `currentStreak`/`longestStreak`; an active
   vacation day counts as usual. "Yarının kartları" (ahead mode) reaches over an upcoming
   vacation: from 3 days before the start it covers up to the vacation's end, at most 7 days
   (`aheadDaysBeforeVacation`), and the home screen offers it. Ending a vacation early keeps the
   lived days (`end = yesterday`); today is the first day back.
7. **Forecast.** Per card, an expected-value walk with the same FSRS model (ts-fsrs, no fuzz):
   at each due review Good with probability R(t) (its retrievability that day, not a flat
   request_retention, so overdue cards are modelled honestly), Again otherwise (plus one
   relearning answer the same day). Branches below 2% or deeper than 8 continue on the recall
   path only. New cards: one profile per start day (learning steps from the real scheduler),
   scaled by the daily limit, the cards waiting and the vacation/ramp factors; vacation days
   are skipped and their reviews roll over. Counts are answers (reviews, relearning and
   learning steps, new cards), the same unit as capacity. Tested against a Monte-Carlo
   ground truth with the real scheduler (fuzz on): weekly totals within ~5% (criterion ±15%),
   also after a 5-day gap and with a vacation; 5 000 cards in ~10 ms (budget 150 ms). The UI
   still runs it in `requestIdleCallback`.
8. **Warning and suggestion.** Warning when any of days 1–7 (tomorrow on; today is the
   catch-up's business) exceeds capacity. Suggested limit = largest n below the current limit
   whose forecast fits days 1–14; none fits → suggest a longer daily time instead. One tap
   applies it; "Bu hafta gösterme" hides the note for 7 days on this device (meta
   `load_warning_dismissed`). The warning is not shown during catch-up or vacation.
9. **UI.** Settings section "Tekrar yükü" (`#yuk`), home notes (vacation, review ahead,
   "Telafi: N günde biter", ramp, warning) and a 30-day SVG bar chart with the capacity line on
   Stats (text summary, day table, light/dark tokens, no chart library).

## Not done / known limits

- `daily_activity.completed` is unchanged: a catch-up day with backlog left is "active", not
  "tamamlandı", in the heatmap. The streak only needs activity, so it is not affected.
- The forecast does not model catch-up spreading the backlog (day 0 holds all overdue cards);
  the catch-up estimate on the home screen uses a simple capacity-vs-arrivals count.
- The day facts cache is keyed by the number of logs before today; a suspend or delete of an
  overdue card changes the backlog only from the next day.
- pgTAP file `16_load_management.test.sql` was written but not run locally (no database in the
  agent environment).

## Why

Everything the user trusts stays where it was: review logs are the only source of card state,
FSRS is never bent, and a device that only knows the cards and logs reaches the same queue.
The learner gets a manageable day after a break, sees the coming load early, and a planned
vacation costs neither new-card discipline nor the streak.
