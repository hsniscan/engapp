# 0073: v0.5.3 content: the full reading library, audio for every sentence, levels for Turkish learners

## Context

v0.5.3 fills three gaps in the content the app ships with:

- **C1, the library.** The graded library (ADR 0047) only wrote texts when the repository variable
  `GRADED_BULK=true` was set, had no A1 shelf, and reserved its batches on the app's own text
  budget (`CLAUDE_TEXT_MONTHLY_USD`, 10 US$). The stories and the in-app AI use that budget too.
  A 360-text run there would have used up the month for those features.
- **C3, the audio.** Word-bank example sentences had no pre-generated audio. The library was
  recorded in en-US only, so a reader who chose the British voice heard the device voice. The
  weekly top-up was opt-in. Nothing stopped the audio from filling the free R2 plan, which the
  database backups use too.
- **C5, the levels.** About 680 server-side level corrections for Turkish learners
  (`ref_word_levels.tr_*`) never reached the client level file. Guests, offline use and the level
  test use that file. Words Turkish has borrowed (microphone/mikrofon, penicillin/penisilin)
  were still graded like rare English words.

## Decision

### C1: the library

1. **The plan is 360 texts on A1–C1.** Per core topic: 8 at A1, 8 at A2, 8 at B1, 7 at B2 and
   5 at C1 (`LIBRARY_PER_LEVEL`, `scripts/lib/graded-plan.ts`). That is 80/80/80/70/50 over the
   ten core topics. `GRADED_PER_CELL=N` still asks N per topic on every level instead.
2. **A1 shelf.** A1 texts are 60–120 words in 1–3 short paragraphs. They use present simple and
   continuous, can, and simple past of common verbs, and are never childish. Each A1 slot has
   its own angles and genres. The coverage gate lets A1 texts use up to 5 % A2 words, against
   3 % at level + 1 on other levels (`coverageMaxNext`). A1 runs out of words at 3 %. The prompt
   is now `graded-v2`. Approved `graded-v1` texts stay.
3. **The texts are original and approved automatically.** The prompt says to write each text
   fresh and never retell or adapt a published text. The Haiku checker's "not copied" score
   still gates approval. Nobody approves texts by hand.
4. **The budget moved and got its own cap.**
   - Batches are reserved on the shared monthly Claude budget (`image_budget_*`, 80 % of
     `CLAUDE_MONTHLY_CREDIT_USD`). The holds use the purpose `batch`, so no migration is needed.
   - The library also has a monthly cap of its own: `GRADED_MONTHLY_USD`, default 20 US$. A
     manual run's `cap_usd` input overrides it. The cap is counted from `graded_batches`: the
     settled cost when collected, otherwise the held upper bound.
   - Both caps must allow a batch (`CappedBudgetStore`, `scripts/lib/graded-budget.ts`).
   - The app's text budget is no longer touched by the library.
5. **Default on, with a bulk job.**
   - The nightly run submits unless `GRADED_BULK=false`, which is now the kill switch.
   - The new `job=bulk` loops collect + submit every 5 minutes for up to 5.5 hours. It stops
     when nothing is in flight and nothing more can be sent, which means the plan is done or a
     cap was reached. Then it makes the audio in 6 shards.
   - The nightly run picks up whatever bulk leaves.
6. **Cost.** The plan prints about 4.9 US$ estimated and 12.9 US$ upper bound for the writer and
   checker round. Rewrites and re-planned failures add to that. The realistic total is
   6–9 US$, inside the 20 US$ cap.

### C3: the audio

7. **Bank examples are voiced.** `word_bank.senses[].example_en` of live rows joins the
   dictionary set (`publicTexts`). Clips are content-addressed, so a card made from the bank
   plays its sentence without any client change.
8. **The library is recorded in both accents.** The reader computes the British clip's path from
   the sentence (`ttsObjectPath('en-GB', en)`) and tries it first, then the stored en-US
   `audio_key`, then the device voice (`useVoicedClips`). A clip string can hold several
   space-separated paths.
