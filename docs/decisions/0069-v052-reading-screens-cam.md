# 0069 — v0.5.2: Keşfet and reading screens rebuilt on "Çam"

## Context

Wave 2 of v0.5.2 rebuilds every screen from the blueprints in `docs/design.md` §4 (ADR 0065).
This record covers W4's area: the Keşfet feed (§4.12), the graded library and Metinlerim
(Keşfet → Okuma), the reader, its word sheet and settings, the end-of-text summary and the
daily story (§4.13). Wave 1 (ADR 0063) already fixed their behaviour (glosses, encounter
counts, `trSuffix`, listening speed and text size, "Biliyorum"); the leftover review items
B8, B11, B13–B20 (`teknik-notlar/kesfet-okuma.md`) are handled here where they are UI.

## Decision

1. **Only shared components.** Every screen is built from `src/ui` (`PageFrame`, `Card`,
   `Eyebrow`, `SectionHeader`, `ChipRow`/`Chip`, `ListGroup`/`ListRow`, `Badge`, `Term`,
   `Sheet`, `EmptyState`, `Skeleton`, `ProgressBar`, `toast.undo`). Hand-made radii, sizes,
   colour mixes and the inline play icon are gone. One icon is added to `icon-paths.tsx`:
   `play` (the pair of `pause`, for "Dinleyerek oku").
2. **Reader words are buttons.** Every word is a `<button type="button">` (still one click
   handler on the text). Keyboard: one Tab stop per sentence — its first marked word, else its
   first word — and ←/→ move word by word, Home/End to the sentence's ends (a roving
   tabindex kept in the DOM, so a 30 000-word text does not re-render on focus). A marked word
   names its state to screen readers through `aria-describedby` ("yeni kelime", "öğrendiğin
   kelime", "pekişen kelime", "hikâyedeki tekrar kelimen"), also when the colours are off. The
   tapped word carries a 2 px focus ring while its sheet is open. Marks: new = pine wash +
   dotted pine underline, learning = solid pine underline at 60 %, settling = faint underline,
   known = none.
3. **Literata reading text** at `text-reading` (19/1.75), scaled by the per-device size setting
   (`calc(var(--text-reading) * scale)`); paragraphs 20 px apart; Turkish under a paragraph in
   the UI sans. Top bar: back, centred title, listen (play/pause), settings. The settings sheet
   adds the theme switch next to text size and listening speed.
4. **Word sheet is non-modal** (`Sheet modal={false}`): the text stays tappable behind it, the
   tapped word is scrolled above the sheet. Header: `Term` title; stage (`StagePill`), part of
   speech in Turkish, IPA, tonal speaker. Actions: primary "Kelimelerime ekle", secondary
   "Biliyorum" (`toast.undo`). **B13:** when no meaning is found, the user types one in the
   sheet and the card is added with the sentence and its span, without leaving the reader (no
   change to the manual-add form, which W3 owns).
5. **End of text** is one `Card tone="accent"`: the summary line, then "Yeni kelimeleri ekle"
   (the bulk sheet) or, once every new word is in the cards, "Bunları çalış" (`/study`). It is
   the primary button once the text is finished.
6. **Library search** (`filterLibrary({ query, topicLabel })`, pure, in `domain/library.ts`):
   every word of the query must appear in the title or the topic's Turkish name; case, accents
   and the Turkish ı/İ are folded (`foldSearch`). Level and topic are chips.
7. **One progress wording (B14)** — `readingProgress()` in `domain/texts.ts`: "Okunmadı",
   "Başladın" (reading time but no scroll yet, the rule the library already used), "%40
   okundu", "Bitti", on Metinlerim, Keşfet and the library badges.
8. **Reversible delete in Metinlerim:** a text is deleted at once with "Geri al"
   (`restoreText(id, deletedAt)`, which only undoes that same deletion) instead of a confirm.
9. **Smaller items.** B8: a daily story's coverage line is measured without its target words
   (`storyCoverage`, the rule the story was accepted with) and says so. B11: the story card on
   Keşfet is a card of its own that draws nothing until it knows its state and never repeats
   the "Devam et" text. B15: Bugün's library suggestion skips finished texts while an unfinished
   one fits. B16: the no-server library message no longer promises that the internet will help.
   B17: listening to a story no longer probes the shared audio storage. B19: the reading
   position is found by binary search over the sentences instead of measuring every one.

No Dexie version (44 stays free) and no migration were needed.

## Why

- Buttons give every word a real target and keyboard reachability without a thousand tab stops;
  the description makes the colour code readable by ear, which `docs/design.md` §1.6 requires.
- A non-modal sheet keeps the reading flow: the next word is one tap away.
- Undo instead of confirm matches the design rule for reversible actions and removes a dialog.

## Consequences

- Keşfet filter chips are buttons (`aria-pressed`) that replace the URL, no longer links.
- Left for later: `DeckCatalog` (the Desteler filter's body, shared with Kelime Bankası) still
  has v0.5.1 styling; `TodayReadingCard` (Bugün) belongs to W1's rebuild. B18 (story prompt says
  "6 to 8 in 100" for Zorlayıcı) is a server prompt change, not UI, and is unchanged. B20
  (summary count vs coverage %) is unchanged: the two numbers measure different things.
