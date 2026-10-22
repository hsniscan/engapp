# 0038 — Kelime Bankası (word bank)

**Context.** Users who do not read English texts yet have nothing to import: they need a ready
list of words for their level to pick from. The reference lists (`ref_word_levels`, CEFR-J 1.5
and Octanove C1/C2, decision 0012) hold ~8,850 leveled lemmas (9,983 lemma + part-of-speech
rows). The v0.4 plan asks for a "Kelime Bankası" screen that shows them with Turkish meanings
and an example, works offline and for guests, and adds a word through the normal add path.
Generating the content per user would cost every time and send the same requests again and
again, so it is generated **once** for everybody.

## Decision

### Server (migration `20261026001100_word_bank.sql`)

- **`public.word_bank`**: one row per `(lemma_norm, pos)` of the lists: `lemma` (display form,
  same word as `lemma_norm`), `cefr`, `list_source` (`cefrj`/`octanove`), `zipf`,
  `lexicon_term_id` (null when the lexicon could not store the term), `senses` (1–3
  `{meaning_tr, example_en, example_tr, sense_id}`, most common first, ≤ 4,000 bytes),
  `retired`, `server_seq`, plus the job's bookkeeping (`model`, `prompt_version`, `cost_usd`,
  `created_at`, `updated_at`). System content only: never a user's text (AGENTS.md rule 5).
- **Public read.** RLS on; `anon` and `authenticated` may `select` only the device columns
  (`lemma_norm, pos, lemma, cefr, list_source, zipf, lexicon_term_id, senses, retired,
server_seq`); no client writes. This is the first table a guest reads: the content is the
  same for everyone and contains nothing personal, and guests must be able to use the bank.
  `00_rls_enabled.test.sql` now allows exactly this column grant to `anon` and nothing else.
- **Delta pulls.** `server_seq` comes from `word_bank_seq`, stamped by a trigger under an
  advisory lock (as the lexicon), and moves only when a row really changes. A device asks for
  `server_seq > cursor`, 1,000 rows a page. Retiring a row (`retired = true`) moves it past the
  cursors so devices delete it.
- **Job tables (service role only):** `word_bank_jobs` (per word: `queued`/`submitted`/`done`/
  `failed`, `attempt`, `batch_id`, `custom_id`, `last_error`, the request `input` while it is in
  flight) and `word_bank_batches` (one per Message Batch: budget `hold_id`, `reserved_usd`,
  `requests`, `model`, `prompt_version`, `state`, real `cost_usd`).
- **Functions (service role only):** `word_bank_pending(limit)` (list words without a bank row
  and not in flight, easiest and most frequent first, with the Turkish-learner level correction
  and CEFR-J preferred over Octanove) and `word_bank_put(rows)` (upsert only-if-changed, marks
  the jobs done).
- **Budget.** The job uses the same monthly Claude budget as the pictures (decision 0030):
  `image_budget_reserve`/`settle` with the new purpose `wordbank` (the purpose check is
  widened). `image_budget_release_stale` now skips `wordbank` holds as it skips `batch` ones:
  a batch may take up to 24 h, its hold is settled by the collect step.

### Job (`scripts/word-bank.ts`, `.github/workflows/word-bank.yml`)

