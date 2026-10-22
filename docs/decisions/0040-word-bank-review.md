# 0040 — Kelime Bankası review pass

**Context.** The word bank (decision 0038) was filled once by Claude Haiku: ~9,545 rows with
1–3 meanings and one example each. A check by eye found about one meaning in twenty wrong: a
wrong sense (scythe → "ölüm meleği"), junk in a translation (arena: "Things: iş dünyasına
girmek istiyor"), a second meaning that the example does not show (relative → "yakın"), a
meaning that does not fit the example (in → "için" with "She is in a hurry"; the → "her, her
bir"; all → "her şey" with "I ate all of my lunch"), wrong usage ("She felt reminiscent") and
redundant translations. Duplicate meanings ("davetiye, davet" next to "davet") are not allowed.
The rows are already on devices, and users have made cards from them.

## Decision

- **A one-time review job, rerunnable.** `scripts/word-bank.ts review-submit [--max N]
[--dry-run]` and `review-collect`; workflow `Word bank job` gains `review-plan` (the dry run:
  rows left, requests, estimated and upper-bound cost; no Claude key needed) and `review`
  (collect finished review batches, then send the rest; `max`, `dry_run`). Every non-retired
  bank row without a review is sent once, **25 rows per request** (the system prompt is paid
  per group, not per word), as one Message Batch (half price).
- **Model: Claude Sonnet 5.5** (`DEFAULT_WORDBANK_REVIEW_MODEL` in `_shared/image-models.ts`,
  overridable with the repository variable `CLAUDE_WORDBANK_REVIEW_MODEL`): a stronger model
  than the one that wrote the rows, so it catches what Haiku got wrong, and still within the
  US$1–2 target because the prompt is compact and the answer lists only the changes. Without
  extended thinking (`thinking: between_tools`, there are no tools): the judgment is short and
  thinking would roughly double the output cost. Estimate for 9,545 rows at batch price
  ($1 / $5 per million tokens): **≈ $1.9 expected** (input counted at the deliberately high
  3-characters-per-token bound; the real figure should be lower), **≈ $13.5 upper bound**
  reserved on the shared monthly Claude budget (purpose `wordbank`, 80 % of
  `CLAUDE_MONTHLY_CREDIT_USD`). Haiku would cost ≈ $0.1 but checks its own kind of mistakes;
  Opus ≈ $3.8.
- **Answer: only the changes** (`wordbank-review-v1`, `docs/ai-pipeline.md`): per wrong meaning
  `fix` (only the parts that change; an English definition when the Turkish meaning changes)
  or `drop`, with a reason of a few words. Meanings not named are kept.
- **Same checks as generation** (`reviewRow`): clean Turkish meaning ≤ 120 characters without
  brackets, the example containing the word or a regular inflection (`exampleSpan`), ≤ 20
  words, a Turkish translation that is not the English sentence (a new example needs one), no
  near-duplicate meanings in the row afterwards (`isDuplicateSense`, then the same lexicon
  sense; the later one goes). A rejected fix leaves that meaning unchanged; the row is asked
  again once with the problem named (`REVIEW_MAX_ATTEMPTS` = 2) and then the valid changes are
  applied. An answer that is not usable (not JSON, schema, `max_tokens`, refusal) asks its whole
  group again once, then the rows are marked `failed` (left as they are).
- **At least one meaning.** The prompt forbids dropping every meaning (fix the best one
  instead). If it happens anyway, the row is **retired** (devices delete it on their next
  pull). This is the simplest safe choice: regeneration would ask the lexicon again and could
  bring back the same wrong meaning. A retired row keeps its senses (also in
  `word_bank_review.previous_senses`) and can be restored by hand with
  `update public.word_bank set retired = false where ...`.
- **Lexicon.** A fix that changes the Turkish meaning is a different meaning, so it is written
  through `lexicon_upsert` (insert-or-get with the near-duplicate guard, as generation does)
  and the bank sense links the returned sense id; an example-only fix keeps the old link.
  **Existing lexicon senses are not edited**: users' notes, pictures and examples point to them
  and other features (ai-extract, ai-enrich) reuse them, so changing a shared meaning is a
  separate, reviewed step (as in 20261021001000). The senses judged wrong are recorded in
  `word_bank_review.outcome` (`fixed[].old.sense_id`, `dropped[]`) for that later step. This
  is not "regenerating what the lexicon has" (AGENTS.md rule 6): it is a quality check.
- **Server (migration `20261026001300_word_bank_review.sql`).** `word_bank_review` (one row
  per bank row: `state` queued/submitted/done/failed, `attempt`, `batch_id`, `custom_id` of the
  group, `last_error`, `input` while in flight, `outcome`, `previous_senses`, `model`,
  `prompt_version`, `cost_usd`, `reviewed_at`) and `word_bank_review_batches` (budget hold,
  reserved and real cost), both service-role only, apart from the generation tables so the
  generation `collect` never reads a review batch. `word_bank_review_pending(limit)` and
  `word_bank_review_apply(rows)`: a row is changed only while it still has the senses that
  were reviewed (otherwise its review goes back to `queued`, `stale`), so a review never
  overwrites a newer row. `public.word_bank` and its device columns are unchanged.
- **Reaching devices.** Applying a change updates `senses` (or `retired`); the existing stamp
  trigger gives the row a new `server_seq`, so every device pulls it on its next bank download
  (when the screen opens, at most once a day) and replaces its copy; a retired row is deleted.
  A row the review keeps is not written, so it does not move (no needless re-download).
- **Users' cards are not touched.** Adding a bank word copies its meaning, example, translation
  and `lexicon_sense_id` into the user's own note (decision 0038), so existing cards keep what
  they had (the user can edit them); only words added after the review get the corrected text.
  The bank screen marks words as carded by term, not by sense id, so a changed or dropped sense
  breaks nothing.
- **Logging.** `review-collect` logs rows, rows changed, meanings kept / fixed / dropped,
  rows retired, fixes rejected, retried, failed, stale, new lexicon senses, cost and the
  problems, and prints up to 40 example changes as `lemma (pos) fix: old → new [reason]` for a
  person to check in the job log. No secrets are printed.

## Acceptance criteria and tests

| Criterion                                                                                                                                  | Test                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Prompt sends only words, part of speech, level and meanings; answer parsing; docs verbatim                                                 | `scripts/lib/word-bank-review.test.ts`                      |
| Fix / drop / keep, generation checks, case-only fix is no change, near-duplicates removed, retire when nothing is left                     | `word-bank-review.test.ts` (`reviewRow`)                    |
| Dry run cost; full bank within ≈ $2 expected; groups of 25; budget reserve, halving, settle                                                | `word-bank-review.test.ts`                                  |
| Collect applies changes, links new meanings in the lexicon, records the review, moves only changed rows; retries; stale rows; ≤ 40 samples | `word-bank-review.test.ts`                                  |
| Pending rows, apply only-if-unchanged, cursor moves, retire, service-role only                                                             | `supabase/tests/database/27_word_bank_review.test.sql` (20) |

## Trade-offs

- The model sees 25 words at once; a mistake it does not name stays. A second review with
  another prompt version is possible (reset `word_bank_review` rows to `queued`).
- The wrong lexicon senses themselves stay until a reviewed lexicon clean-up.
- Only the bank row and new lexicon senses change; cards made before the review keep their
  text.
