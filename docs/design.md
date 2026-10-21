# Engapp design system

The UI is a calm, editorial study tool: closer to a good dictionary than to an app with points and confetti. A word on a card should feel like an entry in a well-set reference book. Everything else gets out of its way.

Source of truth: `src/ui/` (components), `src/ui/tokens/tokens.css` (colours), `src/index.css` (Tailwind theme mapping, type, radii, motion). Live reference: `pnpm dev` → `/dev/ui` (dev builds only; `/dev/ui?split=1` shows light and dark side by side).

## Principles

1. **One thing per screen.** Each screen has one obvious next action, usually the only filled (accent) button.
2. **Ink on paper.** Warm off-white paper and a warm charcoal for the dark theme, never pure white on black and never blue-grey. Text is ink-coloured.
3. **One accent.** Ink blue (`accent`) marks the primary action, focus, progress, selection and links. Nothing else is blue except the "Kolay" rating.
4. **Colour never carries meaning alone.** Rating buttons carry a label and the interval. Status badges carry words. The heatmap has text equivalents.
5. **No decoration for its own sake.** No gradients, glass, emoji, confetti, mascots or illustrations. Hairline borders and spacing do the structuring. Shadows appear only on things that float (the review card, menus, dialogs).
6. **Quiet when fine, explicit when not.** The sync indicator is just an icon when everything is synced and becomes a labelled pill when changes are waiting, the app is offline, or sync failed.

## Theme mechanics

- Every colour is written once as `light-dark(<light>, <dark>)` in `tokens.css`. The browser picks a branch from `color-scheme`.
- `<html data-theme="system|light|dark">`: `system` follows the OS (`color-scheme: light dark`), and the others pin it. The production build turns `light-dark()` into Lightning CSS's variable fallback (Safari < 17.5). This was checked in `pnpm preview`: all four OS × preference combinations resolve correctly.
- `src/ui/theme/theme.ts` is the seam:
  - `getThemePreference()` reads `localStorage['engapp.theme']`.
  - `setThemePreference(pref)` persists the preference and applies it.
  - `applyTheme(pref)` sets `data-theme` and the `<meta name="theme-color">` tags. It does not persist.
  - `initTheme()` runs at startup and follows OS changes and other tabs.
  - `useTheme()` is the React hook.
    When the settings table owns the preference, replace the two storage lines in `get/setThemePreference` and call `applyTheme` when settings load. `ThemePreference` equals `ThemePref` in `src/domain/types.ts`.
- `index.html` runs a tiny inline script before first paint, so the stored theme never flashes. Two `theme-color` metas (one per `prefers-color-scheme`) colour the PWA and browser chrome. A pinned theme overwrites both.
- Tailwind's default palette is **switched off** (`--color-*: initial`). Only semantic tokens exist, so `bg-purple-500` does not compile to anything. A `dark:` variant exists for rare cases. Tokens already switch on their own, so components should not need it.

## Palette

Light values are a warm paper scale. Dark values are a warm charcoal scale with a slightly lifted card colour, so surfaces read without shadows. Utilities: `bg-<token>`, `text-<token>`, `border-<token>`, `ring-<token>`. CSS: `var(--<token>)`.

