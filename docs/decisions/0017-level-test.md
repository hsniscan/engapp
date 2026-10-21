# 0017 — Level test, known words, weekly level update and the vocabulary counter

## Context

v0.2 İP3 measures the user's level with an adaptive yes/no test and keeps it current from
studying; İP8's counter turns the same model into "Tahmini bildiğin kelime: ~3.450 · B2'ye
~620 kelime kaldı". The plan (İP3, Annex A.5, A.9) fixed the test design, the weekly rule
and the tables. Building it changed a number of details; the choices below replace those
parts of the plan. Decision 0009 holds throughout: level tests and known words are study
history of one account and never move to another account.

## Decision

### Test (`src/domain/levelTest.ts`)

1. **Flow as planned, with two limits made explicit.** Start at the user's level (B1 until
   measured); blocks of 8 real + 2 made-up words; ≥ 0.80 corrected → up, ≤ 0.50 → down,
   otherwise the same level once more; stop when a boundary is bracketed (≥ 16 real words on
   each side) or after **6 blocks** (60 words + at most 10 meaning questions = at most 70
   questions; the plan said "70 items" without saying whether meaning questions count).
   Simulated users (1 000 seeds): honest users get their level exactly in 86–100 % of runs
   and within one level in ≥ 99 %; test–retest differ by ≤ 1 level in 99 %; 56 questions on
   average.
2. **Meaning questions: 30 % of "Biliyorum" answers, at most 2 per block and 10 per test**
   (plan: 25 %, no cap), so a test always has some and never too many. The question has an
   "Emin değilim" answer, which counts like a wrong choice.
3. **A second reliability rule.** `reliable` needs ≥ 6 made-up words seen and a false-alarm
   rate ≤ 0.20 (plan), and in addition not more than half of ≥ 4 meaning questions wrong: a
   user who says "Biliyorum" to real words they cannot translate is guessing too. The result
   names the reason (`guessing`, `meanings`, `too_short`).
4. **An unreliable result is stored but not applied.** The row is kept (insert-only history,
   `applied = false`); the level and the known words do not change. The result screen says
   why and offers "Testi yeniden çöz" or "Sonucu yine de kullan" (sets the level, source
   `test`). A reliable result sets the level even when it is locked: the lock only stops the
   weekly update, and taking a test is an explicit choice.
5. **Known words from the test.** A reliable test marks its "Biliyorum" words as
   `known_terms` (source `test`), except words with a failed meaning question and words the
   user already has a card for; their level is stored as `cefr_at_mark`.
6. **Undo.** The last answers (up to 20) can be taken back ("Geri al", Backspace): a slip of
   the thumb otherwise counts against the user. The state is plain data with a serialisable
   PRNG, so undo is a stack of states.
7. **Columns beyond the plan:** `level_tests.ratios` (corrected ratio per level, the prior of
   the weekly update), `applied` and `duration_ms`.

### Question bank (`data/level-test/bank.json`, `scripts/build-level-test.ts`)

8. **Built offline from the word list, not from the lexicon.** Per level 240 candidates from
   the list (content words, `^[a-z]{3,14}$`, not frequent as a Turkish word), Turkish
   meanings from Gemini (prompt `bank-tr-v1`: the meaning, alternatives, `cognate`, `ok`),
   cognates and doubtful words dropped, 200 kept per level, three distractors from the same
   level and part of speech that share no word with the answer. A second prompt
   (`bank-check-v1`) answers every question blind; a question whose intended answer it does
   not accept, or where it accepts a distractor, gets new distractors (up to 4 rounds) and is
   dropped if still flagged. Every C1/C2 meaning and a sample of the others were then read by
   hand (`HAND_MEANINGS` in the script: 38 corrections or removals). Result `bank-2026-10-1`:
   A1 199, A2 200, B1 200, B2 197, C1 182, C2 199 words.
   The plan's route (lexicon meanings + a system job) needed the production lexicon; the
   bank must not change when the lexicon does, and its meanings must be checked once,
   together.
9. **Made-up words**: a letter-trigram chain trained on the list lemmas, 5–9 letters, rejected
   when in wordfreq (English large list, any frequency; Turkish small list), in the word
   list, an inflection of a real word, one edit from a top-30 000 word, containing a real
   word of ≥ 5 letters or two words, starting like a suffix, on an offensive list, or
   scoring as un-English; at most 3 per first/last three letters and 12 `-tion`/`-sion`.
   A model check (`pseudo-check-v1`) flagged words that read as real; the flags and a hand
   review (`HAND_REJECTS`) are in `pseudowords.tsv`. Kaikki was not needed.
10. **Models**: `gemini-3.6-flash`, `gemini-3.5-flash` and `gemini-3-flash-preview` for most
    meanings; quota ran out during the run, so the last C1/C2 words, the verification and
    the made-up word check used `gemini-3.5-flash-lite` — which is why every C1/C2 row was
    read by hand. The key stays a local secret; the script never prints it.
