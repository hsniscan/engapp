# 0074 — v0.5.3: bulk example sentences, phrasal verbs and collocations

## Context

The brief for v0.5.3 (items C2 and C4, evidence in `teknik-notlar/icerik.md`) asks for:

- **C2:** about three example sentences for every Kelime Bankası meaning (≈ 10 000 bank rows,
  ≈ 14 700 senses), so that cards and the "Örnek cümleler" tabs are not empty. Today most senses
  have only the one example the word-bank job wrote.
- **C4:** about 500 phrasal verbs and 300 collocations with Turkish meanings and examples, and
  the phrasal verb / collocation decks in Keşfet → Desteler, which were hidden until there was
  data.

Rules: only free data that allows commercial use; no live AI in the app; one-time jobs under
a configurable cap, inside the shared monthly Claude budget; nothing a user wrote goes into the
shared lexicon.

## Decision

### C2: example sentences (`scripts/examples-bulk.ts`, `.github/workflows/examples-bulk.yml`)

1. **Tatoeba first.** The `match` step (free) reads Tatoeba's English–Turkish pairs (official
   weekly per-language exports with sentence ids and authors; manythings' `tur.txt` as a
   fallback) and keeps pairs that are 4–16 words, start and end like a sentence, have a translation of plausible length, contain no blocked word
   and fit the row's level: no word more than one level above it, at most two words above it,
   at most one unknown word (names do not count). The term must appear in the sentence in any
   inflected form, irregular ones included (`irregularBases`, also used by `exampleSpan`).
   Up to eight candidates per word, shortest and closest to the level first, are stored in
   `example_bulk_items` (state `candidate`).
2. **Tagging.** A cheap model (`CLAUDE_EXAMPLES_MODEL`, default: the word-bank model) assigns
   each candidate to one of the word's meanings, or to none, and picks a context (daily,
   conversation, work, formal) and a level band. Three per sense are kept for review; the rest
   become spares that fill in if a kept one is rejected.
3. **Generation for the gaps.** Senses still short of three get new sentences from the same
   model, in the contexts not yet covered, with the sentences already there as "do not repeat".
4. **Review for natural Turkish.** A stronger model (`CLAUDE_EXAMPLES_REVIEW_MODEL`, default:
   the word-bank review model) reads groups of 20 and approves, fixes or rejects each sentence:
   Turkish must read as a Turkish speaker would say it, the English must show the meaning in
   question, the level must fit. The English of a Tatoeba sentence is never changed (a needed
   fix rejects it); a fixed Turkish translation is recorded as `tr_edited`.
5. **Publish into `lexicon_examples`.** Approved items become ordinary active
   `lexicon_examples` rows (at most three active per sense; existing ones count), so the app's
   rotation, feedback, edits and `lexicon_examples_pull` work as they are. Tatoeba rows carry
   `source = 'tatoeba'` and `attribution` (ids, authors, licence, `tr_edited`), shown under the
   sentence as "Tatoeba · authors" with a link to the source. The sentence-audio job
   (`tts-pregen`) reads every active `lexicon_examples` row, so the new sentences are voiced by
   the next pronunciation run with no change there.
6. **Cost control.** Everything goes through Message Batches (half price). Each batch reserves
   its upper bound on the shared monthly budget (`image_budget_reserve`, purpose `wordbank`) and
   must also fit the job's own cap, `EXAMPLES_BULK_CAP_USD` (default 15 US$, counted over every
   batch the job has sent: settled costs plus open reservations); a batch that does not fit is
   halved until it does, or not sent. Failed requests are retried up to three times, then
   dropped with a note. `plan` prints an estimate before anything is sent.

### C4: phrasal verbs and collocations (`scripts/build-phrases.ts`, `word-bank.yml job=phrases`)

7. **Candidates.** Phrasal verbs: titles of Wiktionary's "Category:English phrasal verbs" that
   are a list verb plus one to three particles (`give up`, `look forward to`); titles with
   "someone", "one's" or a non-particle are left out. Collocations: verb + (article) + noun
   pairs for common light verbs (make, take, do, have, pay, …) found in the corpora themselves.
8. **Ranking.** Both are counted in Tatoeba's English sentences and Simple English Wikipedia,
   in any inflection, with a short object between verb and particle for separable ones
   ("turn the radio down"), once per sentence. Phrasal verbs are ranked by their mean rate over
   the two corpora (minimum 5 hits); collocations need 8 hits and a log-Dice of at least 6, and
   pairs seen mostly with a possessive or another determiner are dropped. The top 500 and 300
   go into `ref_phrases`.
9. **Levels.** By frequency rank (phrasal verbs: 25 A1, then A2 to rank 90, B1 to 220, B2 to 360,
   C1 to 460, then C2; collocations from A2), never below the level of their hardest word.
   `cefr_source` for these rows is `freq`.
10. **Meanings and examples.** `word_bank_pending` now also returns `ref_phrases` rows, so the
   existing word-bank job (Haiku → Sonnet review, same budget) writes their Turkish meanings and
   examples with a hint for each kind. `word_bank.pos` gains `phrasal verb` and `phrase`, and
   `list_source` gains `wiktionary` and `corpus`. Once examples are published they go through
   C2 like any other bank row.
11. **Decks.** Keşfet → Desteler shows a "Kalıplar" section as soon as the bank has phrase rows:
   one card per kind (Phrasal verb'ler, Kalıp ifadeler) with level chips. Keys: `phrasal-verbs`,
   `phrasal-verbs-<level>`, `collocations`, `collocations-<level>`. Level and top-N word decks
   leave phrases out.
12. **Old clients.** Clients before this version reject word-bank rows with the new parts of
   speech but still move their cursor past them. Dexie v42 clears the word-bank and
   lexicon-examples cursors once, so updated devices pull those rows (and the new attribution
   fields) again.

### Licences

Tatoeba CC BY 2.0 FR (credit under each sentence and on Kaynaklar), Wiktionary titles and
Simple English Wikipedia counts CC BY-SA 4.0 (`ref_phrases` and the phrase rows are kept with
the other CC BY-SA word-bank data). PHaVE, Liu, Oxford, Cambridge and Kelly lists are not used.
Details: `docs/licenses.md`.

## Consequences

- About 44 000 shared sentences for ≈ 14 700 senses; expected spend about 8–12 US$ for C2
  (tagging ≈ 0.5–1, generation ≈ 1–2, review ≈ 6–9) and under 2 US$ for C4's meanings, never
  more than the cap. Counts depend on the Tatoeba export of the day; `plan` reports them.
- The jobs need the network for the downloads, so they run only in GitHub Actions; the build
  environment could not reach Tatoeba or Wiktionary, so the counts above are estimates.
- Guests do not get `lexicon_examples` (the pull is for signed-in users), so they see the
  bank's own single example until they sign in. Unchanged from before.
- Deferred: a "Türkçeden yanlış kurulur" note per collocation, the Turkish-learner level check
  (`level-tr`) for phrases, and idioms.
