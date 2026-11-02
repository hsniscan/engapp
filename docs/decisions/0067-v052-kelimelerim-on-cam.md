# 0067 — v0.5.2: Kelimelerim screens rebuilt on "Çam"

## Context

Wave 2 of v0.5.2 rebuilds every screen from the blueprints in `docs/design.md` §4 (ADR 0065).
This record covers W2's area: Kelimelerim (Destelerim and Kelime Bankası), Tüm kelimelerim
with its bulk bar, the word sheet, a deck's own page and the rules editor, tags, a suggested
deck, Keşfet › Desteler (the catalogue body, shared with W4's Keşfet) and the known-words
page. Wave 1 (ADR 0063) fixed their behaviour (`wordActions.ts` bulk operations,
`filter.stages`, Biliyorum, undo, deck reorder and export); all of it stays. ADR 0061 stays
too: no on-demand AI pictures or sentences, cached ones are still shown.

## Decision

1. **Only shared components.** `PageFrame`, `Card`, `SegmentedControl`, `ListGroup`/`ListRow`,
   `Chip`/`ChipRow`, `StagePill`/`StageBar`, `StatTile`, `EmptyState`, `Dialog`,
   `DropdownMenu`, `Badge`, `Term`, `ProgressBar`, `toast.undo`. The colour constants of
   `features/decks/deckUi.ts` (`MARK`, `LEVEL_MARK`, `BAR`, frequency dots) and the local
   pieces built on them (`Ring`, `BackBar`, `StatusPill`, `Glyph`, `ProgressBar2`,
   `LevelPill`, `FilterChip`, the local `Chip`) are gone. The CEFR ramp (Keşfet › Desteler,
   a suggested deck's level bar) is drawn with the stage tokens (`levelColor`: A1 = Kalıcı …
   C1/C2 = Yeni), so one sequential palette serves both.
2. **Segments are a segmented control** (radios in a fieldset, kept in `?tab=`), not links.
3. **The word sheet opens in a calm read view**: stage, part of speech, a speaker button,
   meanings, the learner's own sentence, examples, a "Hafıza" card (next review, interval,
   reviews, lapses), picture, mnemonic, family, level, cards. "Düzenle" switches to the old
   form (`?note=…&edit=1` opens it directly from a row menu); saving goes back to reading.
4. **Undo instead of confirm** where the step can be undone: deleting one word (sheet, row
   menu), deleting a deck, resetting a word's progress, suspending, Biliyorum, removing a
   known word, adding from the bank. Bulk delete keeps its confirm (ADR 0063).
5. **Kelime Bankası**: the round plus on a row adds the word at once with "Geri al"
   (`addFromWordBank` now returns the ids it created); several meanings are picked in the
   row's details. The multi-select bar is gone.
6. **Data additions without a schema change**: `WordStageMix.byStage` (per-stage counts for
   the stage bar) and `DeckWordRow.dueToday` (the "N tekrar" badge). No Dexie version, no
   migration.
7. **Row menus step aside while words are selected**: the bulk bar owns the actions then, and
   no ⋯ button sits under the floating bar. On phones the bar says "2 seçili".
8. `ChipCount` (features/decks/parts) puts a real space between a chip's label and its count:
   the shared `Chip count` renders them with no space, so screen readers said "Yeni12".

## Consequences

- The section headings of shared word-sheet sections (examples, picture, mnemonic, family,
  level) use the UI type scale instead of the old serif heading.
- `SheetActions` (features/cards) is a feature-local sticky action row for long forms in
  dialogs; it is not part of `src/ui`.
- Screenshots: `tests/e2e/v052-screens-words.spec.ts` (runs only with `SHOTS_DIR`).