11. The bank is a **lazy chunk** (`import()` of the JSON): ~110 kB, not in the start-up
    bundle, precached by the service worker, so the test works offline and for guests. It
    is derived from CEFR-J and Octanove (CC BY-SA 4.0) and carries that notice
    (docs/licenses.md).

### Weekly update (`src/domain/levelUpdate.ts`)

12. **Stateless "two consecutive weeks".** Instead of storing each weekly run's ratios
    (plan: `meta.level_explain` on one device), the rule evaluates the model at two instants
    from synced data: the start of this week and the start of the previous week. Up one level
    when the next level's ratio is ≥ 0.80 at both, down when the own level's is < 0.60 at
    both. Every device reaches the same decision from the same data, a week the app was not
    opened still counts, and nothing device-local has to agree. Guards: never while
    `level_locked`; not when the level changed after the previous week's start (a test or a
    choice by hand) or an automatic change happened this week — at most one step a week. A
    meta key per account and week (`level_week:<user>`) makes the check run once a week per
    device; it runs 20 s after start-up (after the first sync) and hourly, never during a
    review.
13. **Evidence** as A.5 with small changes: a card counts as known when its first answer was
    Easy or its first three answers had no "Tekrar" (plan: "reached Review with 0 lapses",
    which needs the FSRS state at that time; the answers say the same and are in the logs);
    `known_terms` from preview or by hand count, those from a test do not (they are already
    the prior); practice counts once per word (its last answer, weight 0.5), not once per
    answer, so a long practice round cannot outvote the cards.
14. **The explanation is synced, in settings.** `settings.level_change` (from, to, band,
    ratio now and a week ago, known/unknown counts, `dismissed`) replaces `meta.level_explain`:
    the home note "Seviyen B1 → B2 oldu. Neden?" and its dismissal show on every device.
    "Geri al" sets the old level back as the user's own choice (`manual`).

### Counter (`src/domain/vocabSize.ts`)

15. As A.9: Σ size × ratio over the levels + learned words outside the list; "to next" =
    ⌈(0.80 − ratio_{L+1}) · size_{L+1}⌉, rounded up to tens. Sizes are the lemmas per level of
    the word list itself (`band-sizes.json`: A1 1 084 … C2 896; easiest level per lemma),
    not of the frequency-extended client file, so the counter counts what the test measures.
    "Outside the list" also includes known words (not only learned cards).
16. **No number without a basis.** Before a test or a level chosen by hand the tile invites to
    the test instead of showing a count built only from defaults (and stays away while the
    home screen's offer is showing). The explanation sheet shows the table behind the number.
    The tile is on the home screen (after today's card) and on Statistics (first, wide).

### Data and sync

17. **Tables** (`20261022000500_level_test.sql`): `level_tests` insert-only, `known_terms`
    mutable with tombstones (purged after 30 days), both in the sync registry; settings
    columns `level_source` (`default`/`test`/`auto`/`manual`), `level_updated_at`,
    `level_locked`, `level_change`. Old clients create settings rows without these keys;
    `sync_push` inserts through `jsonb_populate_record`, which makes them null, so a trigger
    fills the defaults (a NOT NULL column alone would reject those rows).
18. **New tables wait for the registry.** A client pushes `level_tests`/`known_terms` only
    after it has seen them in `public.sync_tables` (read through PostgREST, rechecked every
    10 min while rows wait), so the app can ship before the migration without burning outbox
    attempts. Dexie v9 resets `sync_cursor` to 0 once: a v0.2 client from before this
    change ignored rows of these tables during `sync_pull_v3` and moved its cursor past them.
19. **Accounts (0009).** Guest data, including tests and known words, goes to the account a
    guest signs into (it is the same person). "Copy cards from another account" leaves them
    behind; discarding local data removes them. Backups carry both tables (backup schema 9);
    older files without them restore and leave the local ones in place.
20. **Stable API for İP4**: `getKnownTermKeys(): Promise<Set<string>>` and
    `markKnown(term, source: 'test' | 'preview' | 'manual')` in `src/data/knownTerms.ts`.

### Interface

21. Settings get a "Seviye" section (the level select moved there from "Çalışma"): where the
    level came from, the lock, the test, the list of known words (`/settings/bilinen-kelimeler`:
    search, add, remove with undo). The test is `/level-test` (immersive, keyboard: 1/← and
    2/→, 1–4 and 0 for meanings, Backspace undo). The home screen offers the test once
    ("Gerek yok" hides it on this device; a test, on any device, or a level chosen by hand
    hides it everywhere).

## Consequences

- The level and counter are computed on the device from all notes, cards and logs; the
  overview is recomputed when settings, tests or known words change, not on every write.
- A device with stale data on Monday may decide differently from a synced one; the
  `level_updated_at` guard keeps it to one step a week, and the next sync brings the same
  settings row to both.
- The bank is fixed per version; a new bank gets a new `bank_version` and old tests keep
  theirs.
