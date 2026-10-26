# 0054 — Reader and graded library fixes (v0.5.1 "Toparlama")

## Context

The v0.5.1 review (`plan/v0.5.1-toparlama-raporu.md`) found that library texts opened empty
(`openGradedText` stored `body: ''`, the reader drew only `text.body`, nothing read
`graded_bodies`), that closing the reader saved the end of the text as the reading position
(the position was measured in the effect clean-up, after the text had left the screen), and
asked for: the meaning of the user's own words without a guess, a one-time colour legend, an
end-of-text summary with "Bu metindeki yeni kelimeler", a library text listed once, and the
library's Turkish and recorded audio in the reader.

## Decision

1. **A graded reading row carries the text's plain body.** Decision 0047 kept it empty ("the
   sentences are shared"). Now `openGradedText` (and the reader, for rows made by v0.5) writes
   the plain text built from the shared sentences (`gradedReaderBody`, domain/library.ts) into
   the user's `texts` row. Progress (`offset / body.length`), "Devam et", the Bugün card and
   offline reading then work like for any other text, and an old row is repaired on its first
   open. Cost: the user's synced row holds a copy of ≤ 8 000 characters of public text; it is
   still the user's own row and never written to a shared table (AGENTS rule 5 holds).
2. **The reader keeps the library's own sentence boundaries.** `tokenizeReaderText` takes
   optional sentence ranges; for a library text they come from `gradedReaderBody`, so reader
   sentence *i* is library sentence *i*: its `tr` (shown under each paragraph with "Türkçesini
   göster", and in the word sheet on request) and its `audio_key`.
3. **"Dinleyerek oku" plays the recorded clips** (`gradedAudio.ts`): `audio_key` is an object
   path in the public audio bucket, fetched from R2 (`VITE_AUDIO_BASE_URL`) then Supabase
   (`ttsAudioUrls`, decision 0053). Guests hear them too (public files, nothing about the user
   is sent). A clip that cannot play falls back to the device voice for that sentence.
4. **The position is tracked, not measured at the end.** A scroll listener (one measurement per
   animation frame) keeps the first sentence on screen in a ref; resuming and listening update
   it; leaving saves the ref. A measurement with no sentence on screen is ignored.
5. **Own words show their meaning at once.** A tapped word with a note opens revealed; the new
   synced setting `settings.reader_always_guess` ("Hep tahmin ettir", default off) keeps the
   old guess-first behaviour. Server column in `20261102000100_reader_always_guess.sql`, Dexie
   v36 re-pulls settings once.
6. **The colour legend shows once per device** (meta `reader_legend_seen`, not synced: it is
   about this screen), inline above the text, closable, and stays in ⚙.
7. **End-of-text summary.** The words drawn as new when the text opened (`newWordsIn`) are
   counted; "M tanesini ekledin" counts those that now have a note. "Bu metindeki yeni
   kelimeler" lists them with their meaning from the device (word bank, cached lexicon: the
   word sheet's lookup), ticks those with a meaning and adds the ticked ones in one go with the
   text's sentence. A signed-in user online may look the rest up in the shared lexicon.
8. **One row per opened library text.** Under "Metinlerim" the library list leaves out texts
   the user has a reading row for (`hideOwn`); the row says "Okunuyor %x · Devam et".
9. **`/oku/<library id>` opens a library text.** When no reading row has that id, the reader
   looks it up in the catalogue (or the user's rows by `graded_id`), makes or reuses the row
   (`openGradedById`) and replaces the address. Links from Bugün/Keşfet use
   `readerPath(gradedId)` (`gradedReaderPath`) or `openReadingSuggestion(gradedId)`.
10. **Exits.** ✕ goes back when there is history, else to `/kesfet?f=okuma`.
11. **Bundle.** `data/library.ts` is only imported statically by lazy routes; Bugün's card loads
   it on demand, which removes the static + dynamic import warning.

## Consequences

Library rows created before v0.5.1 get their body the first time they open online (or from the
device copy). If a library text is later revised, the row's body is rebuilt and a resume point
past the new end starts over.
