# 0012 — Word levels: one TypeScript rule, list data with a Turkish-learner check

## Context

v0.2 İP2 gives every word an A1–C2 level (plan İP2 and Annex A.4). The plan fixed the
priority (list level with a Turkish-learner correction > AI guess bounded by frequency >
frequency), the ±1 limit of the correction, `notes.level_override`, the `ref_*` tables, the
prompt bumps and a client level file. Building it showed several places where the plan's
first sketch did not hold; the choices below replace those parts of the plan.

Data sources and licences: docs/licenses.md (CEFR-J 1.5, Octanove C1/C2 1.0, wordfreq
3.1.1; Oxford, Cambridge EVP and Kelly are excluded).

## Decision

1. **One rule, in TypeScript only.** `resolveLevel()` (`supabase/functions/_shared/level.ts`)
   is used by the edge functions on insert, by the level job and by the web client
   (`src/domain/level.ts` re-exports it). There is no `level_resolve()` SQL twin and so no
   vitest/pgTAP agreement fixture: two implementations of the same rule would drift, and
   every writer of a level already runs TypeScript. SQL only stores levels and checks
   their shape (CHECKs on the columns, the ±1 CHECK on `ref_word_levels`).
2. **Frequency thresholds fitted on the list.** `ZIPF_THRESHOLDS` = 5.24 / 4.63 / 3.89 /
   3.01 / 1.62 (lowest Zipf of A1 … C1), fitted by `fitZipfThresholds()` on the 8 545
   single-word list lemmas with the smallest total band distance (an ordinal fit; maximising
   exact agreement alone collapses C1, whose words are as frequent as C2's). Exact
   agreement 39.6 %, within one band 86.1 %; the plan's 5.5 / 5.0 / 4.5 / 4.0 / 3.3 gives
   27.7 % and 68.1 %. Recorded in `data/levels/manifest.json`.
3. **The AI guess may sit up to two bands from the frequency band** (plan: one), then the
   plan's caps apply (Zipf ≥ 5 → at most B1, Zipf < 3 → at least C1). With frequency
   within one band of the list level for only 86 % of list words, a ±1 clamp would overrule
   correct guesses for the other 14 %; ±2 still stops absurd guesses.
4. **Expressions: source `words`.** A multi-word expression not in the list takes
   max(AI guess, hardest content word). When the guess decides, the source is `ai`; when
   only the words decide (no guess), the source is `words` (plan: `freq`), so the badge can
   say "İçindeki kelimeler" instead of claiming a frequency it does not have.
5. **Frequency coverage.** `ref_word_freq` and the client file keep words with Zipf ≥ 3
   (`FREQ_MIN_ZIPF`); a plain word missing from them is treated as rare (C1 by frequency).
   `level_refs()` returns `{min_zipf, rows}` so the rule knows the coverage of the data it
   got instead of assuming it.
6. **Turkish-learner check with code-side checks.** `level-tr-v1` answers only the words that
   move, each with a `kind` (`loanword`, `false_friend`, `one_turkish_word`) and a short
   Turkish reason. A live check showed the model moving loanwords the wrong way ("camera"
   A1 → A2 "because Turkish has kamera"), so code requires a loanword to get easier and the
   other kinds harder, and `looksBorrowed()` requires a loanword or false friend to quote a
   Turkish word that sounds like the English one (bigram Dice ≥ 0.5 over the consonant
   skeleton). The move is clamped to one step in code (`clampTrCorrection`, again in
   `listLevel`) and by a CHECK. Results are stored once per list entry with the list level
   they were made for (`tr_base_cefr`).
7. **Server job: GitHub Actions + the system budget.** `.github/workflows/level-jobs.yml`
   runs `node scripts/system-jobs.ts levels` nightly (02:30 UTC) and on demand: resolve →
   `level-guess-v1` for senses never asked → `level-tr-v1` → resolve. A workflow keeps the
   Gemini key a GitHub secret (as for deploys), retries the next night, and needs no
   pg_cron + `pg_net` + edge-function plumbing. Model calls go through
   `ai_system_consume()` (`AI_SYSTEM_DAILY_LIMIT`, default 100 per UTC day), never a user's
   `ai_usage`. It needs the service-role key (secret, or read with `SUPABASE_ACCESS_TOKEN`).
8. **Push keeps columns the payload leaves out.** `_sync_upsert` now updates only the
   columns present in the payload. Otherwise a device on the previous app version (no
   `level_override` in its note rows) would clear the user's level whenever it edited that
   note. Explicit nulls still clear; inserts are unchanged.
9. **Migrations** are `20261021001100_word_levels.sql` (schema, functions) and
   `20261021001200_ref_word_data.sql` (generated data), after the existing v0.2 migrations,
   instead of the plan's indicative `20261022000…` names.
10. **Client storage.** Dexie v4 adds `notes.level_override` (null) and sets
    `meta.lexicon_cursor` to 0 once so devices pull their lexicon rows again with the level
    columns. Backups are schema v4; v1–v3 files still restore (their checksums are checked
    without the fields they did not have).
11. **Client level file.** `data/levels/client-levels.tsv` (30 521 lemmas, Zipf ≥ 3 plus
    all list words; 494 KB, about 160 KB gzipped), imported with `?url` so Vite emits a
    hashed asset, fetched on first need and cached by the service worker with CacheFirst
    (`engapp-levels`), not precached, as in decision 0008. TSV instead of the plan's JSON:
    it is a third smaller and parses line by line. It gives every user, guests included,
    list and frequency levels offline; AI guesses reach only signed-in users, through the
    lexicon.
12. **Which level a note shows.** The level stored with the lexicon sense wins (it may
    include an AI guess); without one the client applies the rule to the level file. A note
    shows its first sense that has a level; a card shows its own sense's level. The user's
    `level_override` replaces both, for that user only (decision 0009: nothing is shared
    across accounts).
13. **Settings → Hakkında.** A new settings section holds the link to Kaynaklar
    (`/settings/kaynaklar`), the attribution page the licences require.
14. **Prompt scope.** `extract-v3` and `enrich-v2` add only `cefr_guess`. The plan's
    `false_friend_tr`, `topics` and LEVEL/TARGET_LEVEL belong to later work packages and
    will bump the prompt versions again.
15. **Tokenizer fix.** `IRREGULAR` in `_shared/tokenize.ts` is a null-prototype object, so
    lemmas such as "constructor" no longer hit `Object.prototype` (found by the level
    tests).

## Consequences

- Guests and offline devices see the Turkish-learner corrections only after
  `system-jobs.ts export-tr` + `build-levels.ts` and an app release; signed-in users get
  them through the lexicon the next night.
- The correction quality depends on the model. With the fallback model some bad reasons
  pass the checks ("calendar" A2 → A1 quoting "kalender"); the user can override a level,
  and a better model can redo the check by clearing `tr_checked_at`.
- A new list version changes `cefr` in `ref_word_levels`; corrections made for the old level
  stop applying (`tr_base_cefr`) and the job checks those entries again.
