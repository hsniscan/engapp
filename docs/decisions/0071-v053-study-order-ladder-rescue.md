# 0071 — One card per word a day, a format ladder, honest ratings, earlier rescue (v0.5.3)

Status: accepted (v0.5.3 "Öğren ve doldur", owner approval 2026-11-05: B1, B2, B3, B5, B6, B7,
A3; evidence in `plan/oneriler-2026-11/teknik-notlar/ogrenme.md` #1, #2, #3, #5, #7, #11 and
`kullanim.md` item 5). Amends 0041 (stages), 0055 (study modes, mixed session), 0062 (picker),
0026 (leeches) and 0022 (optimizer). The learning model (`ogrenme-modeli.md`) is otherwise
unchanged: the ramp, the stage thresholds, the unlock rule and "review logs are never edited".

## Context

Study modes ran as separate blocks, and Bugün's button walked them one after another. When a
word's recognition and production cards were due on the same day, the learner flipped the
recognition card (English form and Turkish meaning on screen) and minutes later was asked to
produce that same form: an echo logged as a full success. Formats did not depend on strength:
an Öğrenildi word still showed the example sentence on the recognition front and the blanked
sentence on production, and a cloze defaulted to four choices whose right pick suggested İyi
like a typed recall, so a pick from four could carry a card to Öğrenildi. `duration_ms` was
stored and never used; the personal FSRS fit trained on choice logs; a leech was only noticed
at 6 lapses. Typed and choice cards cost three taps (check, then a rating) and the filled
button was always İyi, even when we suggested Tekrar.

## Decisions

1. **One card per word per day, hardest format first (B1).** `domain/queue.ts siblingHolds`:
   rank dictation 3 > production / picture 2 > cloze 1 > recognition 0 (ties by id, so every
   device agrees). A Review card due today, not answered today, is held (not shown today) when a
   harder sibling of the same note
   - was answered today without an Again, or
   - is itself due today and not answered yet, and the held card fell due *today*.

   An Again on the harder card releases the easier one the same day (a relearning aid). The
   second condition's "fell due today" bound means a card moves at most one day: if the user
   never opens the harder mode, the easier card comes back tomorrow regardless. Learning steps
   and new cards are never held by this rule (new cards keep `isBuriedInMode`). Nothing is
   written: the FSRS state is untouched, the card is simply not in today's queue. The set is
   computed once over every card type in `readQueueBase`, so every mode, the mixed session and
   Bugün's counts agree; catch-up's "deferred" count leaves held cards out. 'Ahead' mode keeps
   its old note-level burying. We did not add the evidence note's "only when interval ≥ 3 d"
   exception: the owner asked for one card per word per day, and a one-day move of a 1-day
   interval is a 2-day gap that FSRS schedules from the real elapsed time. The workload
   forecast does not model holds (it slightly over-counts days with siblings due together).
2. **Format ladder (B2).** `domain/formatLadder.ts cardFormat(card)` from the card's *own*
   stage: from Öğrenildi, recognition shows the term alone (the sentence is on the back),
   production shows only the Turkish meaning (the blanked sentence is a "Cümleyi göster" hint
   and counts as a hint → Zor), and cloze is typed only (no choices, no toggle). Younger cards
   are as before.
3. **Choices are not recall (B2).** A right pick suggests Zor. `applyRating(..., { choice })`
   keeps `ramp_step` at `max(previous, 2)` at most, and never lets a card that was not
   Öğrenildi reach it (also when stability alone would cross 14 d: then the counter is held at
   2). Stability and difficulty are FSRS's as before. To keep "a card's state is the replay of
   its logs", the log stores how it was answered: **`review_logs.answer_mode`** (`choice` /
   `typed` / `flip`, nullable; Dexie v39, migration `20261106000100_study_ladder.sql`), and
   `replayCard` passes it on. Older rows and Anki imports have no value and replay as before.
   Cloze card views carry `previewsChoice` so the buttons' "↑ Öğrenildi" line and the session
   summary are honest for a pick.
4. **The mixed session is the default (B3).** Bugün's primary button opens
   `/study?mode=mixed` (the four modes' queues interleaved round-robin, B1 applied), labelled
   "Çalışmaya başla" / "Devam et". The Çalış picker's "Karışık çalış" switch is on unless the
   user turned it off (device flag `study.mixed` = '0'); single modes stay one tap away.
5. **Earlier leech rescue (B5).** From **3 lapses** a card is "Zorlanıyor" (badge on the card,
   the front's mnemonic hint) and its back shows **one** "Önerilen yol", chosen by rule from
   what exists on the device: a false friend, else a mnemonic (the user's own, or the first
   shared suggestion with "Bunu kullan"), else the word family; nothing when none exists (the
   "Başka yoldan bak" sheet stays in the menu). At the **6th lapse** the card **rests 30 days**:
   **`cards.rest_until`** (ms, nullable; Dexie v39 re-pulls cards once). A resting card is not
   studiable (`isStudiable(c, now)`), is excused from "day complete", and keeps its FSRS state,
   so it returns overdue and is scheduled from the real gap. Undo: "Geri al" in the after-Again
   line, and "Şimdi geri getir" in the word's detail (with the date). The v0.5.2 setting
   "Zorlanılan kartı askıya al" still suspends instead (its hint now says so). We chose a
   synced column over a suspension because a suspension has no end and would need the user to
   remember it; over a device-only meta key because other devices must not show the card.
6. **Pace hint (B6).** `domain/pace.ts`: per card type, the threshold is 2 × the median
   `duration_ms` of the user's last 1,500 passing (Good/Easy) answers, at least 8 s and at most
   45 s; with fewer than 20 answers of a type a default median stands in (recognition 5 s,
   cloze/picture 7 s, production 9 s, dictation 11 s). Anki imports and choice answers are left
   out. The session measures the time from showing the card to the check, pick or flip; a right
   answer above the threshold suggests Zor. Stored durations run to the rating tap, so the rule
   errs towards "not slow". Self-rated cards (recognition, "aklımdan") only get Zor marked, no
   "Devam".
7. **The optimizer leaves choice answers out (B7).** `DatasetLog.choice` →
   `ReviewDataset.skip`: the answer stays in the card's history (the scheduler applied it, so
   the memory state must see it) but is never a training or test target, nor counted in the
   time split or the initial-stability pretrain. Per-format parameter sets (#11 medium term)
   are deferred.
8. **One "Devam" button (A3).** With a suggestion, a full-width "Devam · <rating>" button (and
   Enter) applies it, in the suggested rating's own colour, with its interval; the four buttons
   sit under it at 48 px and all tinted (İyi too, `ratingLook.good.tonal`). The wrong-answer
   guard (a second tap for Zor/İyi/Kolay after a suggested Tekrar) stays. A tap on a cloze
   choice checks it at once; "Kontrol et" remains only for typing. Typed and choice cards: 3 → 2
   taps.

## Consequences

- Retention on strong cards may dip at first because the questions got harder; the target
  retention is unchanged. Production and dictation answers now measure unprompted retrieval,
  so "Aktif" means more.
- Days where siblings fall due together show fewer cards; the easier ones come the next day.
- Older app versions ignore `answer_mode` (their replay lets a choice reach Öğrenildi again)
  and `rest_until` (they show a resting card). Both heal once every device runs v0.5.3.
- Deploy: the migration `20261106000100_study_ladder.sql` (two nullable columns). No function,
  workflow or secret changes.
