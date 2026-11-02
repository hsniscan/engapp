# Engapp design system — v0.5.2 "Çam"

Engapp is a calm study tool for Turkish speakers learning English: closer to a good notebook and
a good dictionary than to a game. v0.5.2 replaces the whole visual identity (owner's decision
"Her şey yeni", 2026-11-01; ADR 0065). This file is the spec wave-2 screen agents implement.

Source of truth: `src/ui/` (components), `src/ui/tokens/tokens.css` (colours),
`src/ui/tokens/fonts.css` (fonts), `src/index.css` (Tailwind theme: type, radii, elevation,
motion). Live reference (dev builds): `/dev/ui` (every component; `?split=1` = light and dark side
by side) and `/dev/preview?screen=today|card|words|reader` (mock-ups of key screens built only
from `src/ui`). Owner preview images: `/mnt/project-files/engapp/yeni-tasarim-v052/`.

## 1. Principles

1. **One next step per screen.** Each screen region has at most one filled pine button. Everything
   else is secondary, tonal, ghost, a list row or a chip.
2. **Two voices.** Everything the learner _learns_ (English words, IPA, examples, reading texts)
   is set in **Literata**. Everything the _app says_ (titles, labels, Turkish meanings, numbers)
   is **Instrument Sans**. A glance tells "content" from "chrome". Use `<Term>` for English.
3. **Porcelain and pine.** A cool, slightly green-grey porcelain ground (light) and a green-black
   slate (dark). One accent, pine. No gradients, glass, emoji, mascots, confetti or sparkles.
4. **Flat, then float.** Structure comes from spacing and hairlines. Only things that float above
   the page (the study card, sheets, menus, toasts) have shadows.
5. **One meaning, one encoding.** One stage colour scale, one rating colour map, one "studied day"
   colour, one settings icon, one page title style — everywhere.
6. **Colour never carries meaning alone.** Ratings carry labels and intervals; stages carry their
   names; charts have a text table; reader marks have a screen-reader description.
7. **Quiet when fine, explicit when not.** Sync is an icon when fine and a labelled pill when not.
   Reversible actions happen at once and offer "Geri al" (toast) instead of asking first.
8. **360 px first.** Every layout is designed at 360 × 780 and must not truncate a label there;
   rows of chips scroll sideways instead of wrapping or cutting.

## 2. Identity

### Palette

| Role                            | Light                                                                            | Dark                              | Use                                              |
| ------------------------------- | -------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------ |
| `canvas`                        | `#f3f4f1`                                                                        | `#101312`                         | page background, tab bar                         |
| `surface`                       | `#fafbf9`                                                                        | `#171b1a`                         | cards, list groups                               |
| `surface-raised`                | `#ffffff`                                                                        | `#1e2321`                         | study card, sheets, dialogs, menus               |
| `surface-sunken`                | `#e9ece6`                                                                        | `#0b0d0c`                         | wells, segmented track, progress track, skeleton |
| `border` / `border-strong`      | `#dde1da` / `#7d847c`                                                            | `#2b312e` / `#6e7772`             | hairlines / inputs, checkboxes                   |
| `fg` / `fg-muted` / `fg-subtle` | `#141a17` / `#4b544e` / `#5d6660`                                                | `#e6ebe8` / `#a3aca7` / `#8f9893` | ink                                              |
| `accent` (pine)                 | `#1f5c4f`                                                                        | `#2b7765`                         | primary button, progress, İyi, focus (light)     |
| `accent-text`                   | `#1f5c4f`                                                                        | `#88cdb9`                         | links, selected text, tonal labels               |
| `accent-soft`                   | `#e0ece7`                                                                        | `#19302a`                         | tonal button, accent card, new-word mark         |
| `accent-on-inverse`             | `#88cdb9`                                                                        | `#1f5c4f`                         | "Geri al" on the toast                           |
| status                          | success `#3a7a2c`, warn `#a86b00`, danger `#b03a24` (each with `-text`, `-soft`) |                                   |                                                  |

Why pine: it is calm and scholarly, reads well at small sizes, has no "fintech purple/indigo"
or "AI gradient" connotation, and works as both a fill (white text, 7.8:1 light / 5.3:1 dark)
and a light text colour on slate (10:1). Dark mode is its own theme (not an inversion): a deeper
fill so white text stays AA, and a lighter pine for text and focus.

### Stage scale (ONE, everywhere)

