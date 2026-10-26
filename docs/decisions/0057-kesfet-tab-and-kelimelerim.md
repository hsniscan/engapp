# 0057 — Keşfet as a tab, Kelimelerim, İlerleme on Profil (v0.5.1)

## Context

The v0.5 review (plan/v0.5.1-toparlama-raporu.md, section 2) found Desteler carrying four
segments (Destelerim, Keşfet, Kelime bankası, Okuma): "Kelime bankası" wrapped on a phone, the
graded library had no entry point of its own, and Keşfet showed six "Yakında" tiles that did
nothing. The redesign's tab bar had İlerleme, a screen people look at now and then, while the
place to browse every day was buried. The owner chose: Bugün · Kelimelerim · (+) · Keşfet ·
Profil, with İlerleme at the top of Profil.

## Decision

1. **Tab bar** (`src/ui/nav.ts`): `/` · `/decks` (Kelimelerim) · (+) · `/kesfet` · `/profile`.
   `/library` belongs to Kelimelerim; `/kitaplik` and `/oku/*` to Keşfet; `/progress` and
   `/settings/*` to Profil; `/add` and `/import/*` (the (+) flows) to no tab.
2. **Kelimelerim** (`/decks`) shows only the user's own things in two segments: Destelerim
   (all words, decks, tags, theme grouping, import) and Kelime bankası. Theme grouping is
   offered from `MIN_THEME_WORDS` words on (or while a preview waits). Import opens the (+)
   sheet at its import group.
3. **Keşfet** (`/kesfet`) is a feed with filter chips Hepsi · Okuma · Desteler · Kelimeler
   (`?f=okuma|desteler|kelimeler`). The feed model and its order are pure
   (`src/domain/discoverFeed.ts`): each entry has a kind, a stable key, a category (the chip),
   a slot (`lead` = what the user was doing, `daily` = mixed by a hash of the day key and the
   entry key within a weight, neighbours of different categories on Hepsi, `tail` = shelves)
   and a weight. Picks of the day (word, false friend) are `dailyPickWhere` over a fixed list,
   so they stay all day and move to the next item once taken. A future "Paylaşılanlar" is one
   more kind (`shared`) with a category; nothing else changes. Filters show their feed cards and
   then the full list of the category (Okuma: Metinlerim + the graded library; Desteler: every
   suggested deck), and leave out feed kinds that full list already shows.
   Everything comes from content that exists: no tile without a working target.
4. **İlerleme** stays a full page at `/progress`, reached from a summary card at the top of
   Profil and from Bugün's numbers.
5. **Old addresses** redirect (`src/app/redirects.ts`): `/kitaplik` → `/kesfet?f=okuma`,
   `/decks?tab=discover` → `/kesfet?f=desteler`, `/decks?tab=reading` → `/kesfet?f=okuma`
   (the `/decks` route redirects in its loader; other tabs stay). The reader's ✕ goes to
   `/kesfet?f=okuma`.
6. **Offline / no server copy** says what will happen ("İnternet gelince yüklenecek ·
   Tekrar dene"), never how the app was built.

## Why

Browsing is the daily habit worth a tab; statistics are a look-up. Keeping the feed's order in
a small pure function makes the daily variety deterministic and testable and lets shared
content join later without reworking the page. No schema change (no Dexie version, no
migration).