| Token                                                               | Light     | Dark      |
| ------------------------------------------------------------------- | --------- | --------- |
| `canvas`                                                            | `#f5f2ec` | `#1a1917` |
| `surface`                                                           | `#fdfcf9` | `#22201d` |
| `surface-raised`                                                    | `#ffffff` | `#2a2825` |
| `surface-sunken`                                                    | `#ede9e1` | `#161513` |
| `border`                                                            | `#e3ddd2` | `#34312d` |
| `border-strong`                                                     | `#8c8476` | `#78726a` |
| `fg`                                                                | `#1f1d1a` | `#ece6dc` |
| `fg-muted`                                                          | `#5e5850` | `#a79f93` |
| `fg-subtle`                                                         | `#6f695f` | `#938c81` |
| `fg-inverse`                                                        | `#fdfcf9` | `#1a1917` |
| `accent`                                                            | `#2a5a8c` | `#3b6c9e` |
| `accent-hover`                                                      | `#224a74` | `#335f8c` |
| `accent-fg`                                                         | `#ffffff` | `#ffffff` |
| `accent-text`                                                       | `#2a5a8c` | `#9dbde3` |
| `accent-soft`                                                       | `#e6edf5` | `#253244` |
| `focus`                                                             | `#2a5a8c` | `#9dbde3` |
| `success`                                                           | `#2e8c6a` | `#4fae8a` |
| `success-text`                                                      | `#1b6a4e` | `#7fcdae` |
| `success-soft`                                                      | `#e6f1eb` | `#1f3129` |
| `warn`                                                              | `#b97f0e` | `#d6a03e` |
| `warn-text`                                                         | `#7f5300` | `#e8c27a` |
| `warn-soft`                                                         | `#f7efdc` | `#352c1c` |
| `danger`                                                            | `#a63a2b` | `#b8493a` |
| `danger-hover`                                                      | `#8e3123` | `#a53f31` |
| `danger-fg`                                                         | `#ffffff` | `#ffffff` |
| `danger-text`                                                       | `#a63a2b` | `#f0907e` |
| `danger-soft`                                                       | `#f8e9e5` | `#3a2420` |
| `rating-again`                                                      | `#c8582a` | `#e07a50` |
| `rating-again-text`                                                 | `#9c3f1b` | `#f0a585` |
| `rating-again-soft`                                                 | `#f8ebe4` | `#3a2620` |
| `rating-hard`                                                       | `#b97f0e` | `#d6a03e` |
| `rating-hard-text`                                                  | `#7f5300` | `#e8c27a` |
| `rating-hard-soft`                                                  | `#f7efdc` | `#352c1c` |
| `rating-good`                                                       | `#2e8c6a` | `#4fae8a` |
| `rating-good-text`                                                  | `#1b6a4e` | `#7fcdae` |
| `rating-good-soft`                                                  | `#e6f1eb` | `#1f3129` |
| `rating-easy`                                                       | `#3270a8` | `#5e9ad3` |
| `rating-easy-text`                                                  | `#245a8c` | `#9cc3ea` |
| `rating-easy-soft`                                                  | `#e5edf5` | `#1f2b38` |
| `heat-empty`                                                        | `#e6e1d7` | `#2c2a27` |
| `heat-active`                                                       | `#9fcfb9` | `#2f6150` |
| `heat-completed`                                                    | `#1f7556` | `#63c49f` |
| `logo-tick`                                                         | `#9dbde3` | `#2a5a8c` |
| --scrim: light-dark(rgb(31 29 26 / 0.36), rgb(0 0 0 / 0.6));        |
| --shadow-color: light-dark(rgb(60 48 30 / 0.1), rgb(0 0 0 / 0.45)); |

Non-hex helpers (not in the contrast table): `scrim` (overlay behind dialogs, `light-dark(rgb(31 29 26 / .36), rgb(0 0 0 / .6))`), `shadow-color`, and three interaction overlays defined in `index.css`: `hover` (ink at 6% alpha), `selected` (ink at 9%) and `surface-hover` (surface mixed 5% toward ink). Overlays work on any surface in both themes. Use them for hover and highlighted/selected rows instead of a fixed grey.

**Roles in short**

