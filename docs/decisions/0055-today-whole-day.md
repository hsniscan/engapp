# 0055 — Bugün shows the whole day; one count; honest study sessions (v0.5.1)

Status: accepted (v0.5.1 "Toparlama", report items 3, 7, 8, 9, 10 and Bugün/Çalışma notes)

## Context

The review of 26 October 2026 found that Bugün counted only Kelime çalışma ("Bugünlük tamam"
while Üretim had 29 and Boşluk 28 cards), four screens showed four different "left today"
numbers with estimates 2–3× too low, the mixed session used other limits than the modes, a
wrong typed answer still offered "Zor = 2 ay" on one tap, the session counter grew with every
learning step (0/15 → 15/30), an evening learner lost a ramp step to the 12-hour rule, the
"10 dk" step came back after seconds, and the reminder could say "300 kart, 50 dk".

## Decisions

1. **One plan of the day** (`domain/studyPlan.ts`). Per mode: due reviews, learning steps, new
   cards. Cards left = their sum. Minutes = answers × the user's pace, where a new card counts
   2.5 answers (its learning steps) and a learning step 1.5. Bugün, the Çalış picker, the mixed
   session, "Biraz daha çalış" and the session summary read the same numbers
   (`features/review/studyModes.ts getTodayStudy`). The next mode is the first with cards in
   the order Kelime → Üretim → Boşluk → Dikte.
2. **Bugün's hero is the whole day**: a chip per mode (✓ when done), one count and estimate,
   one button to the next mode ("Üretime geç (29)"). The separate tiles are gone. "Biraz daha
   çalış" shows only when every mode is done.
3. **Catch-up is one budget for the day**, shared by the modes in the same order
   (`shareReviewCap`). Before, every mode got the whole cap.
4. **Karışık çalış = the four modes' own queues** (`getMixedStudyQueue`): due learning steps
   first, the modes' cards in turn, later steps last. Same limits as the modes; Dikte included
   when this device can read its sentences. Its title is "Karışık çalışma", never "Tekrar".
5. **Dikte is listed only when it can give cards** (`dictationAvailable`): a guest offline
   with no cached sentences does not see it. A mode's empty screen counts that mode only.
6. **Ramp: a later calendar day counts** (amends ADR 0041 §1). An answer on a later local day
   (day starts at `day_start_hour`, 04:00) that is not before the card's due day counts even
   under 12 h: Good 22:00, 22:11, next day 09:11 → ramp 1, Pekişiyor. "Yarının kartlarını
   şimdi" stays an early review (before the due day). The scheduler carries the day config;
   the learning-model backfill runs once more (`learning_model_backfill_v2`) so stored ramp
   steps follow the rule. Changing the time zone later re-reads old days in the new zone on the
   next replay; accepted.
7. **Learn-ahead 20 → 2 minutes.** When nothing else is left, a learning card due within 2
   minutes is shown early (the 1-minute step after Again); the 6 and 10-minute steps wait and
   the session ends with "Sıradaki kart 9 dk sonra". The buttons' "10 dk" is now true. Chosen
   over relabelling: a step answered after seconds is not the spaced step the label promises.
8. **Wrong typed answer**: the checker's suggestion Tekrar is marked, and Zor / İyi / Kolay need
   a second tap (or key) with "Yine de … mi?". Two buttons with the same rounded label ("2 ay")
   fall back to whole days ("58 gün", "62 gün").
9. **Session progress counts cards**: a fixed number of cards (it grows only if a card joins),
   cards answered at least once, and "+n tekrar" for learning steps still to come.
10. **Session summary**: "15 kelime çalıştın · 3 kelime Pekişiyor'a geçti"; recall counts
    answers on cards that were in review only (a new word's first answers are not recall); the
    main button goes to the next mode with cards, else home; the "Yarın N kart seni bekliyor"
    phrasing is gone ("Yarın N kart planlı").
11. **One note at a time on Bugün**, in priority order: the stricter-rule note, a covered
    streak day, load notes, the FSRS offer, interests, a level change. The guest backup
    reminder stays a banner of its own above the page and does not hold these back (a guest
    sees it every day until a backup, so it would hide catch-up and a covered streak day).
    No goals: one line "Günlük hedef koy" with 10 / 15 / 20 dk.
12. **Reminder** (`20261102000200_push_capped.sql`): reviews above the capacity are capped as
    catch-up caps them (learning steps added, new cards not counted); a tap opens `/study`.

## Consequences

- A mixed session builds four queues per rebuild: slower on very large collections; the
  modes' own sessions are unchanged.
- Old links to `/review` still work (redirect to Kelime çalışma).
- The phone reminder (`src/native/reminders.ts`) falls back to `/review` when a payload has no
  URL; with the shared message it now gets `/study`.
