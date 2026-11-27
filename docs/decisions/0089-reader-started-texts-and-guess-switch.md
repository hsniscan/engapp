# 0089 — When a text counts as started; one guess switch for every word

## Context

Browser review 2026-11-26 (notlar/kelimeler-okuma.md #6, #7 and "still open" 3.10):

- Opening a library text for a few seconds took it out of Kitaplık and listed it under
  Metinlerim as "Kitaplık · Okunmadı", while Keşfet called the same text "Devam et" with the
  button "Kaldığın yerden oku". A mistaken tap moved a text, and the labels disagreed.
- In the reader, a word not in the cards always asked for a guess first (two taps to see a
  meaning). Only card words had a switch ("Hep tahmin ettir").

## Decision

- A text counts as **started** once it has a resume point (the user scrolled) or at least
  `STARTED_READ_MS` (20 s) of reading time (`domain/texts.ts`, `readingProgress`). Before that it
  is **"Başlanmadı"** (was "Okunmadı"); then "Başladın" / "%N okundu"; then "Bitti".
- A library text that is opened but not started stays in the Kitaplık list and is not listed
  in Metinlerim; once started (or finished) it moves to Metinlerim as before (decision 0054).
  Keşfet's "Devam et" card still offers the last unfinished text, and for one not started yet
  the button says "Okumaya başla" instead of "Kaldığın yerden oku".
- "Hep tahmin ettir" (Okuma ayarları) is now the one switch for every tapped word: off (the
  default) shows the meaning at the first tap, card word or not; on asks for a guess first for
  every word. The setting itself (`settings.reader_always_guess`) is unchanged, so no schema or
  sync change.

## Consequences

- A user who liked the forced guess for new words turns "Hep tahmin ettir" on.
- Texts with a little reading time from before this change (under 20 s, never scrolled) show
  as "Başlanmadı" and, for library texts, go back to the Kitaplık list.
