# 0077 — v0.5.3: Claude Sonnet is the primary text AI, Gemini the fallback

## Context

The owner asked on 2026-11-05: "claude sonnete geç gemini yerine" (use Claude Sonnet instead
of Gemini). Until v0.5.2 every text AI task (ai-extract, ai-enrich, ai-themes, ai-mnemonic,
ai-contrast, ai-report) ran on Gemini (free tier) and went to Claude Haiku only when Gemini ran
out of quota (decision 0044); the daily story ran on Claude Haiku alone (decision 0050); the
batch jobs (nightly level job, morpheme meanings, level-test bank) called Gemini directly with
no money guard at all. Claude calls of the edge functions were held to the monthly text budget
(`CLAUDE_TEXT_MONTHLY_USD`, default 10 USD, decision 0047) and a per-user share (decision 0060).

Sonnet 5.5 costs 2 / 10 USD per million input / output tokens, 20× Haiku 5.5 (0.10 / 0.50).
The guards were sized for Haiku: 1 USD a month per user was ~300 Haiku extractions but only
~25 on Sonnet, and the level job's 100 calls a night would cost ~2 USD a night on Sonnet and use
up a 10 USD month in five nights.

Checked every caller of a text model: the six text functions and ai-story (edge), the level job
(`scripts/system-jobs.ts`), `scripts/build-morphology/meanings.ts`, `scripts/build-level-test.ts`.
OCR ("Fotoğraftan metin") runs on the device (Tesseract / ML Kit) and calls no model.
`scripts/golden-extract.ts` records Gemini answers on purpose (fixtures) and stays on Gemini.
Pronunciation audio of a word with no pre-made file stays on Gemini TTS (Claude has no TTS).
The graded library and the word bank were already Claude jobs on Message Batches.

A latent bug: the Claude fallback booked its holds with purpose `ai-fallback`, which the
`text_budget_holds.purpose` CHECK (`^[a-z][a-z0-9_]{0,31}$`) rejects, so every budgeted Claude
fallback call would have failed with a database error. Purposes are now normalised
(`budgetPurpose`) and named after the function (`ai_extract`, `ai_enrich`, …).

## Decision

1. **Provider chain** (`_shared/ai.ts`, `createTextAiProvider`): Claude first
   (`CLAUDE_TEXT_MODEL`, default `claude-sonnet-5-5`, only in `model-defaults.ts`), Gemini
   behind it after **any** Claude failure: budget or share used up (nothing is sent), 429 / 529
   / 5xx, a bad key, a timeout, a refusal, a 400, or an answer that fails the task's validation.
   Gemini is free, so trying it costs nothing and the app never stops when the money is gone.
   When both fail, a quota error wins (the client waits and retries). One Claude attempt and no
   SDK retry when Gemini is behind it, so the fallback fits the function's wall clock.
   No Anthropic key, `AI_CLAUDE_FALLBACK=off`, or no budget → Gemini alone; no Gemini key →
   Claude alone. `AI_TEXT_PRIMARY=gemini` restores the v0.5 order as an emergency switch.
2. **No Claude call without a budget hold.** `createTextAiProvider` turns Claude off when it
   gets no budget (tests opt in with `unbudgeted`). The batch jobs use the same chain through
   `scripts/lib/system-ai.ts`; without the service-role database (a local run) they are
   Gemini-only.
3. **Shares of the month** (all also count against the month, so the total never passes
   `CLAUDE_TEXT_MONTHLY_USD`):

   | who | variable [default] | at 10 / 20 / 30 USD |
   | --- | --- | --- |
   | a user | `AI_USER_MONTHLY_USD` [2, was 1], at most `AI_USER_MAX_SHARE` [0.2, was 0.1] | 2 / 2 / 2 |
   | the owner (`APP_ADMIN_USER_ID`) | `AI_OWNER_MAX_SHARE` [0.75] of the cap | 7.5 / 15 / 22.5 |
   | system jobs | `AI_SYSTEM_MONTHLY_USD` [2], at most `AI_SYSTEM_MAX_SHARE` [0.15] | 1.5 / 2 / 2 |
   | graded library, word bank | the month (owner-run, `GRADED_BULK`) | — |

   The system jobs get their own **pool** (migration `20261106000700_text_budget_pools.sql`:
   `text_budget_pools`, `text_budget_reserve_pool`, `text_budget_settle` / `text_budget_maintain`
   extended, same rules as the per-user share). The level job keeps `AI_SYSTEM_DAILY_LIMIT`
   (calls a day); the pool adds a money cap. A used-up pool sends the job to Gemini.
   The owner's share is the larger one because the owner is the only active user; other
   accounts stay at 2 USD, so one stranger cannot drain the month.
4. **Request shape on Sonnet** (`_shared/ai-claude-text.ts`): structured output
   (`output_config.format` json_schema via `toClaudeSchema`), `effort: low`,
   `thinking: {type: "between_tools"}` (Sonnet 5.5 rejects `disabled`; extended thinking would
   only add output tokens and seconds to short structured answers; `MODELS_WITHOUT_TEXT_THINKING`
   in `model-defaults.ts`), `max_tokens` = the task's own `maxOutputTokens` (no 2048 thinking
   head room; a thinking model named by a variable still gets it). No temperature / top_p
   (Sonnet 5.5 rejects non-default sampling), no prefill, no forced tool choice. The system
   prompt is one block with `cache_control: ephemeral`: the chunks of one article read the
   2 100-token extract prompt at 10 % after the first.