9. **The weekly top-up is on** unless `TTS_PREGEN_WEEKLY=false`.
10. **Free-plan guard.**
    - The R2 free 10 GB is per account. The audio bucket (`R2_BUCKET`) and the backups (their
      own `R2_BACKUP_BUCKET`, or `backups/` in the audio bucket) are on the same account
      (`R2_ACCOUNT_ID`).
    - The pre-generation now makes at most its shard's share of what is left under
      `AUDIO_MAX_BYTES`: 6 GB on R2 by default, 0.9 GB on Supabase Storage. Clips past that are
      left out with a warning.
    - The backup guard (8 GB) now also counts the audio bucket when the backups have their own
      bucket.
11. **Size estimate.**

    | Audio                                      | Clips   | Size     |
    | ------------------------------------------ | ------- | -------- |
    | Today                                      | 27,866  | 305 MB   |
    | Bank examples, ~14,700 × 2 accents         | ~29,400 | ~0.6 GB  |
    | Library, ~7,200 sentences × 2 accents      | ~14,400 | ~0.37 GB |
    | New sentences of v0.5.3, ~44,000 × 2       | ~88,000 | ~1.8 GB  |
    | **Total**                                  |         | **~3.1 GB** |

    The backups are under 1 GB, so both accents fit with a wide margin. Recording sentences in
    one accent only is not needed. If it ever is, the guard stops the run first.

### C5: the levels

12. **Export the corrections.**
    - The sandbox and the client build cannot reach the database. So
      `level-jobs.yml` gets the input `export_tr`, which runs `system-jobs.ts export-tr`, then
      `build-levels.ts` and `relevel-level-test.ts`.
    - The job runs the level-data tests and opens a pull request with the new
      `client-levels.tsv`, `manifest.json` and `bank.json`.
    - `build-levels.ts` already merges `tr-corrections.tsv` into the client file. In the file,
      `reason_tr` is the server's reason.
13. **Familiar words.**
    - `scripts/build-tr-familiar.ts` finds English list words of 5 letters or more whose
      Turkish spelling is a common Turkish word. It uses suffix and letter rules
      (-tion→-syon, ph→f, c→k…) and Zipf ≥ 2.5 in the pinned wordfreq Turkish list. A word
      spelled the same in both languages must also be common in Turkish.
    - Known false friends (`data/reference/false-friends.en-tr.md`) are dropped.
    - A reviewed file, `data/levels/tr-familiar-review.tsv`, removes chance matches and partial
      friends (187 lines) and fixes three spellings.
    - The result is 411 words, one level easier (never below A2). They are written to
      `data/levels/tr-familiar.tsv`, the client file (reason `tanidik:<Turkish word>`) and the
      migration `20261106000300_tr_familiar_levels.sql`.
    - The migration never overwrites a server correction that is already the same or easier.
    - The word sheet explains the correction: "Türkçede de var: mikrofon".
14. **Level test.**
    - `scripts/relevel-level-test.ts` puts each test word at its list level after the
      corrections and recounts the band sizes.
    - When anything changed, it marks the bank version `…tr-<hash>`, so results from different
      banks are not mixed.
    - The step is idempotent. Today no test word moves, because familiar words are not in the
      bank; the export run may move some.

## Consequences

- The library fills in one manual run (`graded.yml`, job `bulk`) and keeps itself topped up
  nightly. Its money cannot touch the app's own AI features.
- `GRADED_BULK` changes meaning: unset now means on.
- All new audio stays inside the free plan by construction. A run that would pass the cap
  leaves clips out and warns, instead of billing.
- The familiar-word list is data. A wrong match is fixed by one line in the review file and a
  rebuild (`node scripts/build-tr-familiar.ts`). The unit tests fail when the generated files
  are out of step (`--check` does the same by hand).
- Tests:
  - `graded-plan`, `graded-jobs`, `graded-budget`, `graded-coverage` (A1);
  - `tts-pregen` (bank examples, both accents, guard, size);
  - `gradedAudio` (British first);
  - `tr-familiar`, `level-test-relevel`, `levelText`;
  - e2e `graded-library` (360 texts with A1, paging, offline).
