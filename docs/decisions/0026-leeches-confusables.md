# 0026 — Leech cards, confusable words and contrast cards

## Context

v0.3 İP6. Some cards are forgotten again and again ("leeches"). Repeating them the same way
wastes the learner's time, and a common reason is a second word they mix the card up with
("affect" / "effect"). Constraints:

- Acceptance criterion 5: a card forgotten for the 6th time is flagged in that session with
  at least three other ways to study it, and nothing is suspended without the user.
- Review logs are insert-only and the card is the replay of its logs (invariant 3); no
  package may update or delete a log.
- No user text in a shared table or in a model request; one model call per pair at most,
  with the model name from the environment and the quota through `ai_consume`.
- Works offline for content already on the device; no live Gemini in tests.

## Decision

1. **A leech is computed, not stored.** `lapses ≥ 6` (`LEECH_LAPSES`), where lapses are the
   Again answers given in Review, read from the card's effective (undo-aware) logs
   (`domain/leech.ts`, `lapsesFromLogs`); a property test checks it equals the replayed
   card's `lapses`. `becameLeech(logs, logId)` tells whether one answer crossed the line.
   Undo takes the flag back with the log. The card marker reads `card.lapses` (the same
   number, by invariant 3) so it costs no query.
2. **Flag in the session.** After an Again answer the review session asks
   `leechAfterAnswer`; when this answer was the 6th lapse a line above the next card (or on
   the session summary) says so with "Başka yoldan bakalım". Otherwise the same line asks,
   optionally, "başka bir kelimeyle mi karıştı?". The line goes with the next answer or undo.
   A leech card shows a small "Zorlandığın kart" badge and, on its front, the mnemonic hint
   of decision 0020 (hidden until tapped).
3. **"Bu karta başka yoldan bakalım" sheet.** Paths, each opened by the user: a mnemonic
   (İP2 section), another sentence (examples), root and word family (when the morphology
   file knows the word), the confusion picker and contrast cards, splitting the senses
   (multi-sense recognition cards), and a break or a fresh start. A normal word always has
   at least four (mnemonic, confusion, break/fresh start, plus examples, family or split
   when they apply); a contrast card has "write the difference" and break/fresh start.
4. **Split and reset change cards only.** *Split* adds one recognition card per live sense
   (`sense_id` set, new FSRS state) and suspends the original card, which keeps its history.
   *Reset* suspends the card and adds a fresh copy (same note, sense and type). Neither
   touches a log. Undo deletes the new cards (tombstones) and unsuspends the original.
   Because a note can now have more than one recognition card, the unlock rule of
   production/cloze cards follows the *primary* recognition card (`primaryRecognition`:
   live and note-level and not suspended, then live and note-level, then any live, then
   any), in answers, undo, `ensureSenseCards` and recompute.
5. **Confusable pairs.** The device scans the user's own terms
   (`domain/confusables.ts`): restricted Damerau–Levenshtein ≤ 2 on lemmas of 5+ letters
   (symmetric-delete candidates, ~260 ms for 5,000 words) or the same Turkish meaning
   (groups of at most 8), leaving out one word family (morphology file), prefix pairs,
   roots/affixes and contrast notes. Distance 2 finds many harmless pairs, so a scanned pair
   is *suggested* only when its two notes have at least `MIN_PAIR_LAPSES` (2) lapses
   together; a pair the user reported is always suggested. A report or a "Önerme" is a
   `user_content` row of kind `confusion` (id from the sorted terms, `context`
   `reported`/`hidden`, `text` "a ↔ b", the two senses in `sense_id` / `replaces_id`). No new
   user table: `user_content` already syncs per user with RLS.
6. **Contrast card ("fark kartı").** A note with `term_type 'contrast'`, term "a ↔ b"
   (sorted), two senses copied from the user's senses (meanings, and the shared sentences
   when there are any) and one recognition card; it is recognition-only like a root/affix
   note and has no level. The one-line difference is the user's `user_content` row of kind
   `contrast` (`replaces_id` = the shared row it came from); editing it never touches the
   shared table. The two words' own notes and cards do not change.
7. **`ai-contrast` (prompt `contrast-v1`).** The request names two lexicon sense ids; the
   function reads lemma, part of speech and meanings from the shared lexicon (the English
   gloss goes in as the meaning), answers from `lexicon_pair_notes` (kind `contrast`, key =
   the sorted sense ids) when the pair exists, else spends one `ai_consume` unit on one
   model call, validates the answer on the server (each sentence uses its own word, whose
   span the server finds; the difference is Turkish, names both words and has 1–300
   characters) and stores it for every user. An
   unusable answer is `ai_failed` and is not stored. Migration
   `20261023000800_leech_contrast.sql` adds the term type, the kind and a shape CHECK;
   pgTAP `19_leech_contrast.test.sql`. Details: `docs/ai-contrast.md`.
8. **Stats, "Zorlandıklarım".** The cards with 6+ lapses, most first, each opening the
   sheet, with "Bunları çalış" (a practice round of those notes) and the existing
   "Zorlandıklarım" practice source; below, up to five suggested pairs with "Fark kartı
   yap" / "Önerme".
9. **Dexie v19** re-pulls notes once (`pull_backfill`) so a device updated after another
   device made a contrast note gets it (older clients skip the unknown term type).

## Consequences

- The app never suspends, resets or deletes a card on its own; the logs stay complete, so
  statistics and FSRS optimisation see the whole history, also of split or reset cards.
- A split or reset card's old history stays on the suspended original: the new cards start
  as new cards (they count toward the daily new limit).
- Pairs suggested from the scan depend on forgetting; a learner who never forgets either
  word sees only the pairs they report.
- Older clients ignore contrast notes until they update; their cards then sync normally.
