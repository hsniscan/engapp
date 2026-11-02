# 0062 — Bugün follows the clock; one new-card budget; fair catch-up (v0.5.2)

Status: accepted (v0.5.2 "Sağlamlaştırma", review 2026-11-01: bugun-calisma B1–B11, B13, copy
1–4 and 6–7; android-pwa Y3; kod-kalitesi I-1, I-1b, I-5, I-11). Amends 0055 §1–3 and 0010.

## Context

The review of 1 November 2026 found that Bugün never refreshed without a database write (on
Android and in an installed PWA the page is resumed, not reloaded), said "Bugünlük tamam" while
learning steps were still due today, counted answers in a ring labelled "kart", let every mode
introduce `daily_new_limit` first-time cards (up to 4× the setting, while the forecast assumed
one limit), gave the whole catch-up budget to Kelime so Üretim and Boşluk waited for days,
offered "Yarının kartları" for cards learnt minutes earlier (skipping the ramp's next-day test)
and for the whole capped backlog, and opened an empty Kelime session from "+5 yeni kart". A
typed "then" for "than" was "neredeyse". Bugün built every mode's queue from scratch, four
times, with `formatToParts` per timestamp as the top JS cost.

## Decisions

1. **One read for every mode** (`data/queries.ts getStudyQueues`). Cards, today's facts, the
   load plan, the extra allowance and the new-card order input are read once; each mode's queue
   is then built synchronously from them (nothing awaited, so Dexie's live-query zone is kept).
   `getTodayStudy`, the mixed session and "Biraz daha çalış" use it. The unused legacy queue in
   `getMoreStudyOverview` is gone. A unit budget keeps it cheap: on 5,000 cards the whole day
   must cost under 2× one mode's queue (`todayStudy.perf.test.ts`; 74 → 21 ms in jsdom).
   `domain/day.ts` caches the zone offset per (zone, UTC hour) when both ends of the hour agree.
2. **Learning steps due later today are today's work.** A queue reports `learningLater`; the
   day's count includes them. Bugün has three states: *ready* (cards now), *waiting* ("5 kart
   10 dk sonra", the clock time, no "Biraz daha çalış") and *done*. Ready counts with the same
   2-minute learn-ahead as the session. The session summary and the empty session screen say
   when the steps come back and show "Devam et" by themselves once they are due.
3. **Bugün follows the clock** (`features/review/studyClock.ts`). One shared tick for every
   screen: a timer to the earliest wake-up a screen registers (the next learning step minus the
   learn-ahead, the end of the study day at `day_start_hour`), `visibilitychange` / `focus` /
   `pageshow` (Android and PWA resume), and a 5-minute safety tick. Live queries take the tick
   as a dependency; nothing is polled per second.
4. **One new-card budget over the modes** (`domain/studyPlan.ts shareNewBudget`).
   "Günlük yeni kart" is the number of first-time cards a day over Kelime, Üretim, Boşluk and
   Dikte together, after the vacation/catch-up ramp. It is split fairly (water-filling) over
   the modes that have first-time cards, Kelime weighted 2 because it brings in the words; a
   mode with few cards hands its share on, so a new user gets the whole budget in Kelime. The
   split is made over the whole day (introduced + still available), so the mode studied first
   cannot take the others' share. The spec's "separate counter" (ogrenme-modeli §4) becomes an
   optional **per-mode limit** for Üretim, Boşluk doldurma and Dikte inside the budget
   (`settings.study_options.mode_new_limits`, default none). The forecast and the overload
   warning already model one shared limit, so they now match the queue.
5. **"+5 yeni kart" is per mode**: the allowance (`meta extra_new:<day>`, now a per-mode map;
   an old number is Kelime's) goes to the mode with the most waiting first-time cards, and the
   button opens that mode. It is not offered while catch-up, a vacation or the ramp after one
   pauses new cards.
6. **Catch-up is fair** (`shareReviewBudget`, replaces 0055 §3's "Kelime first"). The day's
   review cap is split by water-filling over the modes with due reviews, counting reviews done
   today, so Üretim and Boşluk keep moving. A mode whose reviews were moved shows "ertelendi",
   not ✓.
7. **"Yarının kartları" is tomorrow only.** Today's due reviews stay in the normal queue under
   the cap (no more backlog behind a "N kart" label), and cards answered today or still waiting
   for the ramp's next-day test (ramp step 0, last answer within two days) are left out. The
   label counts what the session holds.
8. **The ring counts cards**: cards answered today that are done for today over those plus the
   cards left. The done subtitle counts every mode ("x tekrar · y yeni kart"). The split names
   learning steps "öğrenme adımı", not "tekrar". "en uzun N" shows only when it differs from
   the current streak. Empty Üretim/Boşluk chips of a user with no such card open say
   "henüz açılmadı" with "kelimelerin Pekişiyor'a gelince açılır". First-time Üretim/Boşluk/
   Dikte cards say "Yeni kart" (their word is not new). The practice source is "Bu hafta yeni
   başladıkların".
9. **Another real word is not a typo** (`domain/answerCheck.ts`). A "close" answer that is a
   different real English word — a built-in list of common one-edit pairs (then/than,
   quiet/quite, lose/loose, advise/advice …) or a headword in the dictionary on the device
   (word bank, lexicon cache, the user's notes) — is `wrong` with `otherWord`, shown as
   "Başka bir kelime", and Tekrar is suggested with the usual confirm guard.
10. **Interval labels through i18n.** The domain returns `{unit, value}`
    (`nextIntervalParts`, `intervalParts`, `distinctIntervalParts`); the words come from
    `interval.*` in tr.json / en.json. The English UI no longer shows Turkish under the buttons.
11. **Study options** (`settings.study_options`, one synced jsonb column): the per-mode limits
    above, **Oturum uzunluğu** (10/20/30 cards a session; the session keeps the learning steps
    of its cards, the summary offers "Devam et"), and **Zorlanılan kartı askıya al** (suspend a
    card on its 6th lapse; off by default, the leech flag says so).

## Schema

- Dexie **v38**: no new table or index; a device that pulled settings on an older version
  re-pulls settings once (`addPullBackfill`), as v34/v36 did.
- Supabase `20261103001500_study_options.sql`: `settings.study_options jsonb`, nullable, must
  be an object. Older clients leave it out (kept on push). pgTAP: `62_study_options.test.sql`.
- Backup format unchanged (optional settings field, absent = defaults).

## Tests fixed

- `StreakFreezeNote.test.tsx` and `streak-freeze.spec.ts` ran on the real clock and failed on
  the 1st of every month: both use a fixed mid-month clock.
- `image-card.spec.ts`: the fixture was stale. One same-day Kolay leaves the recognition card
  at ramp step 0, and ADR 0041 opens sense cards only at Pekişiyor; the fixture now has a
  second-day recall. The app was right.

## Not done

- B12 (a 03:00 learner gets ramp credit after 6 h) stays as accepted in 0055 §6.
- "Yarın N kart planlı" still ignores a catch-up cap tomorrow (it now matches the shared
  budget, B10 in part).
- A local notification when learning steps fall due, and Anki's "learn ahead now", are left
  for the redesign.