- `canvas` is the page.
- `surface` is a card on the page.
- `surface-raised` is anything that floats: the review card, dialogs, menus. It is pure white in light mode, like an index card.
- `surface-sunken` is used for wells: segmented-control tracks, skeletons, neutral badges and the empty heatmap day.
- `border` is a hairline divider. `border-strong` outlines inputs, checkboxes and switches (≥ 3:1).
- `fg` is the main text, `fg-muted` is secondary text, and `fg-subtle` is used for placeholders and the quiet sync icon. All three pass 4.5:1.
- `accent` is a fill and pairs with `accent-fg`. `accent-text` is the accent used as text or icon on surfaces. It is lighter in dark mode.
- `success`, `warn` and `danger` each come in three versions: a graphic version, a `-text` version and a `-soft` fill.
- `heat-*` steps come from one Okabe-Ito hue (bluish green), as the plan requires.

## Contrast (measured)

`node scripts/check-contrast.ts` parses `tokens.css` and checks these pairs. It exits non-zero when a pair fails, so run it after every palette change. Text needs 4.5:1 (WCAG AA, normal text). Non-text UI (the focus ring, input borders, the rating hue bars, heatmap steps) needs 3:1.

| Foreground          | Background          | Use                             | Need  | Light | Dark  |
| ------------------- | ------------------- | ------------------------------- | ----- | ----- | ----- |
| `fg`                | `canvas`            | body text                       | 4.5:1 | 15.05 | 14.15 |
| `fg`                | `surface`           | text on cards                   | 4.5:1 | 16.39 | 13.09 |
| `fg`                | `surface-raised`    | text in dialogs/menus           | 4.5:1 | 16.81 | 11.84 |
| `fg-muted`          | `canvas`            | secondary text                  | 4.5:1 | 6.29  | 6.71  |
| `fg-muted`          | `surface`           | secondary text on cards         | 4.5:1 | 6.85  | 6.21  |
| `fg-muted`          | `surface-sunken`    | badge / segmented control       | 4.5:1 | 5.81  | 6.97  |
| `fg-subtle`         | `canvas`            | placeholders, quiet sync status | 4.5:1 | 4.87  | 5.28  |
| `fg-subtle`         | `surface`           | input placeholder               | 4.5:1 | 5.30  | 4.88  |
| `fg-inverse`        | `fg`                | toast, tooltip                  | 4.5:1 | 16.39 | 14.15 |
| `accent-fg`         | `accent`            | primary button                  | 4.5:1 | 7.14  | 5.49  |
| `accent-fg`         | `accent-hover`      | primary button hover            | 4.5:1 | 9.13  | 6.65  |
| `accent-text`       | `canvas`            | links                           | 4.5:1 | 6.39  | 9.05  |
| `accent-text`       | `surface`           | links on cards                  | 4.5:1 | 6.96  | 8.37  |
| `accent-text`       | `accent-soft`       | accent badge                    | 4.5:1 | 6.05  | 6.69  |
| `danger-fg`         | `danger`            | danger button                   | 4.5:1 | 6.44  | 5.18  |
| `danger-fg`         | `danger-hover`      | danger button hover             | 4.5:1 | 8.03  | 6.26  |
| `danger-text`       | `surface`           | field error                     | 4.5:1 | 6.28  | 6.96  |
| `danger-text`       | `surface-raised`    | danger menu item                | 4.5:1 | 6.44  | 6.30  |
| `danger-text`       | `danger-soft`       | danger badge / highlighted item | 4.5:1 | 5.45  | 6.19  |
| `success-text`      | `success-soft`      | success badge                   | 4.5:1 | 5.64  | 7.35  |
| `warn-text`         | `warn-soft`         | warning badge                   | 4.5:1 | 5.84  | 8.13  |
| `rating-again-text` | `surface`           | Tekrar label                    | 4.5:1 | 6.52  | 8.07  |
| `rating-again-text` | `rating-again-soft` | Tekrar label (hover)            | 4.5:1 | 5.73  | 7.05  |
| `rating-hard-text`  | `surface`           | Zor label                       | 4.5:1 | 6.52  | 9.62  |
| `rating-hard-text`  | `rating-hard-soft`  | Zor label (hover)               | 4.5:1 | 5.84  | 8.13  |
| `rating-good-text`  | `surface`           | İyi label                       | 4.5:1 | 6.36  | 8.70  |
| `rating-good-text`  | `rating-good-soft`  | İyi label (hover)               | 4.5:1 | 5.64  | 7.35  |
| `rating-easy-text`  | `surface`           | Kolay label                     | 4.5:1 | 7.02  | 8.83  |
| `rating-easy-text`  | `rating-easy-soft`  | Kolay label (hover)             | 4.5:1 | 6.09  | 7.81  |
| `fg-muted`          | `rating-again-soft` | interval on hovered button      | 4.5:1 | 6.02  | 5.43  |
| `fg-muted`          | `rating-easy-soft`  | interval on hovered button      | 4.5:1 | 5.95  | 5.49  |
| `focus`             | `canvas`            | focus ring                      | 3:1   | 6.39  | 9.05  |
| `focus`             | `surface`           | focus ring on cards             | 3:1   | 6.96  | 8.37  |
| `border-strong`     | `surface`           | input / checkbox border         | 3:1   | 3.61  | 3.42  |
| `accent`            | `surface-sunken`    | progress fill, switch on        | 3:1   | 5.90  | 3.32  |
| `rating-again`      | `surface`           | Tekrar hue bar                  | 3:1   | 4.19  | 5.47  |
| `rating-hard`       | `surface`           | Zor hue bar                     | 3:1   | 3.35  | 6.93  |
| `rating-good`       | `surface`           | İyi hue bar                     | 3:1   | 4.03  | 6.00  |
| `rating-easy`       | `surface`           | Kolay hue bar                   | 3:1   | 5.09  | 5.45  |
| `heat-completed`    | `canvas`            | heatmap: completed day          | 3:1   | 5.03  | 8.30  |
| `heat-completed`    | `heat-active`       | heatmap: completed vs active    | 3:1   | 3.24  | 3.37  |

