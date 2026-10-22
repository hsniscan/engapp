# 0030 — Picture pipeline: sanitizer, checks, budget, batch and instant paths

**Context.** v0.4 İP2 (plan Annex A.2–A.4, A.8): pictures for lexicon senses, drawn by Claude
(`image-v1`, decision 0029), must be safe to show in the app, readable in both themes, checked
before anyone sees them, and must never cost more than the monthly Claude credit allows. The
nightly batch is the main path (half price); a user can also ask for one picture now
(`ai-image`). The owner approves every picture in the review screen (İP4). Details and prompts:
`docs/ai-image.md`.

**Decision.**

- **Sanitizer** (`_shared/svg-sanitize.ts`, re-exported as `src/domain/svgSanitize.ts`): a small
  XML-subset tokenizer with an allowlist; no DOM, so the same code runs in Deno, Node and the
  browser. It rebuilds the SVG from what it accepted (normalised numbers, lowercase palette
  colours, fixed attribute order), so a sanitised picture is byte-stable and idempotent.
  Additions to the plan's attribute list: `fill-rule` and `stroke-opacity` (needed by the
  approved references, harmless); `title`/`desc` are dropped with their text; `id`, `role`,
  `aria-*`, `version` are dropped; a root without `fill` gets `fill="#2b2824"` (SVG's default
  black is not a palette colour and would vanish on the dark theme). Root `width`/`height` are
  dropped (the client sizes the picture).
- **Checks** in order: sanitizer → token contrast (backdrop present; a subject colour ≥ 2:1 on
  the backdrop in both themes; colours < 1.4:1 only on top of another shape) → PNG render of
  both themes with `@resvg/resvg-wasm` → visible coverage ≥ 4 % of the backdrop → Haiku vision
  (`imagecheck-v1`). The first failure picks one of eight fixed redraw sentences; a failed
  picture is drawn once more, a second failure stays `rejected` (never shown). Every attempt is
  stored with its checks and cost, rejected ones included, for the owner and for cost reports.
- **The edge function cannot render.** resvg-wasm is too heavy for the edge function's cold
  start and memory, and there is no rasteriser in the runtime. `ai-image` therefore runs the
  sanitizer and the contrast check, stores the picture as `review` with
  `checks.vision = "pending"`, and the nightly `collect` runs the coverage and vision checks on
  it (a failure there rejects it and queues the one redraw). A `review` picture is shown only to
  users who have the sense in their cards — the requester sees the picture at once — and to the
  review screen; nobody else sees it before the owner approves it.
- **Budget.** One table `image_budget` per calendar month (UTC) and one row per in-flight call in
  `image_budget_holds`. Every call reserves an upper bound first (`image_budget_reserve`, one
  `INSERT … ON CONFLICT DO UPDATE … WHERE spent + reserved + amount <= cap` statement, so
  concurrent callers serialise on the row and can never pass the cap together) and settles the
  real cost from `usage` (`image_budget_settle`). The bound counts input at the 1-hour
  cache-write price, all of `max_tokens` as output, and with the server-side fallback one more
  attempt at the highest listed price; a property test checks bound ≥ real cost for any usage.
  Cap = 0.8 × `CLAUDE_MONTHLY_CREDIT_USD` (default 100). Prices live in one map
  (`MODEL_PRICES`); unknown models are priced at the maximum. Stale holds (crashed runs) count as
  spent after an hour; batch holds are settled by `collect`.
- **Batch path.** `submit` sends one Message Batch per night (custom id = sense id), reserving
  each request at batch price, and stops at the cap. `collect` settles each result, runs the
  checks and stores; errored, expired and missing requests are released at 0 and queued again.
  Batches cannot use `fallbacks`, so a refusal there simply marks the sense `skipped`.
- **Instant path.** `ai-image` with `fallbacks: "default"` (beta
  `server-side-fallback-2026-07-01`); a refusal after the fallback or `drawable: false` →
  `not_visual`. The budget is probed before the daily limit is counted, so a spent month does
  not use up one of the user's ten daily pictures.
- **Queue.** `image_requests` (one row per sense) with `image_request(p_sense_id)` for signed-in
  users (only senses in their own cards; each distinct user raises the priority) and
  `image_queue_auto` for senses with `visualizability >= 2`. Priorities: owner redraw 4000, user
  requests 3000 + 100 per user, then the owner's cards, anyone's cards, word frequency.
- **Admins.** `app_admins` is never seeded with ids. The deploy workflow adds the user in the
  repository variable `APP_ADMIN_USER_ID` (or the owner runs one SQL line); `is_app_admin()` is
  the only check the review functions use.
- **Visual scores on the lexicon.** `visualizability`, `visual_hint` and `visual_scored_at` live
  on `lexicon_senses`. The lexicon's change stamp (`server_seq`) is not bumped when only these
  columns change, so scoring thousands of senses does not make every device re-download them.

**Deviations from the plan / contract notes.**

- The plan's column `check` is named `checks` (`check` is a reserved word in SQL).
- `parseImageResponse` returns a union (`image` / `declined` / `refused` / `invalid`), see
  decision 0029.
- The CEFR-proximity ordering of the plan (A.3, last bullet) is left to İP9; the queue uses card
  membership and word frequency until then.
- The edge path defers the vision check to the night (above) instead of checking before
  answering.

**Why.** The allowlist sanitizer is the security boundary: the SVG is shown through
`<img src="data:…">` and the client sanitizes again, but nothing unexpected is ever stored.
Reserve-then-settle with a single-statement guard is the simplest scheme that is safe under
concurrency without a separate lock service. Deferring the vision check keeps the instant path
fast and inside the edge limits while still ensuring that only the requester sees an unchecked
picture.

**Consequences.** The owner sets `ANTHROPIC_API_KEY` (secret) and optionally
`CLAUDE_MONTHLY_CREDIT_USD`, `CLAUDE_IMAGE_MODEL`, `CLAUDE_CHECK_MODEL`, `IMAGE_DAILY_LIMIT` and
`APP_ADMIN_USER_ID` (variables); `docs/setup-backend.md` §12. Without the key every picture job
skips with a notice and `ai-image` answers `ai_failed`. A spending limit on the Anthropic Console
is still recommended as a second guard.
