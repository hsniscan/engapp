# 0019 — Anki import (.apkg)

## Context

v0.3 İP1 (plan "İP1 — Anki'den içe aktarma", Annex A.2; v0.2 plan Annex A.8; acceptance
criterion 8): a learner moving from Anki brings an `.apkg` with its review history. 1 000 notes
with history must import in under 30 s, note and card counts must match, card state must come
from the history (review logs are the only truth, invariant 3), and importing the same file
again must create no duplicates. Old (`collection.anki2` / `.anki21`, schema 11) and new
(`collection.anki21b`, zstd, schema 18) packages. Dictionary matching ("Sözlükle eşleştir") is
optional and must respect the shared daily AI budget.

## Decision

1. **Reading.** `src/features/anki/readApkg.ts` runs in a module Web Worker
   (`apkg.worker.ts`) with three new, lazily loaded dependencies: **jszip** (the archive),
   **fzstd** (zstd decoding of `collection.anki21b`, ~8 KB, decode-only) and **sql.js** (SQLite
   compiled to wasm, the only way to read the collection in a browser). They live only in the
   worker's chunk (~150 KB JS); the 660 KB wasm is not precached and is cached on first use
   (`engapp-anki-reader`, CacheFirst, like the pdf.js worker in 0008). Offline before the first
   import the screen says the reader needs the internet once. New-format packages carry a
   placeholder `collection.anki2`, so `anki21b` is read first, then `anki21`, then `anki2`.
   Schema 18 keeps note types in protobuf blobs; a 60-line reader (`domain/ankiProto.ts`) reads
   the two fields needed (note type kind, template front).
2. **Mapping.** One Anki note → one Engapp note with one sense (term, Turkish meaning, optional
   sentence; cloze card when the term is found in the sentence). The user maps fields per note
   type, guessed from field names, with a 3-note preview. HTML is stripped, media references are
   dropped and counted. Cloze note types are not imported (counted). The template whose front
   shows the term is the recognition card, the one that shows the meaning is production (by
   field references; with one or two templates that do not tell, first = recognition, second =
   production). Other templates are ignored and counted. Anki tags become note tags.
3. **History.** `revlog.ease` 1–4 → rating for learn/review/relearn rows; filtered-deck cramming
   (type 3), manual changes (type ≥ 4, ease 0) and answers dated in the future are skipped
   (counted). On the old v1 scheduler (`schedVer` 1) learning answers had three buttons:
   2 = Good, 3 = Easy. `duration_ms = min(time, 60 s)`. Each answer becomes a review log with
   **`origin = 'anki'`**. Its id is a UUID v7 at the review time whose other bits hash
   (Engapp card id, revlog id): deterministic, and unique across accounts (the plan's
   "(Anki card id, revlog id)" would collide on the server, where `review_logs` is keyed by id
   alone, if two accounts imported the same deck). The card's FSRS state is `replayCard(logs)`
   from a card created at the Anki card's creation time; Anki's SM-2 intervals are not used.
   The screen says so before importing. Suspended Anki cards (queue −1) stay suspended.
   Imported answers are never offered for "geri al" (undo).
4. **Duplicates.** Planned per term: a later note of the same term with another meaning becomes
   a second sense (its production history is kept; its recognition history is dropped and
   counted, the note has one recognition card); the same meaning again is counted, not added.
   A term the library already has (live or deleted) goes through `addNoteWithSenses`: a missing
   meaning is added, no history is attached. So a second import of the same file adds nothing,
   and an interrupted import continues when the file is imported again. The source row
   (`sources.kind = 'anki'`) is reused for the same file name.
5. **Writes.** New notes, senses, cards and logs are written with `bulkPut` in transactions of
   500 notes, every row queued in the outbox in the same transaction; `daily_activity` is rebuilt
   once at the end (the history shows in the heatmap and the streak). 1 000 notes with 20 000
   answers take ~6 s in the unit test (fake IndexedDB, including the read and the plan).
6. **Dictionary matching, without a new edge function.** The plan named an `enrich-batch`
   function (20 words per model call). This package reuses the deployed **`ai-enrich`** instead,
   one word per request, from a resumable local queue (`anki_imports.enrich`,
   `src/features/anki/enrichQueue.ts`): the server answers words the shared lexicon has without
   a model call, so only unknown words cost budget. The runner stops when 20 calls of the daily
   budget are left (for the user's own work) or on `daily_limit`, and continues the next local
   day; offline or signed out it waits. A sense is linked to a lexicon sense only when the
   Turkish meanings are the same (`isSameMeaningTr`, brackets ignored); otherwise only the note
   gets the lexicon term and IPA. The user's meaning is never replaced. Why: no new prompt,
   contract or deploy for a one-off feature, and no AI call at all for the common words.
   Cost: a deck of 1 000 words the lexicon does not know takes ~1 000 calls (spread over days)
   instead of ~50. If that matters in practice, a batched endpoint can replace `lookUp()`
   without changing the queue.
7. **Schema.** Dexie **v12**: `anki_imports` (local: counts, created note ids, the matching
   queue); `review_logs.origin` is optional (absent = 'app'), so no log is rewritten; sources
   are re-pulled once (an older version dropped `kind = 'anki'` rows as invalid). Supabase
   `20261023000100_anki_import.sql`: `review_logs.origin text not null default 'app'` with a
   BEFORE INSERT trigger that turns the explicit null of an older client's push into 'app', and
   `sources.kind` accepts 'anki'. No new synced table.
8. **Accounts.** Imported logs are ordinary review logs: copying cards from another Google
   account still brings cards as new cards only, never history (0009).

## Consequences

- An older app version pulling an imported log drops the unknown `origin` (zod strips it) and
  still counts the answer; its backup then lacks the label. Harmless: nothing schedules on it.
- Anki media, cloze notes and extra templates are not imported (reported with counts); export
  back to Anki is out of scope (plan).
- Fixtures: `scripts/anki-fixtures.ts` builds `tests/fixtures/anki/sample-{anki2,anki21,anki21b}.apkg`
  from our own sample deck (reproducible byte for byte); the 1 000-note deck is built in the test.