All 41 pairs pass in both themes. Where a hue could not reach 4.5:1 as text (for example Okabe-Ito orange on paper), the design system follows the plan's rule: the saturated hue is used only for the bar or icon (≥ 3:1), and the label uses a darker or lighter `-text` variant of the same hue.

### Answer buttons (Tekrar / Zor / İyi / Kolay)

The plan's Okabe-Ito mapping is kept, but the colours are muted:

| Rating         | Hue                    | Bar (light / dark)    | Label (light / dark)  |
| -------------- | ---------------------- | --------------------- | --------------------- |
| Tekrar (again) | vermilion `#D55E00`    | `#c8582a` / `#e07a50` | `#9c3f1b` / `#f0a585` |
| Zor (hard)     | orange `#E69F00`       | `#b97f0e` / `#d6a03e` | `#7f5300` / `#e8c27a` |
| İyi (good)     | bluish green `#009E73` | `#2e8c6a` / `#4fae8a` | `#1b6a4e` / `#7fcdae` |
| Kolay (easy)   | blue `#0072B2`         | `#3270a8` / `#5e9ad3` | `#245a8c` / `#9cc3ea` |

Anatomy: a neutral `surface` button with a hairline border and a short 3 px hue bar inset at the top edge. The label is set in the rating's `-text` colour, with the interval below in `fg-muted`. On hover the button fills with the rating's `-soft` tint. On wide screens with a keyboard, a small 1–4 key hint sits in the corner. The accessible name reads "Tekrar, sonraki tekrar: 1 dk".

## Typography