Sequential pine ramp. Light theme goes light → deep; dark theme dim → bright (always "more
learned = more contrast"). `Yeni` is neutral and drawn with a hairline ring.

| Stage     | Token                 | Light              | Dark               |
| --------- | --------------------- | ------------------ | ------------------ |
| Yeni      | `stage-new`           | `#d5d9d2` (+ ring) | `#3a413d` (+ ring) |
| Öğreniyor | `stage-learning`      | `#b6d6cb`          | `#2a4f45`          |
| Pekişiyor | `stage-consolidating` | `#73ad9c`          | `#3b8771`          |
| Öğrenildi | `stage-learned`       | `#2b7563`          | `#6cc0a8`          |
| Kalıcı    | `stage-mastered`      | `#143a32`          | `#c4ebde`          |

Use only via `StagePill`, `StageBar`, `stageBg[stage]`, `stageColor[stage]` (`src/ui/stage-scale.ts`).
Labels come from `ui.stage.*`. Delete per-screen stage colours (StagesSection's taupe/green,
deckUi.ts hex values, WordsCard).

### Rating map (ONE, everywhere)

| Rating  | Button                                                     | Dot / bar              | Label on surface    |
| ------- | ---------------------------------------------------------- | ---------------------- | ------------------- |
| Tekrar  | `rating-again-soft` fill, `rating-again-text` label (rust) | `rating-again`         | `rating-again-text` |
| Zor     | `rating-hard-soft`, `rating-hard-text` (ochre)             | `rating-hard`          | `rating-hard-text`  |
| **İyi** | **filled `accent`, white label** (the expected answer)     | `rating-good` (= pine) | `rating-good-text`  |
| Kolay   | `rating-easy-soft`, `rating-easy-text` (slate blue)        | `rating-easy`          | `rating-easy-text`  |

Code: `ratingLook` in `src/ui/rating.ts`; `RatingButton`/`RatingBar` read it. The session summary,
stats legends and any chart must use `ratingLook[r].dot` / `.text` — never their own colours.

### "Studied day"

`heat-completed` (pine) = goal met that day, `heat-active` = studied but under goal, `heat-empty`
= nothing. Used by `HeatStrip` (week strip on Bugün/Profil, heatmap on İlerleme). No white dots,
no blue squares, no green heat.

### Typography

| Font                                            | Package                                          | Role                                 |
| ----------------------------------------------- | ------------------------------------------------ | ------------------------------------ |
| **Instrument Sans** (variable 400–700)          | `@fontsource-variable/instrument-sans` (OFL 1.1) | UI, titles, Turkish text, numbers    |
| **Literata** (variable 200–900, roman + italic) | `@fontsource-variable/literata` (OFL 1.1)        | English words, IPA, examples, reader |

Both are free for commercial use and embedding (SIL OFL), self-hosted (`fonts.css`), latin +
latin-ext only (ı is in latin; ğ ş İ in latin-ext), loaded per unicode-range, precached by the
PWA. Instrument Sans gives a precise, slightly narrow, modern-editorial voice (not the
ubiquitous Inter/Geist look); Literata was designed for long reading on screens and has a true
italic for example sentences. Turkish glyphs (İ ı Ğ ğ Ş ş Ç ç Ö ö Ü ü) are checked in the gallery.
`<html lang="tr">` keeps CSS `uppercase` correct ("TÜM KELİMELERİM").

Type scale (Tailwind utilities, from `@theme`):

| Utility        | Size / line       | Weight       | Use                                                         |
| -------------- | ----------------- | ------------ | ----------------------------------------------------------- |
| `text-numeral` | 48 / 1.0, −0.03em | 600          | the one big number of a card (248 kelime)                   |
| `text-display` | 40 / 1.1          | 600 Literata | the term on the study card                                  |
| `text-page-lg` | 32 / 38           | 600          | page title ≥ 768 px                                         |
| `text-page`    | 28 / 34, −0.02em  | 600          | page title (h1) on phones                                   |
| `text-heading` | 24 / 30           | 600          | card-back meaning, word detail term, numbers in StatTile    |
| `text-title`   | 20 / 26           | 600          | section titles (h2), sheet/dialog titles, empty-state title |
| `text-reading` | 19 / 1.75         | 400 Literata | reader body                                                 |
| `text-lead`    | 17 / 26           | 400–500      | intro sentences, example sentence, term in rows             |
| `text-body`    | 16 / 24           | 400          | long text                                                   |
| `text-ui`      | 15 / 22           | 500–600      | buttons, list titles, controls (the default UI size)        |
| `text-meta`    | 13 / 18           | 400–600      | descriptions, secondary lines, chips                        |
| `text-caption` | 12 / 16           | 600          | eyebrows (caps, 0.08em), tab labels, badges, axis labels    |

No arbitrary font sizes (`text-[0.9375rem]` etc.) in new code. Numbers use `.tabular`.

### Radii (ONE scale)

`xs 4` (bars, heat cells) · `sm 8` (segments, small tiles) · `control 12` (= `md`; buttons,
inputs, segmented track, icon tiles) · `inner 16` (= `lg`; tiles inside a card) · `card 20`
(= `xl`; all cards, list groups) · `sheet 28` (= `3xl`; sheet top corners) · `full` (chips,
badges, pills, icon buttons, avatars). Tailwind's own names (`rounded`, `-sm`…`-4xl`) are
redefined onto this scale in `@theme`, so no radius class can silently compile to nothing again
(v0.5.1 review K-1). Arbitrary radii (`rounded-[14px]`, `rounded-[18px]`, `rounded-[20px]`) are
retired: map 14→`control`/`inner`, 18/20→`card`.

Guard: `src/ui/tailwind-classes.test.ts` compiles every `rounded-*`/`shadow-*` class in `src`
with the real theme and fails on a class that produces no CSS.

### Elevation

| Level | Utility                                   | Use                                                |
| ----- | ----------------------------------------- | -------------------------------------------------- |
| e0    | none                                      | everything on the page (cards are flat + hairline) |
| e1    | `shadow-sm` (= `xs`)                      | selected segment, switch thumb                     |
| e2    | `shadow-md` (= `shadow`, `shadow-raised`) | the study card, raised cards                       |
| e3    | `shadow-lg` (= `shadow-overlay`)          | sheets, dialogs, menus, toasts                     |
| e4    | `shadow-xl` / `2xl`                       | reserved                                           |

Shadows are tinted green-black in light mode and deep black in dark mode (`--shadow-color*`).

### Spacing and layout

4 px base (Tailwind spacing). Rhythm: 8 inside a control group, 12 between list items/chips,
16–20 card padding (`Card padding="md"`), 24–32 hero cards (`padding="lg"`), **32 between page
sections** (`gap-8`). Page gutters 16 (phone) / 24 (≥640) / 40 (≥1024).
Content widths: `--page-wide` 64rem for every tab and list screen; `--page-reading` 40rem for
forms, settings sub-pages, the study card and the reader. All tabs share one left edge.

Breakpoints: phone < 768 (tab bar), 768–1023 (88 px rail), ≥ 1024 (240 px sidebar). On ≥ 1024,
tab pages may use a 2-column grid (`lg:grid-cols-[minmax(0,1fr)_20rem]`): main column left,
secondary cards right, both starting at the top; never a lone tall hero beside a stack.

### Motion

Tiers: micro 120 ms (press, toggle), medium 280 ms (page enter, card flip, sheet), large 520 ms
(progress ring, summary). Easing `ease-standard` cubic-bezier(.2,0,0,1), exits `ease-exit`.
Page enter: fade + 6 px rise. Press: `scale(.98)` only under `motion-safe`. Reduced motion: only
short opacity fades; the ring and bars snap. No bouncy springs, no confetti.

### Iconography

One set: `src/ui/icon-paths.tsx`, 24 px grid, 1.6 px stroke (2 px when active/selected), round
caps and joins. v0.5.2 merged the settings and home glyphs into it (`bell`, `clock`,
`database`, `cloud`, `flame`, `calendar`, `list`, `code`, `target`, `loop`, `pen`, `cloze`,
`globe`). `SettingsGlyph.tsx`, `homeIcons.tsx` and inline `<svg>` icons in features are to be
deleted in wave 2. **Settings is always `settings` (sliders), never a gear.** Icons sit in an
`IconTile` (40 px, radius 12, neutral or accent-soft well) when they lead a row.

### Logo

The "ˈe" mark (IPA stress tick + serif e outline, paths in `src/ui/brand/mark.ts`) stays as a
shape, now on a **pine tile** (`accent`) with a white e and a pale-pine tick; the wordmark is
Instrument Sans 600. Follow-up (owner/agent E): regenerate `public/icons/*` and the Android
launcher icons with `pnpm icons` after updating the colours in `mark.ts`; `capacitor.config.ts`
`iconColor` → `#1f5c4f`.

## 3. Components (`import { … } from '@/ui'`)

| Component                    | What / rules                                                                                                                                                                                                                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button` / `buttonClasses()` | variants `primary` (one per region), `secondary` (outlined), `tonal` (soft pine), `ghost`, `danger` (destructive confirm only). Sizes `sm` 36 (44 hit) · `md` 44 · `lg` 52 (main CTA, sticky bars). Radius 12, weight 600. Links that look like buttons use `buttonClasses`. **No hand-rolled `bg-accent text-accent-fg` buttons.** |
| `IconButton`                 | round, 44 px (`sm`: 36 + 44 hit). `ghost` default, `secondary`, `tonal` (speaker), `primary`. `label` is required (tooltip + aria-label).                                                                                                                                                                                           |
| `Card`                       | `tone`: `default` (surface + hairline) · `raised` (study card) · `sunken` (well) · `accent` (the ONE highlighted card) · `outline` · `placeholder` (dashed). `padding` sm/md/lg, `interactive` for whole-card links (`as={Link} to=…`), `inset` = radius 16 for tiles inside cards. Replaces `Surface` (deprecated adapter).        |
| `PageFrame` + `TabHeader`    | the ONE page frame/title: optional `eyebrow`, h1 (`text-page` → `text-page-lg`), `description`, ≤2 `actions`, `back` link for sub-pages, `width` wide/reading. Replaces `Page` (deprecated adapter) and all 20 hand-rolled h1s.                                                                                                     |
| `SectionHeader`, `Eyebrow`   | h2 20 px + optional eyebrow, one-line description, one ghost action ("Tümü"). Eyebrow = 12 px caps 0.08em `fg-muted` (the only eyebrow recipe).                                                                                                                                                                                     |
| `ListGroup` + `ListRow`      | rows on one card with hairlines. Row: min 56 px; `leadingIcon` (IconTile) or `leading` node; title (`term` = Literata, lang en); description (2 lines max); `meta`; `trailing` (Switch, Badge, StagePill); `to` → Link, `onClick` → button, both get a chevron. `IconTile` exported for tiles elsewhere.                            |
| `SegmentedControl`           | 44 px segments on a sunken track; 2–3 views of the same place (Destelerim/Kelime Bankası, theme).                                                                                                                                                                                                                                   |
| `Tabs`                       | underlined (pine indicator), 44 px; sections of one page (İlerleme).                                                                                                                                                                                                                                                                |
| `Chip`, `ChipRow`            | 36 px pill + 44 hit area; filters and quick choices; selected = ink fill (`fg`). `ChipRow` scrolls sideways on phones (`bleed` off inside cards); never truncates.                                                                                                                                                                  |
| `Badge`                      | 24 px status pill (neutral/accent/success/warn/danger/outline). Not interactive.                                                                                                                                                                                                                                                    |
| `StagePill`, `StageBar`      | stage label + swatch; distribution bar (10 px, 2 px gaps) + legend with counts, `role="img"` sentence. `stages` prop to omit Yeni.                                                                                                                                                                                                  |
| `ProgressRing`               | circular progress, sunken track, pine arc; centre slot.                                                                                                                                                                                                                                                                             |
| `ProgressBar`                | linear, 6/10 px, sunken track.                                                                                                                                                                                                                                                                                                      |
| `StatTile`, `StatRow`        | value on top (24 px tabular) + label under it (+ hint), so values share a baseline even when a label wraps; `StatRow` = tiles on one card with dividers.                                                                                                                                                                            |
| `BarChart`                   | visible bars: scaled to max(values, `minScale`), never to a distant capacity; non-zero ≥ 4 px, zero = 2 px stub; `reference` line only if it fits; `highlight` bar (today) strong, others muted; sr-only table.                                                                                                                     |
| `HeatStrip`                  | studied-day squares; `strip` (7-day) or `grid` (heatmap).                                                                                                                                                                                                                                                                           |
| `Dialog`                     | responsive: sheet < 640, centred ≥ 640. Title 20 px sans. `modal={false}` = no scrim, page usable. Confirmations and short forms.                                                                                                                                                                                                   |
| `Sheet`                      | always a bottom sheet (centred max 36rem on desktop), radius 28, handle: (+) Ekle, reader word sheet, pickers.                                                                                                                                                                                                                      |
| `toast()`, `toast.undo()`    | dark inverse pill above the tab bar. `toast.undo({ title, onUndo, undoLabel: t('ui.undo') })` for every reversible action (delete, suspend, mark known, remove from deck) instead of a confirm dialog. 6 s.                                                                                                                         |
| `EmptyState`                 | icon well (accent-soft; danger-soft for `tone="error"`) · title 20 · one sentence · one action. `tone` plain/card/placeholder/error, `compact` inside sections. Replaces 17 hand-rolled dashed boxes.                                                                                                                               |
| `Skeleton`                   | sunken blocks with a gentle pulse; pair with `aria-busy` on the region. Mirror the real layout (title line, 3 lines, a button).                                                                                                                                                                                                     |
| `RatingButton`, `RatingBar`  | the answer bar (see Rating map); 64 px buttons, label + interval, 1–4 key hints on desktop.                                                                                                                                                                                                                                         |
| `Term`                       | English text in Literata with `lang="en"`; sizes display/title/lead, `italic` for examples.                                                                                                                                                                                                                                         |
| `TabBar`, `SideRail`         | app navigation (used by `AppShell`). See Shell.                                                                                                                                                                                                                                                                                     |
| unchanged                    | `TextField`, `TextArea`, `Select`, `Switch` (a whole row), `Checkbox`, `Slider`, `DropdownMenu`, `Tooltip` (now `collisionPadding` 8), `Kbd`, `Spinner`, `SyncStatus`, `FlipCard`, `ThemeSwitcher`, `Logo`.                                                                                                                         |

Deprecated (keep building, migrate in wave 2, delete after): `Surface` → `Card`, `Page` →
`PageFrame`, feature-local `SettingsGlyph`/`HomeIcon`, `features/review/RatingBar.tsx` →
`ui/RatingBar`, feature `deckUi.ts` colour constants → stage tokens.

### Shell

- **Phone tab bar** (`TabBar`): five equal slots, 64 px + safe area, `canvas` at 95% with blur,
  hairline top. Active tab: ink label 600 + a soft `selected` pill behind the icon (stroke 2).
  **(+) Ekle** sits in the middle slot at the same height: a tonal pill (`accent-soft`, pine
  icon) with the "Ekle" label — no raised ink-black FAB, so it never competes with a screen's
  primary button and never overlaps sticky CTAs (`--nav-fab-rise` is now 0). While the Add
  sheet is open or on an Add flow, the pill fills pine.
- **Rail / sidebar** (`SideRail`): logo; **Ekle** first, as a tonal button; then Bugün,
  Kelimelerim, Keşfet, Profil; sync status at the bottom.
- **Immersive** (study, practice, level test): no navigation; a 56 px bar with a round ✕.

## 4. Screen blueprints

Notation: top-to-bottom order; `[Component]`; **Remove** lists what v0.5.1 had that goes.
Every tab page = `PageFrame width="wide"`; every sub-page = `PageFrame width="reading" back=…`.

### 4.1 Bugün (`/`)

1. `TabHeader` eyebrow = date ("Pazar, 1 Kasım"), title = greeting ("Günaydın, Hasan"). No actions (sync lives in the rail/Profil).
2. **Today card** `[Card padding=lg]` (not a blue slab):
   row: `[ProgressRing 76]` (centre: remaining count + "kalan") · title "Bugünün çalışması" (20) + meta "18 kart · yaklaşık 9 dk";
   `[ChipRow bleed=false]` mode chips with counts (Tekrar 12 · Yeni 6 · Boşluk doldurma 3) — each starts that mode;
   `[Button lg fullWidth trailingIcon=arrow-right]` "Çalışmaya başla" (the screen's only primary);
   hairline, then `[HeatStrip]` (7 days) + "5 günlük seri" (flame icon, `warn` colour).
   Done state: ring full with a check, title "Bugünlük tamam", button becomes `secondary` "Biraz daha çalış".
3. Backup/sync warnings: a `Card tone="sunken"` row inside the same column, never a full-width banner of its own width.
4. `SectionHeader` "Kelimelerin" + ghost "Tümü" → `[Card]` meta line + `[StageBar stages=learning…mastered]`.
5. `SectionHeader` "Bugünün okuması" → `[Card interactive as=Link]` eyebrow (level · minutes · new words), `Term size=title` text title, 2-line Literata excerpt.
6. `SectionHeader` "Kısayollar" → `[ListGroup]` rows: Zorlandıkların (warn tile, meta count), Kelime Bankası (accent tile), Hedefler (target).
7. Goals (10/15/20 dk) live in Ayarlar → Çalışma; on Bugün only as a `ChipRow` inside an empty-goal prompt card.
   Desktop ≥1024: 2 columns — left: Today card, Bugünün okuması; right (20rem): Kelimelerin, Kısayollar.
   **Remove:** full-bleed blue hero, eyebrow "BUGÜNÜN ÇALIŞMASI", white dots, `bg-[rgb(0_0_0/.2)]` chips, square goal chips, duplicate streak line.

### 4.2 Çalış picker (`/study`, `/study/more`)

`PageFrame reading back="Bugün"` title "Çalış". `[ListGroup]` of modes: Tekrar, Yeni kelimeler, Boşluk doldurma, Üretim (pen), Dinleme (speaker), Yazım (dictation) — `IconTile` + title + one-line description + meta count. A disabled mode shows the reason as its description, not a toast. Sticky bottom: `[Button lg fullWidth]` only when a choice needs confirming (multi-select); keep 16 px above the safe area. **Remove:** inline SVG icons, hand-rolled 52 px CTAs.

### 4.3 Study card (front, back, rating bar)

Immersive. Top bar 56 px: round ✕ (`IconButton`), `[ProgressBar]` flex-1, counter "12 / 30" (meta, tabular).
**Card** `[Card tone=raised padding=lg]` fills the space between bar and answer area (`flex-1`) on both faces — no layout jump on flip (review O-1). Content is vertically centred:

- Front: `StagePill` top-left, speaker `IconButton tonal` top-right; centre `Term display` + IPA (Literata, muted) + POS `Badge outline`. Below the card: `[Button lg fullWidth secondary]` "Cevabı göster" (Space).
- Back: same header; term + IPA; hairline; `Eyebrow` "Anlamı" + meaning (`text-heading`, sans — Turkish); `Eyebrow` "Örnek" + example (`Term italic`, 17) + Turkish translation (`text-ui` muted); picture (if any) as a `rounded-inner` image under the example, max 160 px tall.
- **Rating bar** `[RatingBar]` replaces "Cevabı göster" in the same slot: 4 equal 64 px buttons, İyi filled.
  Desktop: card max 40rem, centred; key hints visible.
  **Remove:** RatingBar in features with its own colours, card-back empty band.

### 4.4 Session summary

Immersive, `PageFrame reading`. `[ProgressRing 96]` with a check · title "Bugünkü çalışman kaydedildi" (page) · meta (minutes, cards). `[StatRow]`: Kart · Doğru % · Süre. "Cevapların" `[Card]`: one horizontal bar per rating using `ratingLook[r].dot` + label + count. "Aşama değişenler" `[ListGroup]` rows (`term` + `StagePill` new stage). Bottom: primary "Bitir", ghost "Biraz daha çalış". **Remove:** green İyi / blue Kolay inversion.

### 4.5 Kelimelerim (`/decks`)

1. `TabHeader` "Kelimelerim", action: search `IconButton`.
2. `[SegmentedControl hideLegend]` Destelerim | Kelime Bankası (44 px).
3. "Tüm kelimelerim" `[Card interactive padding=lg]`: `Eyebrow` + `text-numeral` count + "kelime", chevron; `[StageBar]` (all five).
4. `SectionHeader` "Destelerim" + ghost sm "Yeni deste" (plus).
5. `[ListGroup]` decks: leading 40 px accent-soft tile with the deck initial, title, description ("42 kelime · 6 tekrar bekliyor"), trailing `Badge accent` "6 tekrar" + chevron.
6. No decks → `[EmptyState tone=placeholder compact]` "Kendi desteni oluştur".
7. Suggested decks (Keşfet owns discovery): at most one `Card` link "Hazır destelere göz at".
   **Remove:** custom 40 px tabs with hand-coded shadow, square "+" tile, square AI theme tile, deck illustration (keep only on Tüm kelimelerim empty state), `light-dark(#9dbde3,…)` inline colours.

### 4.6 Tüm kelimelerim (`/library`)

`PageFrame wide back="Kelimelerim"` title "Tüm kelimelerim", description count. `[TextField leadingIcon=search]` sticky under the header (canvas background). `[ChipRow]` stage filters (`Chip` with `StagePill`-coloured dot + count) and "Askıda". `[ListGroup]` rows: `term` title, meaning description, trailing `StagePill`. Long lists virtualised. Swipe/overflow `DropdownMenu`: Düzenle, Askıya al, Sil (→ `toast.undo`). Empty search → `EmptyState compact`.

### 4.7 Word detail (sheet on phones, `/library?word=` page on desktop)

`Sheet` (phone) / `PageFrame reading` (desktop). Header: `Term size=title` + IPA + speaker `IconButton tonal`; `StagePill` + POS `Badge`. Meaning `text-heading`. Examples: list of `Term italic` + translation. "Hafıza" `[Card sunken]`: next review, interval, reviews, lapses (`StatRow` bare tiles). Picture (if pre-generated). Actions row: secondary "Düzenle", ghost "Askıya al", ghost danger-text "Sil" (→ undo toast). **Remove:** "Yapay zekâ ile örnek/resim üret" buttons (feature removed, ADR 0061).

### 4.8 Kelime Bankası (`/decks?tab=bank`)

Same frame as Kelimelerim with the segment on Kelime Bankası. `[ChipRow]` level filter (A1…C1, "Seviyene göre" selected by default) and topic chips. `[ListGroup]` rows: `term`, meaning, trailing tonal `IconButton` plus ("Ekle") that becomes a check; adding shows `toast.undo`. Count summary `Eyebrow` above the list.

### 4.9 Deck detail (`/decks/:id`, suggested `/decks/suggested/:key`)

`PageFrame wide back="Kelimelerim"` title = deck name, actions: `DropdownMenu` (Yeniden adlandır, Sil). `[Card padding=lg]`: `[StatRow]` (Kelime · Tekrar bekleyen · Öğrenilen) + `[StageBar]` + primary "Bu desteyi çalış". `SectionHeader` "Kelimeler" + `[ListGroup]` as Tüm kelimelerim. Suggested deck: same, primary "Kelimelerime ekle", level `Badge`s instead of stages. **Remove:** square "En sık"/"Seviyene göre" badges (use `Badge`).

### 4.10 (+) Ekle sheet

`Sheet` title "Ekle". Top: `[TextField]` "Kelime ya da ifade yaz" + primary sm "Ekle" (the fast path). `Eyebrow` "Metinden kelime çıkar" then a **2-column grid** of `[Card interactive inset padding=sm]` tiles (icon in `IconTile neutral`, label wraps to 2 lines, never ellipsis): Metin yapıştır · Bağlantı · Fotoğraf · Altyazı · Metin oluştur; on ≥ 400 px 3 columns. `Eyebrow` "İçe aktar": `[ListGroup]` Anki, CSV. **Remove:** five-in-a-row truncated tiles ("Bağla…", "Fotoğ…"), green `success-soft` icon wells.

### 4.11 Capture / preview screens (`/add`, `/makale`, `/altyazi`, `/fotograf`, `/metin-olustur`, `/import/*`)

`PageFrame reading back="Ekle"` with the source as title. Input step: one field/area + primary "Kelimeleri bul" (sticky `lg` at the bottom on phones). Preview step: `Eyebrow` count ("23 kelime bulundu"), `[ChipRow]` filters (Yeni · Zaten var · Bilinen), `[ListGroup]` rows with `Checkbox` leading, `term` title, meaning description, trailing `Badge` (Zaten var). Sticky bottom bar (surface, hairline top): count + primary "Seçilenleri ekle". Progress (OCR, import): `ProgressBar md` + one sentence; failure → `EmptyState tone=error` with retry.

### 4.12 Keşfet feed (`/kesfet`, `/kitaplik`)

`TabHeader` "Keşfet". `[ChipRow]` Tümü · Metinler · Desteler · Kelimeler (scrolls; never cut off at 360). Feed of `[Card interactive]` items, 16 px apart:

- Text: `Eyebrow` (level · minutes · new words), `Term size=title` title, 2-line Literata excerpt, optional `rounded-inner` image (16:9).
- Suggested deck: `IconTile accent` + name + count + `Badge`s.
- Word of the day: `Term size=title` + meaning + tonal "Ekle".
  Offline / backend missing → `EmptyState tone=card` "Bağlantı kurulamadı" + secondary "Tekrar dene". Loading → 3 skeleton cards mirroring the text card. Desktop: 2-column card grid.

### 4.13 Reader (`/oku/:textId`) and word sheet

Top bar 56 px (canvas 95% + blur, hairline): back `IconButton`, text title (ui 600, centred, truncated), `settings` `IconButton` (text size, theme). Body `max-w-(--page-reading)`, gutter 20: `Eyebrow` meta, Literata h1 (`text-heading`), paragraphs `font-serif text-reading` 20 px apart.
Word marks are **buttons** (`<button type="button">`, inline, `rounded-xs`): new word = `accent-soft` fill + dotted pine underline; learning = solid pine underline at 60%; known = no mark (still tappable, roving tabindex per sentence). Each mark has `aria-describedby` → hidden "yeni kelime" / "öğrendiğin kelime". Tapped word: 2 px focus-colour ring while its sheet is open.
**Word sheet** = `Sheet modal={false}` (the text stays tappable): `Term size=title` + IPA in the title; `StagePill` + POS + speaker (tonal sm); meaning (`text-title`); example (`Term italic`) + translation; actions: primary "Kelimelerime ekle", secondary "Biliyorum". End of text: `Card accent` with "6 yeni kelime ekledin" + primary "Bunları çalış".

### 4.14 Profil (`/profile`)

`TabHeader` title = name, eyebrow = plan/level ("B1 · Misafir"), action: `settings` `IconButton` only if Ayarlar is not a row below (choose ONE: keep the row, drop the header icon). Avatar 56 px circle (initial, accent-soft). `[StatRow]` Öğrenilen · Seri (gün) · Hatırlama (%) — labels under values (O-7). "Son 7 gün" `[Card]`: `[HeatStrip]` + one sentence. `[ListGroup]`: İlerleme (chart), Hedefler (target), Ayarlar (settings), Yardım ve geri bildirim. Sync status row at the bottom (`SyncStatus` as trailing). **Remove:** gear icon, blue 7-day squares.

### 4.15 İlerleme (`/progress`)

`PageFrame wide back="Profil"` title "İlerleme". `[Tabs]` Genel · Kelimeler · Takvim.

- Genel: `[StatRow]` (Bu hafta öğrenilen · Doğru % · Çalışılan gün); "Önümüzdeki 30 gün" `[Card]` `[BarChart minScale=max(5, 25% of capacity) reference=capacity labelEvery=5]` with today highlighted; "Cevapların" rating bars via `ratingLook`.
- Kelimeler: `[StageBar]` (all five) + rule sentence; per-stage `[ListGroup]` rows (`StagePill` leading, count meta, chevron to filtered Tüm kelimelerim).
- Takvim: `[HeatStrip layout=grid]` + legend; "Günlere göre liste" as a `ListGroup` (44 px rows), not a 20 px `<summary>`.

### 4.16 Ayarlar index (`/settings`) and sub-page (`/settings/:section`)

Index: `PageFrame reading back="Profil"` title "Ayarlar". `[ListGroup label=…]` groups — Çalışma (Günlük hedef, Yük, Bildirimler `bell`, Seviye), Görünüm (Tema `ThemeSwitcher` row, Metin boyutu), Hesap (Hesap, Eşitleme `cloud`, Hesabı sil), Veri (Yedek `database`, İçe/dışa aktar), Hakkında (`info`, Gizlilik). Each row: `IconTile neutral` + title + current value as `meta` + chevron.
Sub-page: `PageFrame reading back="Ayarlar"`; controls in `ListGroup`s: `Switch` rows (whole row is the target), `Slider` in a padded `Card`, `SegmentedControl` for 2–3 choices, `Select` for more; explanations as the group `footer`. Destructive actions last, `Button danger` inside a `Dialog` confirm (irreversible only).
**Remove:** `SettingsGlyph`, coloured tile tones per row (all neutral; only warnings use `warn`).

### 4.17 Onboarding (`/` first run, level test)

Full-screen steps, `PageFrame reading`, no tab bar: step indicator (`ProgressBar` sm + "1 / 3"), `text-page` question, `text-lead` one-sentence why. Choices as `[ListGroup]` of selectable rows (`aria-pressed`, check trailing) or `[ChipRow]` for interests (wrap allowed here). Sticky `[Button lg fullWidth]` "Devam" + ghost "Atla". Welcome step: `Logo 48` + "Kelimeleri kalıcı öğrenmeye başlayalım" + 3 numbered rows (numbers in 32 px accent-soft circles). Level test: study-card frame with 4 answer `Card interactive` options.

### 4.18 Auth (`/auth`)

`PageFrame reading` centred vertically on desktop. `Logo 40`, title "Giriş yap", lead sentence. `[Button lg fullWidth secondary leadingIcon=google]`, divider "ya da", `TextField` e-posta + primary "E-posta ile bağlantı gönder". Guest note as `text-meta` + ghost "Misafir olarak devam et". Errors inline under the field (`danger-text`), not toasts.

### 4.19 Empty, loading, error states

- **Empty:** `EmptyState` (page) or `EmptyState compact tone=placeholder` (section). Title says what is missing, one sentence says why it matters, one action fixes it.
- **Loading:** `Skeleton` blocks that mirror the final layout; `aria-busy="true"` on the region; spinner only inside buttons (`loading`).
- **Error:** `EmptyState tone=error` (or `tone=card` for offline): what happened, what is safe ("Kelimelerin cihazında güvende"), secondary "Tekrar dene". Route errors use the same component in a `PageFrame`.
- **Reversible actions:** do it, then `toast.undo`. Irreversible (account delete, reset history): `Dialog` with `danger` confirm.

## 5. Accessibility rules

- WCAG 2.2 AA: text 4.5:1, non-text 3:1 (table below, `pnpm contrast`), axe clean (`pnpm ui-qa`).
- Targets ≥ 44 × 44 (chips and small buttons extend their hit area with `hit-44` / `after:`).
- One h1 per page (`TabHeader`); sections are h2 (`SectionHeader`).
- Focus ring 2 px `focus`, offset 2, never removed; `scroll-padding` keeps focus clear of bars.
- `lang="en"` on every English word/sentence (`Term`, `ListRow term`); document is `lang="tr"`.
- Meaning never by colour alone (labels, intervals, stage names, sr-only chart tables, reader mark descriptions).
- Reduced motion honoured by tokens and `motion-safe:`.

## 6. Contrast (measured, `node scripts/check-contrast.ts --md`)

| Foreground            | Background          | Use                                   | Need  | Light | Dark  |
| --------------------- | ------------------- | ------------------------------------- | ----- | ----- | ----- |
| `fg`                  | `canvas`            | body text                             | 4.5:1 | 15.99 | 15.49 |
| `fg`                  | `surface`           | text on cards                         | 4.5:1 | 17.00 | 14.41 |
| `fg`                  | `surface-raised`    | text in dialogs/menus                 | 4.5:1 | 17.65 | 13.22 |
| `fg-muted`            | `canvas`            | secondary text                        | 4.5:1 | 7.10  | 8.02  |
| `fg-muted`            | `surface`           | secondary text on cards               | 4.5:1 | 7.56  | 7.46  |
| `fg-muted`            | `surface-sunken`    | badge / segmented control             | 4.5:1 | 6.58  | 8.37  |
| `fg-subtle`           | `canvas`            | placeholders, quiet sync status       | 4.5:1 | 5.38  | 6.30  |
| `fg-subtle`           | `surface`           | input placeholder                     | 4.5:1 | 5.72  | 5.86  |
| `fg-inverse`          | `fg`                | toast, tooltip                        | 4.5:1 | 17.00 | 15.49 |
| `accent-fg`           | `accent`            | primary button                        | 4.5:1 | 7.77  | 5.34  |
| `accent-fg`           | `accent-hover`      | primary button hover                  | 4.5:1 | 9.77  | 6.39  |
| `accent-text`         | `canvas`            | links                                 | 4.5:1 | 7.04  | 10.21 |
| `accent-text`         | `surface`           | links on cards                        | 4.5:1 | 7.49  | 9.50  |
| `accent-text`         | `accent-soft`       | accent badge                          | 4.5:1 | 6.41  | 7.67  |
| `danger-fg`           | `danger`            | danger button                         | 4.5:1 | 6.04  | 4.91  |
| `danger-fg`           | `danger-hover`      | danger button hover                   | 4.5:1 | 7.72  | 6.00  |
| `danger-text`         | `surface`           | field error                           | 4.5:1 | 6.46  | 8.01  |
| `danger-text`         | `surface-raised`    | danger menu item                      | 4.5:1 | 6.70  | 7.34  |
| `danger-text`         | `danger-soft`       | danger badge / highlighted item       | 4.5:1 | 5.55  | 6.78  |
| `success-text`        | `success-soft`      | success badge                         | 4.5:1 | 6.14  | 8.39  |
| `warn-text`           | `warn-soft`         | warning badge                         | 4.5:1 | 6.19  | 8.35  |
| `rating-again-text`   | `surface`           | Tekrar label                          | 4.5:1 | 6.76  | 8.69  |
| `rating-again-text`   | `rating-again-soft` | Tekrar label (hover)                  | 4.5:1 | 5.83  | 7.25  |
| `rating-hard-text`    | `surface`           | Zor label                             | 4.5:1 | 6.60  | 10.44 |
| `rating-hard-text`    | `rating-hard-soft`  | Zor label (hover)                     | 4.5:1 | 5.92  | 8.57  |
| `rating-good-text`    | `surface`           | İyi label                             | 4.5:1 | 7.49  | 9.50  |
| `rating-good-text`    | `rating-good-soft`  | İyi label (hover)                     | 4.5:1 | 6.41  | 7.67  |
| `rating-easy-text`    | `surface`           | Kolay label                           | 4.5:1 | 7.49  | 9.67  |
| `rating-easy-text`    | `rating-easy-soft`  | Kolay label (hover)                   | 4.5:1 | 6.47  | 8.31  |
| `fg-muted`            | `rating-again-soft` | interval on hovered button            | 4.5:1 | 6.52  | 6.22  |
| `fg-muted`            | `rating-easy-soft`  | interval on hovered button            | 4.5:1 | 6.53  | 6.41  |
| `focus`               | `canvas`            | focus ring                            | 3:1   | 7.04  | 10.21 |
| `focus`               | `surface`           | focus ring on cards                   | 3:1   | 7.49  | 9.50  |
| `border-strong`       | `surface`           | input / checkbox border               | 3:1   | 3.70  | 3.76  |
| `accent`              | `surface-sunken`    | progress fill, switch on              | 3:1   | 6.52  | 3.65  |
| `rating-again`        | `surface`           | Tekrar hue bar                        | 3:1   | 4.58  | 5.86  |
| `rating-hard`         | `surface`           | Zor hue bar                           | 3:1   | 3.50  | 7.46  |
| `rating-good`         | `surface`           | İyi hue bar                           | 3:1   | 7.49  | 6.47  |
| `rating-easy`         | `surface`           | Kolay hue bar                         | 3:1   | 5.81  | 6.02  |
| `heat-completed`      | `canvas`            | heatmap: completed day                | 3:1   | 7.04  | 8.67  |
| `heat-completed`      | `heat-active`       | heatmap: completed vs active          | 3:1   | 4.63  | 4.64  |
| `hero-muted`          | `accent`            | home hero: secondary text             | 4.5:1 | 6.41  | 4.94  |
| `hero-action-fg`      | `hero-action`       | home hero: Devam et                   | 4.5:1 | 12.04 | 11.75 |
| `hero-ring`           | `accent`            | home hero: progress ring, week dots   | 3:1   | 4.54  | 4.17  |
| `stage-learned`       | `surface`           | stage bar: Öğrenildi                  | 3:1   | 5.29  | 8.06  |
| `stage-mastered`      | `surface`           | stage bar: Kalıcı                     | 3:1   | 12.04 | 13.48 |
| `stage-consolidating` | `stage-mastered`    | stage bar: Pekişiyor vs Kalıcı        | 3:1   | 4.87  | 3.33  |
| `accent-text`         | `surface-raised`    | links in dialogs                      | 4.5:1 | 7.77  | 8.71  |
| `accent-text`         | `surface-sunken`    | selected segment / chip text          | 4.5:1 | 6.52  | 10.66 |
| `fg-muted`            | `surface-raised`    | secondary text in sheets              | 4.5:1 | 7.84  | 6.84  |
| `fg-muted`            | `accent-soft`       | meta on tonal chip                    | 4.5:1 | 6.47  | 6.02  |
| `accent-fg`           | `accent`            | İyi: filled answer button (bg-accent) | 4.5:1 | 7.77  | 5.34  |
| `rating-again-text`   | `rating-again-soft` | Tekrar on its tinted button           | 4.5:1 | 5.83  | 7.25  |
| `chart-bar`           | `surface`           | chart bars                            | 3:1   | 7.49  | 8.06  |
| `heat-completed`      | `surface`           | studied day on cards                  | 3:1   | 7.49  | 8.06  |
| `border-strong`       | `surface-raised`    | input border in sheets                | 3:1   | 3.84  | 3.45  |
| `success-text`        | `surface`           | success text                          | 4.5:1 | 6.93  | 10.12 |
| `warn-text`           | `surface`           | warning text                          | 4.5:1 | 7.00  | 10.18 |
| `accent-on-inverse`   | `fg`                | toast action (Geri al)                | 4.5:1 | 9.65  | 6.44  |

## 7. Strings, theme, QA

- UI text only via i18next (`tr.json`/`en.json`, typed keys). Shared component strings live under
  `ui.*` (stage names, undo, chart headers); gallery/preview strings under `dev.*`.
- Theme: every colour once as `light-dark()`; `<html data-theme="system|light|dark">`;
  `src/ui/theme/theme.ts` applies it; `index.html` paints the stored theme before first paint;
  `theme-color` = canvas (`#f3f4f1` / `#101312`). Tailwind's palette is off (`--color-*: initial`).
- QA: `pnpm typecheck`, `pnpm lint`, `pnpm test` (includes the dead-class guard),
  `pnpm contrast`, `pnpm ui-qa [baseUrl]` (axe on gallery, preview screens and the shell),
  `node scripts/design-preview.ts [baseUrl] [outDir]` (owner screenshots, 390 px light/dark).
