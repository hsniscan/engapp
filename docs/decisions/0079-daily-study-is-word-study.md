# 0079 — The daily study is Kelime çalışma only; the other modes are extra practice

## Context

The owner wrote on 2026-11-26: "günlük çalışma kısmında sadece kelime çalışmayı bırakmak
istiyorum. Diğerleri günlük çalışmaya girmemeli, ekstra çalışma olmalı." Since v0.5.1 (ADR
0055/0062) Bugün's card counted every study mode (Kelime, Üretim, Boşluk doldurma, Dikte), its
button started one mixed session of all of them (ADR 0071), the day's new-card budget was shared
by the modes, and "Bugünlük tamam" waited for every mode. The other formats therefore looked like
daily obligations, while the app's core purpose is learning words.

## Decision

- `DAILY_MODES = ['word']`, `EXTRA_MODES = ['production', 'cloze', 'dictation']`
  (`domain/studyMode.ts`).
- `getTodayStudy` computes the plan (left, minutes, ready, later, next, done cards) over the
  daily modes only; `counts` still has every mode and `extraModes` lists the optional ones.
  Bugün's card, "Bugünlük tamam", the session summary's "next" step and the Çalış header follow.
- Bugün's button starts Kelime çalışma (`/study?mode=word`), not the mixed session. The mode chips
  left the card; a separate "Ekstra çalışma" list sits under it (`features/home/ExtraStudy.tsx`).
  The Çalış page shows Kelime çalışma on top ("Günlük") and the others under "Ekstra çalışma";
  the "Karışık çalış" switch is gone (the `/study?mode=mixed` route still works).
- The day's new-card budget ("Günlük yeni kart", ramp and catch-up included) belongs to Kelime
  çalışma alone. Each extra mode introduces first-time cards outside it, up to its own limit
  (`mode_new_limits`) or `EXTRA_MODE_NEW_DEFAULT` (10) a day, plus "+N yeni kart" for that mode.
- Catch-up's review cap limits Kelime çalışma only; extra modes show all their due reviews.
- Sibling holds (ADR 0071): a recognition card is no longer held back because a harder sibling is
  merely due; only a harder sibling answered today (without Again) holds it. Otherwise a word
  could drop out of the daily study waiting for an optional format.
- A day is "completed" (heat strip, `isTodayComplete`, `buildDailyActivity`) when no recognition
  card is left due. Any answer still makes the day active for the streak, so extra practice never
  hurts it.

## Why

The owner's request, and it matches the plan: words first, the other formats deepen words that
are already settling. Keeping the extra modes' new cards outside the daily budget means doing
only the daily study never starves Kelime çalışma, and opening an extra mode always has cards.