- **UI: system sans** (`system-ui`, SF Pro, Segoe UI, Roboto…). It costs no bytes, renders natively and handles Turkish perfectly.
- **Headwords, card terms, meanings, page titles: Source Serif 4** (`font-serif`), self-hosted from `@fontsource/source-serif-4`.
  - _Why this face:_ it is a text serif drawn for reading at all sizes, with a calm, slightly literary voice. It has a full Turkish character set (ı İ ğ ş) and a full IPA set (ə ɪ ʃ ˈ), which pronunciation lines need. It has a true italic for example sentences. It is OFL licensed. It avoids the trendy display serifs (Fraunces, Playfair) that read as "startup".
  - _Cost:_ only the latin and latin-ext subsets, three faces (400, 400 italic, 600) and woff2 only: 6 files, about 116 KB in total. They are declared by hand in `src/ui/tokens/fonts.css` with `unicode-range`, so a page loads only the subsets it uses. Fontsource's per-subset CSS files have no `unicode-range` and would load everything. The files are emitted as hashed assets that the PWA precache picks up, so the font works offline. `font-display: swap` falls back to Iowan Old Style or Georgia.
- **Scale** (rem/px, line height):

| Use                        | Class                                               | Size                |
| -------------------------- | --------------------------------------------------- | ------------------- |
| Card term (phone → ≥640px) | `font-serif text-4xl sm:text-display font-semibold` | 36 → 40 px, lh 1.15 |
| Page title (h1)            | `font-serif text-3xl md:text-4xl font-semibold`     | 30 → 36 px          |
| Section / dialog title     | `font-serif text-2xl` / `text-xl font-semibold`     | 24 / 20 px          |
| Meaning on card back       | `font-serif text-3xl font-semibold`                 | 30 px               |
| Example sentence           | `font-serif text-lg italic`                         | 18 px               |
| Body                       | `text-base`                                         | 16 px / 24          |
| UI controls                | `text-[0.9375rem]`                                  | 15 px               |
| Secondary                  | `text-sm text-fg-muted`                             | 14 px / 20          |
| Captions, badges           | `text-xs`                                           | 12 px               |

Inputs always use 16 px, so iOS does not zoom on focus. Counters use `.tabular` (tabular numerals). Set `lang="en"` on English terms and examples so screen readers use the English voice.

## Space, size, shape