- **Prompt `wordbank-v1`** (`scripts/lib/word-bank-prompt.ts`, `docs/ai-pipeline.md` "Word
  bank"): Claude Haiku through the **Message Batches API** (half price), structured JSON output,
  adaptive thinking at effort low. The model id comes from `CLAUDE_WORDBANK_MODEL`, else
  `CLAUDE_CHECK_MODEL`, else the default check model in `_shared/image-models.ts` (never
  hard-coded in the job).
- **Lexicon first (rule 6).** For each word the job reads the lexicon term and its senses of the
  same part of speech (near-duplicates skipped, at most 3):
  - every sense has a fitting shared example → the row is stored at once, no model call;
  - some senses lack one → they are sent as `given` meanings: the model writes only their
    examples, never new meanings;
  - no senses → the model lists 1–3 meanings, which are written to the shared lexicon through
    `lexicon_upsert` (so later cards and other features reuse them) and linked by `sense_id`.
- **Quality checks** on every answer: schema, clean Turkish and English text, the example
  contains the word (exact, phrasal-verb gap or a regular ending: `exampleSpan`), a word limit,
  meanings that are near-duplicates of each other or of a given one dropped, and a display
  lemma that is not the same word falls back to the list form. A rejected answer is asked again with the problem named
  (`problemText`), at most 3 attempts, then the word is marked `failed`.
- **Idempotent and resumable.** A word with a bank row or a submitted request is never sent
  again; a crash leaves submitted rows the next `collect` reads; rows that a finished batch
  did not answer go back to `queued`.
- **Cost guard.** The whole batch's upper bound (input + `max_tokens` output at batch price)
  is reserved before anything is sent; when the budget refuses, the batch is halved until it
  fits or nothing is sent. Expected cost ≈ $0.0002 per word (≈ $2 for the whole list), upper
  bound ≈ $0.0008 per word.
- **Workflow** `Word bank job`: by hand with `plan` (report only, no Claude key needed), `run`
  (collect, submit, plan), `collect` or `submit` (`max`, `dry_run`). A nightly run at 03:45 UTC
  happens only when the repository variable `WORD_BANK_NIGHTLY` is `true`.

### Client

- **Dexie v24**: table `word_bank` (`id = lemma_norm|pos`, indexes `cefr`, `lemma_norm`) and
  meta keys `word_bank_cursor` / `word_bank_synced_at`. Device-level content: kept when
  switching or copying accounts, not in backups, never synced up.
- **Download** (`features/wordbank/fetcher.ts`): when the screen opens, at most once a day (or
  on "Tekrar dene"), pages after the cursor; offline or without a backend it does nothing.
  After the first download the screen works fully offline.
- **Screen `/kelime-bankasi`** (`WordBankPage`), linked from the add screen and from
  Ayarlar → Kaynaklar: level tabs A1–C2 (default: the user's level), search over the English
  word and the Turkish meanings (Turkish-insensitive fold, across levels), part-of-speech
  filter, a "show known/carded" switch (off by default). A row shows the word, its Turkish
  meanings, part of speech, level badge and a known / card marker; the details show every
  meaning with its example and let the user pick which meanings to add. "Ekle" adds one word,
  checkboxes and the selection bar add several.
- **"Bu seviyeden 10 kelime ekle"** (`domain/wordBank.ts` `pickLevelMix`): ~55 % from the
  level X, at most 10 % from X+1, the rest from lower levels (nearest first), never above X+1
  and never a word that is known or already has a card; by frequency within a level. When the
  lower levels run short (A1, or few words left), level X fills the gap.
- **Adding** goes through `addNoteWithSenses` (`data/wordBank.ts` `bankNoteInput`): the term,
  `lexicon_term_id`, each chosen sense with `lexicon_sense_id`, its example as
  `source_sentence`, its Turkish translation as `source_sentence_tr` and the word's span. It is
  the same path as manual adding: guests get local notes that move to their account on
  sign-in, and nothing the user owns is written to the shared tables.
- **Attribution**: the screen's footer names CEFR-J and Octanove (CC BY-SA 4.0) and that the
  meanings and examples were generated with AI, linking to Kaynaklar, which has its own
  section.

## Acceptance criteria and tests

| Criterion                                                                                                                                                                                     | Test                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Bank table readable by guests and users, only device columns, no client writes, job tables and functions service-only                                                                         | `supabase/tests/database/26_word_bank.test.sql` (31), `00_rls_enabled.test.sql` |
| Pending order, CEFR-J preference, TR correction, only-if-changed upsert, retire moves the cursor, budget hold purpose and stale release                                                       | `26_word_bank.test.sql`                                                         |
| Job: lexicon reuse without a model call, given senses, new senses to the lexicon, quality checks, retries and give-up, budget reserve/halve/settle, idempotent re-runs, collect after a crash | `scripts/lib/word-bank-jobs.test.ts` (14, fakes, no live calls)                 |
| Filtering, Turkish search fold, level counts, level mix limits (property test)                                                                                                                | `src/domain/wordBank.test.ts` (8, fast-check)                                   |
| Dexie v24 upgrade keeps data and adds the table                                                                                                                                               | `src/data/db.test.ts`                                                           |
| Pages applied, retired rows removed, cursor; adding through the normal path with lexicon links; guest data moves on sign-in; device copy kept on account switch                               | `src/data/wordBank.test.ts` (6)                                                 |
| Download pages, daily refresh, offline / no backend / failure                                                                                                                                 | `src/features/wordbank/fetcher.test.ts`                                         |
| Screen: user's level, hidden owned words, search, single and multi add, quick add mix, empty state                                                                                            | `src/features/wordbank/WordBankPage.test.tsx` (5)                               |
| Guest end to end with a mocked backend, offline reopen, axe at 360 px light and 1280 px dark                                                                                                  | `tests/e2e/word-bank.spec.ts`                                                   |

## Deviations and trade-offs

- **A separate public table, not only the lexicon.** The lexicon is pulled by devices only for
  senses they reference and is keyed by sense; the bank needs every list word with level,
  frequency and a chosen example in one small, public, delta-pulled table. Meanings still live
  in the lexicon (`sense_id`), the bank row is a view over them plus one example each.
- **Generated examples are not written to `lexicon_examples`.** That table has its own levels,
  checks and per-user feedback flow (decision 0013); mixing bank examples in would change what
  the example panel shows. The bank keeps its example in its own row; the lexicon's examples
  are reused when they fit.
- **No new meanings when the lexicon already has some** for that word and part of speech: the
  model only writes examples for them. A word whose lexicon entry lacks a common meaning keeps
  that gap until the lexicon gains it; this keeps one source of truth for meanings.
- **First anonymous read grant.** Until now `anon` had no privileges in `public`. The grant is
  limited to the bank's device columns and covered by the RLS test.
- **Share-alike.** The rows are derived from Octanove (CC BY-SA 4.0) and CEFR-J, so the bank
  content is shared under CC BY-SA 4.0 too (`docs/licenses.md`), stated in the app.
- **Budget function change.** `image_budget_release_stale` is redefined to skip `wordbank`
  holds; picture holds behave as before.