5. **Worst case booked, not hoped for.** Each call reserves its upper bound first (every input
   token as a 1-hour cache write, every `max_tokens` used). An API error with a status is not
   billed and settles at 0; a timeout or broken connection **may** be billed and now settles
   at the whole bound (`AiError.maybeBilled`, also in `recordTextSpend` for the story).
6. **The story** runs on Claude (`CLAUDE_STORY_MODEL`, else `CLAUDE_TEXT_MODEL`: Sonnet), with
   Gemini behind it (budget or share used up, Claude not answering, no Anthropic key). Timeout
   per call 25 s (12 s on Haiku); Sonnet writes slower.
7. **Privacy text**: Anthropic is the primary AI processor; Google Gemini stays as the backup
   processor and for reading aloud. The settings "Kaynaklar" text names both.

### Worst-case reservation per call (Sonnet, the bound held until the real cost is booked)

| task | `max_tokens` | bound |
| --- | --- | --- |
| ai-extract (8 000-char chunk) | 32 768 | ≈ 0.35 USD |
| ai-themes | 4 096 | ≈ 0.05 USD |
| ai-enrich | 2 048 | ≈ 0.025 USD |
| ai-mnemonic / ai-contrast / ai-report | 1 024 | ≈ 0.013 USD |
| ai-story (2 attempts at most) | 2 048 + 2 048 | ≈ 0.045 USD per attempt |
| level job call (100 items) | 8 192 | ≈ 0.09 USD |

The per-feature daily counts (`AI_DAILY_LIMIT` 120, extract 60, enrich 60, themes 10, mnemonic
20, contrast 20, report 4) stay: they also protect Gemini's free-tier quota. On Sonnet they are
no longer the money guard (60 long extractions could cost ~12 USD in a day); the monthly
**money** share is, and it is checked before every call. A user whose share is used up keeps
working on Gemini.

## Cost estimate: the owner as the only active user

Typical cost of one call on Sonnet 5.5 (input incl. system prompt and schema, Turkish output):

| action | tokens in / out | USD |
| --- | --- | --- |
| extract one text chunk (~25 new words) | ~4 200 / ~3 000 | ~0.040 |
| meanings of one word (enrich) | ~1 600 / ~600 | ~0.009 |
| themes | ~2 500 / ~1 500 | ~0.020 |
| mnemonic / contrast / weekly report | ~900 / ~350 | ~0.005 |
| daily story or "my words" text | ~1 100 / ~900 | ~0.011 |
| level job call | ~2 700 / ~1 400 | ~0.020 |

Cache and dictionary hits never reach the model (AGENTS.md rule 6), so "calls" below are model
calls, not taps.

| usage (model calls a day) | mix per day | Sonnet USD / month (no cap) |
| --- | --- | --- |
| light (~11) | 3 chunks, 5 words, 1 mnemonic, 1 contrast, 1 story | ~6 |
| typical (~25) | 8 chunks, 10 words, 3 mnemonics, 2 contrasts, 2 stories | ~14 |
| heavy (~70) | 25 chunks, 30 words, 10 mnemonics, 3 contrasts, 2 stories, themes | ~41 |

(On Haiku the typical month was ~0.7 USD.) What each cap gives the owner (75 % share) before
Gemini takes over; the bill can never pass the cap:

| monthly cap | owner's Sonnet money | mixed actions (~0.018 USD) | or chunks only | or words only | typical use on Sonnet | heavy use on Sonnet |
| --- | --- | --- | --- | --- | --- | --- |
| 10 USD | 7.5 | ~415 | ~185 | ~830 | ~16 days, then Gemini | ~5 days |
| 20 USD | 15 | ~830 | ~375 | ~1 650 | the whole month | ~11 days |
| 30 USD | 22.5 | ~1 250 | ~560 | ~2 500 | the whole month | ~16 days |

Plus the system pool (1.5 / 2 / 2 USD) while the level job still has work: its Turkish-learner
check of ~10 000 list entries is ~100 calls ≈ 2 USD once, then a few guesses a night.

**Recommendation:** set `CLAUDE_TEXT_MONTHLY_USD` to 20 (repository variable): typical use
stays on Sonnet all month. The picture budget is separate (80 % of `CLAUDE_MONTHLY_CREDIT_USD`):
with the default 100 USD credit, a 20 USD text cap keeps pictures + text within the credit; 30
would not.

## Why

- The owner wants Sonnet's quality; Gemini as the fallback keeps the app working at zero cost
  when the money for the month is gone, instead of failing.
- Money guards, not call counts, bound a 20× more expensive model; a pool for the jobs stops a
  nightly job from silently eating the users' month.
- Falling back on every Claude failure (not just quota) costs nothing extra and covers schema
  or refusal differences between the providers.

## Known issues / follow-ups

- Sonnet writes slower than Gemini Flash. A vocabulary-list chunk with ~150 items (~18 000
  output tokens) does not finish in ai-extract's 60 s: it times out, is booked at its bound
  (~0.35 USD) and Gemini answers. Prose chunks (~3 000 tokens) fit. If the function logs show
  many `provider fallback` lines with timeouts for ai-extract, the next step is streaming with a
  deadline, or sending list-shaped chunks straight to Gemini.
- Story latency goes from ~5 s to ~10–20 s on Sonnet; the client waits up to 150 s.
- `text_budget_pools` rows are not purged (one row per pool and month).

## Owner's cap (2026-11-05 21:26 UTC)

The owner chose **30 USD a month** for the Claude text budget. `DEFAULT_TEXT_MONTHLY_USD` and the
workflows' fallback are now 30, so no repository variable is needed. At 30 USD the owner's share is
22.5 USD (about 1,250 mixed actions), users 2 USD each, system jobs 2 USD. The Anthropic Console
spending limit must leave room for it on top of the picture budget.
