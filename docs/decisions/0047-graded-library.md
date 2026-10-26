# 0047 — Graded reading library and the monthly text-AI budget

**Context.** v0.5 (İP5) adds a library of short English texts written for each level, A2 to
C1, with a Turkish translation and audio for every sentence. Users read them in the reader
(İP1), offline after the first open. "Sana uygun" suggests the texts that fit the user's reading
difficulty, measured against the words they know. The texts are written by Claude in nightly
batches. Like pictures, that spending needs a hard monthly cap, and the reader's story feature
needs the same cap for its own calls.

**Decision.**

- **Table `public.graded_texts`** (migration `20261101000510`). It holds the plan appendix A.2
  columns, plus `words`, `tokens`, `lemma_profile` (running-word counts per dictionary form),
  `coverage_by_level`, `cov_level`, `cov_next`, `above_unglossed`, `glosses`, `target_lemmas`,
  `status` (`checking` → `approved` | `rejected`), prompt and check versions, models and cost.
  `server_seq` is stamped under an advisory lock, as in the word bank. `approved_at` is set once
  and kept.
  - **Public read** covers rows with `approved_at is not null`, through a column grant that
    leaves out cost, models, checks and plan key. A withdrawn text stays visible with its new
    status, so devices drop it.
  - **No client writes.** Only the service role writes, through the job tables `graded_jobs`
    and `graded_batches`.
  - **No user text ever goes in.** The writer sees only the plan item: level, topic, angle,
    genre and length.
- **Monthly text budget** (migration `20261101000500`). It uses its own `text_budget` and
  `text_budget_holds` tables, not a `kind` row on `image_budget`, so the picture functions stay
  as they are.
  - The cap is `CLAUDE_TEXT_MONTHLY_USD`, default **10 USD**.
  - `text_budget_reserve` holds the worst-case cost of a call before it is sent.
    `INSERT … ON CONFLICT … WHERE` serialises concurrent reservations, so the cap holds under
    any concurrency. It refuses a hold that would pass the cap.
  - `text_budget_settle` replaces the hold with the real cost from `usage`.
  - Stale non-batch holds are released after a day. A batch hold lives until the batch is
    collected.
  - `_shared/text-budget.ts` exports `textMonthlyCapUsd`, `reserveTextBudget`,
    `settleTextBudget` and `recordTextSpend`. `recordTextSpend` wraps reserve, call and settle;
    a failed call settles at 0. Every later text feature uses these helpers.
- **Pipeline** (`scripts/graded-batch.ts`, `.github/workflows/graded.yml`). Jobs are `plan`,
  `collect`, `submit`, `audio` and `report`. It runs nightly at 02:15 UTC and by hand.
  - **Submit runs only when `GRADED_BULK=true`.** It sends Message Batches at half price. If a
    batch would pass the cap, it is halved until it fits.
  - **Writer `graded-v1`:** Sonnet (`CLAUDE_GRADED_MODEL`), adaptive thinking, structured output
    `{title, sentences:[{en, tr, new_paragraph}], target_lemmas, glosses}`. Lengths per level:
    A2 150–250 words, B1 220–350, B2 320–480, C1 420–600.
  - **Topics:** the profile interests plus the owner's ten (business English … news), all
    timeless and never real news.
  - **First plan:** 4 levels × 10 core topics × 9 = **360** texts, each with its own angle and
    genre. The 9 extended topics start at 0 per cell (`GRADED_EXTENDED_PER_CELL`).
  - **Coverage gate** (Node, `_shared/graded-coverage.ts`, client-levels word lists):
    - at least 95 % of tokens at or below the level;
    - at most 3 % at level+1;
    - nothing above level+2 unless it is glossed;
    - proper nouns are not counted.

    A text that fails is rewritten once, with the offending words to avoid. A second failure is
    rejected.

  - **Checker `gradedcheck-v1`:** Haiku (`CLAUDE_CHECK_MODEL`). It approves only a text that is
    natural, fits the level, has a correct translation, is safe, has no false facts and is not
    copied.
  - **Audio:** every sentence of an approved text gets an en-US clip through the Kokoro
    pre-generation (0042, `--source graded`). `audio_key` is the content-addressed tts path
    `en-US/<hash>.mp3`, not a per-text path, so identical sentences share one file and the
    existing bucket and workflow are reused.
  - Tests use recorded fixtures only. Model ids come only from the environment.
- **Device** (Dexie v31). The work has three parts:
  - **Catalogue.** `graded_catalog` holds metadata only, including `lemma_profile`. It is pulled
    by cursor (pages of 500 after `server_seq`). The library pulls it when opened, and a
    signed-in user's device also pulls it after each sync and on coming back online. It is
    refreshed at most every 6 hours, and rows that are no longer approved are deleted.
  - **Bodies.** `graded_bodies` holds a text's sentences, fetched on first open and read offline
    after that (`getGradedBody`). Both tables survive sign-out and account copy: the data is
    public and nothing in them belongs to the user.
  - **Suggestions.** `suggestedGradedTexts` measures each profile with `loadKnowledge()` and
    `measureCoverage`, then places it with `bandFit` against `reading_difficulty` (default
    `dengeli`). It suggests only texts inside the band. Interests come first, then the text
    nearest the band centre, and finished texts go last. When no text is inside the band, the
    closest easier ones are suggested. A harder text, or one over the 10 % cap, is never
    suggested. It makes no network call.
  - **List.** `GradedLibraryList` (`/kitaplik`, and Desteler → Okuma) shows "Sana uygun", level
    and topic filters, and a chip per text with "%NN anlaşılır · Uygun/Kolay/Zor". Opening a
    text reuses its `texts` row (`kind: 'graded'`) or makes one, then goes to `readerPath(id)`.
  - UI strings are under the `gradedLibrary` namespace, because `library` already belongs to
    the cards library.

**Consequences.** One Sonnet text with its check costs about 0.02–0.04 USD at batch price, so
the first 360 fit in about one month's default cap. The worst-case hold is larger (full
`max_tokens`), so the first batch may be halved and the plan finished over a few nights. The catalogue with lemma profiles is about
1 KB per text before gzip. Until the reader's knowledge model lands, the stub's `pKnown` of 0.5
puts every text above the band. "Sana uygun" then shows its "no text fits" note while the full
list still works.
