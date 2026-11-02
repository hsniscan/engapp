# 0065 — v0.5.2 design system "Çam": new identity, one scale for everything

## Context

The 2026-11-01 design review (`plan/gelistirme-raporu-2026-11/teknik-notlar/tasarim.md`) found
that most of what looked unfinished was drift, not taste: ~30 `rounded-*`/`shadow-*` classes that
compiled to nothing because `@theme` reset radius and shadow (K-1), conflicting rating colours
(İyi blue on the answer bar, green in the summary, Y-1), three stage palettes (Y-6), a second
radius scale (14/18/20 px, Y-2), hand-made buttons and tabs (Y-3), page titles from 20 to 36 px
(Y-4), a raised ink-black (+) competing with the accent (O-4), a busy blue hero (O-2), a card back
40% empty (O-1), flat forecast bars (O-6), two settings icons (O-3).

The owner first asked to redesign the UI from scratch keeping the brand, then (22:49 UTC) chose
**"Her şey yeni"**: a completely new identity — palette, typography, shapes, components — still
calm, premium, simple, not childish, not generic, perfect Turkish, WCAG AA, excellent dark mode.

## Decision

1. **Identity "Çam" (pine).** Cool porcelain ground (`#f3f4f1`) and green-black slate dark theme
   (`#101312`); one accent, pine (`#1f5c4f` light fill, `#2b7765` dark fill, `#88cdb9` dark
   text). Pine is calm and scholarly and avoids the purple/indigo/gradient look of generic AI
   products. All tokens in `src/ui/tokens/tokens.css` (same token names as before plus
   `stage-new`, `chart-bar*`, `accent-on-inverse`), contrast-checked in both themes.
2. **Two typefaces, two voices.** Instrument Sans (UI, titles, Turkish, numbers) and Literata
   (English words, examples, reader), both SIL OFL 1.1 via `@fontsource-variable/*`,
   self-hosted, latin + latin-ext subsets, variable weight. `@fontsource/source-serif-4` is
   removed. Rule: what the learner learns is Literata (`<Term>`), what the app says is sans.
3. **One scale each.** One type scale (`text-caption` … `text-numeral`), one radius scale
   (4/8/12/16/20/28/full) with Tailwind's own names redefined onto it, four elevation levels with
   `shadow-sm/md/lg/xl` mapped onto them, one stage colour ramp, one rating map (`ratingLook`:
   Tekrar rust, Zor ochre, **İyi = filled pine**, Kolay slate blue), one "studied day" colour.
4. **Guard against silent CSS.** `src/ui/tailwind-classes.test.ts` compiles every `rounded-*` /
   `shadow-*` class used in `src` with the real theme and fails when one produces no rule.
5. **Shared components** in `src/ui`: `Card`, `PageFrame`/`TabHeader`, `SectionHeader`/`Eyebrow`,
   `ListGroup`/`ListRow`/`IconTile`, `Chip`/`ChipRow`, `StagePill`/`StageBar`, `ProgressRing`,
   `StatTile`/`StatRow`, `BarChart`/`HeatStrip`, `Sheet`, `toast.undo`, `RatingBar`, `Term`,
   `TabBar`/`SideRail`, a `tonal` button variant, non-modal dialogs. `Surface` and `Page` stay as
   deprecated adapters so every existing screen builds unchanged.
6. **Calmer navigation.** The (+) is a tonal pill inside the tab bar at tab height with an
   "Ekle" label (no raised FAB; `--nav-fab-rise` = 0); in the rail it is the first, tonal item.
7. **Blueprints.** `docs/design.md` §4 specifies every main screen for the wave-2 agents
   (component names, section order, what is removed). `/dev/preview` shows four of them built
   only from `src/ui`.

## Why

A new identity only reads as "premium" if it is applied with no drift; the review showed drift,
not the old palette, was the problem. So the change is the palette and type *plus* single scales,
a guard test and shared components that make the consistent choice the easy one. Keeping token
names and component APIs lets the identity land everywhere at once without touching feature code
in wave 1, while wave 2 rebuilds screens from the blueprints.

## Consequences

- Every screen picks up the new colours, fonts, radii and nav immediately; feature-level hard-coded
  values (`rounded-[20px]`, `text-[0.9375rem]`, `deckUi.ts` hex colours, serif page titles) remain
  until wave 2 rebuilds each screen.
- App icons (`public/icons/*`, Android launcher, `mark.ts` colours, `capacitor.config.ts`
  `iconColor`) still show the old ink tile; regenerate with `pnpm icons` once `mark.ts` takes the
  pine colours (owner of android/PWA assets).
- Font payload: ~41 KB (sans) + ~95 KB per Literata style (roman, italic), loaded on demand by
  unicode-range; previously ~116 KB for Source Serif 4.
