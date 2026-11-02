# 0068 — v0.5.2: the Ekle screens on the "Çam" design

## Context

Wave 2 of v0.5.2 rebuilds every screen from the blueprints in `docs/design.md` §4 (ADR 0065).
This record covers the (+) Ekle sheet (§4.10) and the screens behind it (§4.11): manual add,
paste / PDF, link, subtitle file, photo (OCR, including a photo shared into the app, ADR 0064),
the share screen, the quick sheet, the extraction jobs list and preview (ADR 0063), "Kelimelerimle
metin", and the CSV and Anki imports. The behaviour stays as ADR 0056, 0063 and 0064 describe; no
Dexie version (43 stays free) and no migration were needed.

## Decision

1. **The sheet is called "Ekle"** and has three groups. The word field is a `TextField` with
   "Anlamını bul"; its hint sits under the whole row, so the placeholder is not cut at 360 px.
   "Metin ekle" is a 2-column grid of tiles (3 columns from 400 px). Each tile has its icon in a
   neutral `IconTile`, and its label wraps but is never cut: Metin yapıştır · PDF dosyası ·
   Bağlantı · Fotoğraf · Altyazı · Metin oluştur. "Kelimelerimle metin" became the sixth tile
   instead of its own group (`openAddSheet('compose')` scrolls to the text group). The import
   group is a list group: Anki, CSV, backup file. The green `success-soft` wells and the
   five-in-a-row truncated tiles are gone.
2. **One frame for every Ekle screen** (`AddFlowPage` in `src/features/add/ui.tsx`): the
   reading-width page frame with the shared `TabHeader`, and a back control "‹ Ekle". It goes
   back to the screen where the sheet was opened and opens the sheet again. On a cold start (a
   PWA shortcut, a deep link), it opens the sheet over Bugün. A sub-step whose parent is a page
   uses an ordinary back link instead: a preview leads to "‹ Kelime çıkarmaları" (`/import`).
   We chose this over `PageFrame back` because the sheet is a modal, not a route, and a link
   cannot reopen it.
3. **Shared Ekle pieces** live in the same file, built only from tokens and `@/ui`:
   `ChoiceButton` (the large two-line choice; the primary one is pine, the others are flat cards),
   `Notice` (a quiet line on a sunken well), and `StickyBar` (the sticky bottom bar on a surface
   with a hairline, above the tab bar on phones). The capture actions, the quick sheet, OCR, the
   preview, the CSV list and "Kelimelerimle metin" all use them.
4. **Preview.** The type filter is a `ChipRow` of `Chip`s with counts (it was a segmented
   control that needed arbitrary label padding to fit). The candidates of a section sit on one
   card with hairlines. Turkish meanings and their input use the UI font (Literata is for English
   only). Low confidence is shown by its badge alone; the 3 px coloured left border is gone. The
   sticky bar shows "n/m seçili" and the one primary action.
5. **Fewer primaries.** On OCR review only "Okuyucuda aç" and "kelimeleri çıkar" stay in the
   sticky bar. "Başka fotoğraf", the privacy line and a guest's sign-in card move above it. In
   "Kelimelerimle metin", a guest's sign-in card leaves the tray, so the bar stays small. Anki's
   "Zenginleştir" is tonal next to "Kelimelerime git". A job card's buttons sit in a row, and
   "Bulunanları şimdi gör" is tonal.
6. **Guests.** Anki's enrichment shows a guest the Google sign-in button (`SignInNeeded`)
   instead of a sentence, like the other capture screens (ADR 0063).

## Consequences

- `addSheet.title` is now "Ekle". The tab labels are "Metin yapıştır" and "PDF dosyası", and
  e2e specs that looked for the old names were updated. New keys: `addSheet.word.field`,
  `addSheet.word.placeholder`, `addSheet.text.compose` and `add.backToSheet`. The keys
  `addSheet.compose.*` and `addSheet.quickPlaceholder` were removed.
- `src/ui` is unchanged. `ListRow` takes no `data-testid`, so the sheet's import rows are links
  with the same classes as a `ListRow` (they keep their test ids).
- `features/cards/SentencePreview.tsx` (shared with the word detail sheet) was left to W2.
