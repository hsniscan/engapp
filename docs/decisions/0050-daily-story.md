# 0050 — Bugünün hikâyesi (the daily story)

**Context.** v0.5 İP8 (plan `v0.5-plan.md`, İP8, appendix A.6, acceptance criteria 7 and 10).
Once a day the learner gets a short English text built around 5–8 of their own words, fitted
to their level, reading difficulty (decision 0043 bands, 10 % cap) and interests, read in the
reader with three comprehension questions. It is practice: it must never change FSRS state or
`review_logs`, and only the word list and the level may leave the device.

## Decision

### Server: `ai-story`

- `POST /functions/v1/ai-story` (`_shared/story-contract.ts`, prompt `story-v1` in
  `_shared/story-prompt.ts`, pipeline `_shared/story.ts`, docs `docs/ai-story.md` kept verbatim by
  `src/ai/story-docs-sync.test.ts`). Wired by `createStoryFunction` in `_shared/setup.ts`.
- **The request is closed** (`z.strict()`): `level`, `difficulty`, at most three topic keys,
  5–8 lower-case dictionary forms, and `avoid` (see below). Anything else is `invalid_input`
  before any count or call. The user turn sent to the model is exactly those fields (snapshot
  test in `story.test.ts`; key check in the e2e test).
- **Auth** as every AI function: a signed-in, non-anonymous Google session; `user_id` only
  from the token.
- **Daily counter** `story_usage` + `story_consume` / `story_refund` (migration
  `20261101000800_story.sql`, service role only, RLS on without policies, purged after 90 days,
  pgTAP test `50_story.test.sql`): **one story per user and UTC day** (`STORY_DAILY_LIMIT`,
  default 1) **plus one regeneration of it** (a request with a non-empty `avoid`). A request
  that ends without a story (model failure, budget, unusable answers) is refunded, so a
  failure never costs the day's story. The plan said "3 / user / day"; the task asked for one
  story a day, so the extra calls are kept to the single regeneration the plan's own coverage
  rule needs.
- **Model: Claude Haiku only** (`CLAUDE_STORY_MODEL`, else `CLAUDE_TEXT_MODEL`, else the
  provider default `claude-haiku-5-5`; key `ANTHROPIC_API_KEY`). Gemini is not tried first:
  its free tier is down to a handful of requests a day and may use the text for training
  (plan "Gemini hakkında bir uyarı"); a request that is limited to one a day and must answer in
  under 15 s is better served by the one provider that is paid for, structured and fast. The
  call reuses `createClaudeTextProvider` (structured output, `toClaudeSchema`, JSON handling)
  with one attempt per call; the pipeline decides about the one retry.
- **Budget.** Every call goes through `recordTextSpend` (purpose `story`) on the monthly text
  budget (`SupabaseTextBudgetStore`, cap `textMonthlyCapUsd`, shared with the graded library):
  the upper bound (`reserveUsd` of the prompt and 4 096 output tokens) is reserved, the real
  cost settled; an answer that was billed but unusable is booked too; a transport failure is
  settled at 0. A month that cannot cover the bound answers **`budget_exhausted`** (new error
  code, HTTP 503) without calling the model; the app shows "Bu ayın hikâye hakkı doldu…". The
  provider's own `budget` option is not used here, so a story call is reserved once and under
  its own purpose.
- **Checks in code** (`validateStoryOutput`): clean title and paragraphs (Latin script and
  ordinary punctuation, no links or markup), 130–280 words (the prompt asks 150–250), **at
  least 5 target words really in the text** (`locateExampleTerm`, any inflection; the model's
  `used_words` is not trusted), exactly 3 questions with 2–4 distinct options and a valid
  answer index, a Turkish gloss for every used target word; glosses of other words only when
  the word occurs in the text. One more call when an answer fails; then `ai_failed`.
- Nothing about the story is stored on the server outside the user's own `user_texts` row.

### Device

- **Target words** (`domain/story.ts` `selectStoryTargets`): counted words (no affixes, no
  slot patterns, at most three words, `[a-z' -]`) whose primary recognition card is live, not
  suspended and has been answered; first the ones **due by the end of today** (most overdue
  first), then words in **Öğreniyor / Pekişiyor studied in the last 7 days** ("newly learned").
  Six are asked for (5–8 allowed; six reads more naturally than eight). Fewer than five: no
  story, and the Bugün line stays hidden.
- **Coverage**: the story is measured with the reader's knowledge model **without the target
  words** (they are the lesson, marked and glossed). Over the band's top
  (`min(band.max, 10 %)`) → one regeneration with the hardest words as `avoid`; the easier of
  the two is kept; still over → its hardest words that the model glossed are shown glossed
  before the text (`texts.story.glossed`). Plan A.6 regenerates only over the 10 % cap; using
  the user's own band keeps criterion 7 ("bilinmeyen oranı sınırı geçmez") for every choice.
- **Storage**: `saveText({kind: 'story', …, story})`. The extras (day, target words with
  note ids, glosses, questions, measured rate) live in a new optional `ReaderText.story` field,
  synced with the row: `user_texts.story jsonb` (same migration; `sync_push` fills it from the
  row's JSON). So another device reopens the same story instead of asking again. No Dexie
  bump: `texts.kind` is already indexed. Today's story = a live `story` row whose
  `story.day` is today's study day.
- **Bugün**: one line inside the "Bugünün okuması" card (`features/story/TodayStoryRow.tsx`), so
  Bugün gets no new card. States: hidden (no backend, fewer than 5 words, or the story is
  already the card's "continue" text), guest (invitation to sign in), offline, ready
  ("Hazırla"), loading, reopen today's story, used on another device (`daily_limit`), budget,
  generic failure with retry.
- **Reader** (three additive hooks, no restructuring): target words drawn in bold
  (`ReaderBody` `targets` prop), the glossed words before the text and the questions plus the
  story's words after it (`features/story/StoryParts.tsx`); the opening counts encounters with
  source `'story'` through `recordReaderEncounters(…, 'story')`, the used target notes
  included even where the reader did not recognise a form. Question answers stay on screen
  only. Nothing writes FSRS fields or `review_logs` (tested).

## Why

- A closed request is the strongest form of criterion 10: the server cannot receive a user
  text even by mistake.
- Refunds and the single regeneration keep "one story a day" honest for the user and bound
  the cost (about 0.001 US$ a story on Haiku).
- Measuring without the targets avoids regenerating every story because of the very words it
  exists to practise.

## Deferred / known limits

- The server day is UTC, the app's day is the study day (time zone and day start). In the
  hour or so where they differ a story may be refused as `daily_limit`; the app then says it
  was made elsewhere and the next day works normally.
- Clients older than this release ignore `texts.story`; one that edits a story row (reading
  progress) would push it without the extras. All clients ship together, so this is accepted.
- No server-side cache of stories (each is per user); no "another story" button.
- The 15 s goal (criterion 7) is met by design (one Haiku call of ~1 500 tokens, 12 s timeout),
  not yet measured against the live model.