- **4 px grid** (Tailwind's default spacing: `1` = 4 px). Page gutters are 16 px on phones and 24 px from 640 px up. Content is up to 40 rem wide for reading screens (`Page width="reading"`) and 64 rem for lists and stats (`width="wide"`).
- **Touch targets ≥ 44 px.**
  - Buttons `md`, icon buttons, nav items, menu and select rows, and segmented options are 44 px or taller.
  - `sm` buttons and icon buttons are 36 px visually, but a transparent `::after` extends the hit area to 44 px.
  - Checkboxes and switches sit in 44 px rows with an extended hit area.
- **Radii.** The plan's 12 px is refined into three steps, so controls stay crisp and containers soft:
  - `rounded-control` = 8 px for buttons, inputs and menu rows
  - `rounded-card` = 12 px for cards, the review card, dialogs and menus
  - `rounded-sheet` = 16 px for the top corners of bottom sheets
  - `rounded-sm` = 4 px for badges and kbd
  - `rounded-full` for switches and pills
- **Elevation.** There are two shadows: `shadow-raised` for the review card and `shadow-overlay` for dialogs, menus and toasts. In dark mode they are darker but barely visible, so the lifted `surface-raised` colour does the work.

## Motion

| Tier   | Duration                                      | Used for                                                                            |
| ------ | --------------------------------------------- | ----------------------------------------------------------------------------------- |
| micro  | 120 ms (`--duration-micro`, `duration.micro`) | button press (scale .98), hover colour, switch thumb, tooltip/menu pop (150 ms)     |
| medium | 280 ms (`--duration-medium`)                  | card flip, page transition (fade + 6 px rise), progress fill, bottom sheet (300 ms) |
| large  | 520 ms (`--duration-large`)                   | reserved for the session summary                                                    |

- Easing is `cubic-bezier(0.2, 0, 0, 1)` (`ease-standard`), a quick start with a long, soft landing. Exits use `ease-exit` and are shorter than entrances.
- **Reduced motion:** the CSS animation tokens are redefined as short opacity fades. `motion` components check `useReducedMotion()`: the card flip becomes a 150 ms crossfade, and page transitions become opacity only. Press scaling is `motion-safe:` only.
- TS mirror: `import { duration, ease } from '@/ui'`.

## Accessibility rules

- **Focus.** The focus ring is never removed: a 2 px `focus` outline with a 2 px offset on `:focus-visible`, everywhere. Inputs add an accent border.
- **Landmarks.**
  - The shell has a skip link ("İçeriğe geç"), `<main id="main">`, and `nav` labelled "Ana gezinme".
  - Every page has exactly one `h1`. `Page` renders it, and `hideTitle` keeps it for screen readers only.
  - After navigation, focus moves to `<main>` and the page scrolls to the top.
- **Flip card.** The back face is a polite `aria-live` region. It mounts only when flipped, so the answer is read automatically. The hidden face gets `aria-hidden` and `inert`. A card click is only a pointer convenience. The review screen must also offer the "Cevabı göster" button and the Space key, as the placeholder does.
- **Icons.** Icons are decorative (`aria-hidden`) unless they have a `label`. Every `IconButton` requires a `label`, which becomes its `aria-label` and a tooltip.
- **Sync status.** `SyncStatus` is `role="status"`, so changes are announced politely, and its full sentence is always in the accessible name.
- **axe** (WCAG 2.2 A/AA plus best practices) reports **0 violations** across these pages:
  - Pages: `/dev/ui` (normal, flipped, dialog open), `/`, `/review`, `/library`, `/settings` and `/auth`
  - Conditions: both themes, at 360 px and 1280 px

  Run it with `pnpm ui-qa`.

## Components (import from `@/ui`)

All components are typed function components. Those that render a single DOM element accept `ref` as a prop (React 19). `className` _extends_ a component's styles. There is no tailwind-merge, so do not pass a class that conflicts with a built-in one (e.g. a second `display` or `height`); use the component's props instead.

| Component                     | API (main props)                                                                                                        | Rules                                                                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Button`                      | `variant: primary｜secondary｜ghost｜danger`, `size: sm｜md｜lg`, `loading`, `leadingIcon`, `trailingIcon`, `fullWidth` | One `primary` per view. `lg` (56 px) for the main call to action ("Tekrara başla", "Cevabı göster"). `danger` only for confirmed destructive actions inside a dialog. `loading` keeps the label and sets `aria-busy`.                |
| `buttonClasses(opts)`         | same options                                                                                                            | Style a router `<Link>` as a button.                                                                                                                                                                                                 |
| `IconButton`                  | `icon`, `label` (required), `variant: ghost｜secondary｜primary`, `size: sm｜md`, `pressed`, `tooltip`                  | Use for toolbar actions. Use `pressed` for toggles (audio).                                                                                                                                                                          |
| `Icon`                        | `name`, `size`, `label?`, `strokeWidth`                                                                                 | 24-px grid with a 1.6 px stroke. Sizes 16/18/20/22/24.                                                                                                                                                                               |
| `Surface`                     | `tone: flat｜raised｜sunken`, `padding: none｜sm｜md｜lg`, `as`                                                         | The generic "card". `raised` only for things that float.                                                                                                                                                                             |
| `TextField` / `TextArea`      | `label` (required), `hint`, `error`, `optional`, `hideLabel`, `leadingIcon` + native props                              | Labels always render (`hideLabel` only for search). Errors replace the hint and are linked via `aria-describedby`. Mark optional fields; required is the default.                                                                    |
| `Select`                      | `label`, `options[]`, `value/defaultValue`, `onValueChange`, `placeholder`                                              | Radix Select with a popper and check marks.                                                                                                                                                                                          |
| `Switch`                      | `label`, `description`, `checked/defaultChecked`, `onCheckedChange`                                                     | A settings row; the whole label is clickable. Takes effect immediately; never needs "save".                                                                                                                                          |
| `Checkbox`                    | `label`, `description`, `checked` (incl. `'indeterminate'`), `hideLabel`                                                | Use for multi-select (bulk actions in Kartlar).                                                                                                                                                                                      |
| `Slider`                      | `label`, `value/defaultValue`, `min`, `max`, `step`, `format`                                                           | Shows its value. `format` also feeds `aria-valuetext` (e.g. `%90`).                                                                                                                                                                  |
| `SegmentedControl`            | `legend`, `options[{value,label,icon?}]`, `value`, `onValueChange`                                                      | 2–4 mutually exclusive options. Built on native radios (arrow keys work).                                                                                                                                                            |
| `ThemeSwitcher`               | `className`                                                                                                             | Sistem / Açık / Koyu, wired to `useTheme`.                                                                                                                                                                                           |
| `Tabs`                        | `label`, `items[{value,label,icon?,content}]`, `value/defaultValue`                                                     | Underlined editorial tabs (Kart ekle: Elle / Metin yapıştır / PDF yükle).                                                                                                                                                            |
| `Dialog`                      | `title`, `description`, `trigger?`, `open/onOpenChange`, `footer`, `variant: responsive｜sheet｜dialog`, `hideClose`    | `responsive` (default) is a bottom sheet below 640 px and a centred dialog above. Footer buttons stack full width on phones, with the primary on top. Wrap footer buttons in `DialogClose asChild` to close.                         |
| `DropdownMenu`                | `trigger`, `items[{label,icon,onSelect,danger,shortcut,disabled}｜{kind:'separator'}]`, `align`, `label`                | The "more" menu in review (edit, suspend, undo). Put the danger item last, after a separator.                                                                                                                                        |
| `Tooltip` / `TooltipProvider` | `content`, `side`                                                                                                       | Supplementary only; the provider is mounted in `App`.                                                                                                                                                                                |
| `toast()` / `Toaster`         | `toast({title, description?, tone: neutral｜success｜warn｜danger, duration?, action?})` → `id`; `toast.dismiss(id)`    | An imperative queue, callable from anywhere (sync engine, service-worker update). At most 3 toasts. It sits above the bottom nav on phones and at bottom-right on desktop. Use `duration: Infinity` for "Yeni sürüm hazır — yenile". |
| `Badge`                       | `tone: neutral｜accent｜success｜warn｜danger｜outline`, `dot`                                                          | Card state and confidence. Always words, never colour alone.                                                                                                                                                                         |
| `ProgressBar`                 | `value`, `max`, `label`, `valueText`, `size`                                                                            | The review session bar.                                                                                                                                                                                                              |
| `Skeleton`                    | `className` or `lines`                                                                                                  | Loading placeholders; set `aria-busy` on the region.                                                                                                                                                                                 |
| `Spinner`                     | `size`, `label?`                                                                                                        | Pulses under reduced motion.                                                                                                                                                                                                         |
| `EmptyState`                  | `icon`, `title`, `description`, `action`                                                                                | One sentence that says what to do next.                                                                                                                                                                                              |
| `Kbd`                         | `size: sm｜md`                                                                                                          | Key hints; show only with `pointer-fine:`.                                                                                                                                                                                           |
| `FlipCard` + `CardFace`       | `front`, `back`, `flipped`, `onFlip?`, `minHeight`                                                                      | See the accessibility rules. Re-key it per card (`key={card.id}`) so the next card starts face up without animating back.                                                                                                            |
| `RatingButton`, `ratings`     | `rating: again｜hard｜good｜easy`, `interval`, `shortcut`                                                               | Render all four in a `role="group"` with `aria-label={t('rating.group')}`, in the order of `ratings`.                                                                                                                                |
| `SyncStatus`                  | `state: synced｜syncing｜pending｜offline｜error`, `pendingCount`                                                       | Presentational. The sync engine provides state through `src/app/SyncIndicator.tsx` (currently online/offline only).                                                                                                                  |
| `Page`                        | `title`, `hideTitle`, `description`, `actions`, `width: reading｜wide`                                                  | Every routed screen starts with it.                                                                                                                                                                                                  |
| `AppShell`                    | `syncSlot`, `immersive`, `children?`                                                                                    | Used by `src/app/RootLayout.tsx`. A route opts into immersive (no nav, close button) with `handle: { immersive: true }`.                                                                                                             |
| `Logo`                        | `size`, `wordmark`                                                                                                      | Theme-aware mark and wordmark.                                                                                                                                                                                                       |

### App shell

- **Phones (< 768 px).** A 56 px top bar holds the logo, the sync status and the settings button. Below it is a 64 px bottom tab bar (Ana, Ekle, Kartlar, İstatistik) with icon and label, and a short accent rule over the active tab. It respects the safe area.
- **768–1023 px.** An 88 px left rail with stacked icons and labels.
- **≥ 1024 px.** A 240 px labelled sidebar with the wordmark. Settings stays at the top right.
- **Page transitions.** Fade with a 6 px rise in the medium tier, opacity only under reduced motion.
- **Routes** (`src/app/router.tsx`): `/`, `/review` (immersive), `/add`, `/import/:jobId`, `/library`, `/stats`, `/settings`, `/auth`, a 404 page, and `/dev/ui` (dev only; a lazy chunk that is not in the production bundle). Placeholder pages live in `src/app/pages/` for feature agents to replace.

## Icons

There are 34 hand-drawn icons (plus the Google mark) on a 24 px grid: 1.6 px stroke, round caps and joins, and a 2 px inset. Shapes are built from straight lines and true arcs, with no ornament. They are in `src/ui/icon-paths.tsx`. Sync states use one cloud silhouette with an inner glyph (check, up arrow, exclamation) or a slash for offline. `settings` is drawn as sliders, not a gear (quieter, and it matches "preferences"). The Google "G" is the official four-colour mark and is used only on the sign-in button.

## Logo

The mark is **"ˈe"**: the IPA primary-stress tick in front of a serif _e_.

- It reads as a dictionary pronunciation entry, the moment an English word gets its weight. It avoids the usual book, graduation cap, brain and sparkle clichés.
- The glyphs are Source Serif 4 Semibold outlines (OFL), so the mark matches the headword typography.
- The app tile is ink with a paper _e_ and a pale ink-blue tick. In dark UI the in-app mark inverts (paper tile, ink _e_, accent tick) via `--logo-tick`.
- Geometry is in `src/ui/brand/mark.ts`, shared by `<Logo>` and `scripts/generate-icons.ts`.
- `pnpm icons` renders `public/favicon.svg`, `icons/icon-192.png`, `icon-512.png`, `maskable-512.png` (full-bleed, with the glyphs inside the 80% safe circle) and `apple-touch-icon-180.png`. It uses Playwright's Chromium, which is already a dev dependency, so no image library was added. Set `CHROMIUM_PATH` if needed.

## Strings

All UI text goes through i18next (`src/i18n/tr.json` is the default and fallback; `en.json` mirrors it). Keys are typed (`src/i18n/i18next.d.ts`), so a missing key is a type error. Turkish nouns do not pluralise after numbers, so `sync.pending_one` and `sync.pending_other` are identical in `tr`. The `dev.*` keys are used only by the gallery.

## QA

- `pnpm typecheck`, `pnpm build`
- `pnpm contrast`: palette contrast; fails when a pair falls below target
- `pnpm ui-qa [baseUrl] [outDir]`: screenshots (360/1280 × light/dark, reduced motion) to `docs/screenshots/` plus axe; fails on any violation. Start `pnpm dev --port 5199` first.
- Screenshots of open overlays (`dialog-*`, `sheet-*`, `menu-*`, `toast-*`) and keyboard focus (`focus-*`) are in `docs/screenshots/` too.
