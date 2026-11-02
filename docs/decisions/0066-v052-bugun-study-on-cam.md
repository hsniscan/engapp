# 0066 — Bugün, Çalış and the study session on "Çam" (v0.5.2, wave 2 W1)

Status: accepted (v0.5.2 wave 2, area W1). Builds on 0065 (design system "Çam") and keeps every
behaviour of 0062 (studyClock, waiting state, interval parts, shared new-card budget).

## Context

Bugün, the Çalış picker, the study cards, the summary, "Biraz daha çalış", practice, hands-free
and the leech sheets still used local sizes (`text-[0.9375rem]`, `rounded-[20px]`), local icon
sets (`homeIcons.tsx`, the hands-free SVGs, a "▾" glyph), serif titles and a goals card that
mixed day goal, level and decks. docs/design.md §4.1–4.4 gives the blueprints.

## Decisions

1. **Bugün = one Today card plus two quiet columns.** `PageFrame` with the date as eyebrow and
   the greeting as title; no logo and no sync pill (design.md §4.1: sync lives in the rail and
   on Profil). The Today card (`TodayHero`) keeps the three states of 0062 (ready, waiting,
   done): `ProgressRing`, one-line split, one `Chip` per mode, one primary button, and a footer
   with the week `HeatStrip` and the streak (opens the streak sheet). Mode chips are buttons
   that navigate (not links). On desktop the right column holds "Kelimelerin" and "Kısa yollar".
2. **Goals left Bugün.** The old goals card (day goal, level, level path, decks) is split: an
   unset day goal shows a small `GoalPrompt` (10/15/20 dk); a set goal is a "Hedeflerin" row in
   "Kısa yollar" with today's minutes. The level lives on Profil; `levelPath` and its test were
   removed. "Desteler" moved to "Kelime Bankası" (`/decks?tab=bank`).
3. **One note frame.** `features/home/HomeNote.tsx` (IconTile, title, body, actions, close) is
   used by the load, FSRS opt-in, level, interests, streak-freeze and stage-rule notes.
4. **Card faces.** Part of speech as a Turkish outline `Badge`; the example sentence in an
   "Örnek" panel with its Turkish line and a TTS button; pictures as before. The Turkish meaning
   is sans; English stays serif (`Term`). The primary speaker is a tonal round button.
5. **Rating bar on `ui/RatingButton`.** The confirm-after-wrong-answer guard is unchanged; its
   prompt ("emin misin?") and the stage-change hint now use the new optional `note` prop.
6. **Summary.** `ProgressRing` with a check, `StatRow` (Kelime, Süre, Hatırlama), per-rating bars,
   and a new "Aşama değişenler" list from the pure `stageChanges(answers)` in
   `features/review/study.ts` (recognition cards only, last answer wins; unit-tested). The
   closing button says "Bitir" (was "Ana ekrana dön").
7. **Practice, hands-free, leech** use `Card`, `Button`, `Icon`, `ListGroup`, `StatRow` and type
   tokens only. The hands-free dim overlay keeps a true black (`#000`) inline style on purpose
   (OLED off in both themes).

## src/ui additions (additive only; no API or token changed)

- `icon-paths.tsx`: `bulb`, `minus-circle`, `slow`, `play`, `skip-next`, `stop`.
- `RatingButton`: optional `note?: ReactNode`, a caption line under the interval.

## Not used

No Dexie version (41 stays free) and no Supabase migration (20261103003000–3400 unused).

## Consequences

`homeIcons.tsx`, `Ring.tsx`, `GoalsCard.tsx` and `DecksForYou.tsx` are gone. e2e: the summary
closes with "Bitir"; the level is checked on Profil; Bugün is checked by its heading, not a sync
pill.
