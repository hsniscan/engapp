# 0044 — Article and subtitle import, and the Claude fallback of the text AI tasks

**Context.** v0.5 İP2 (plan `v0.5-plan.md`, appendix A.4 and A.8, acceptance criteria 3 and
10). Until now a shared link gave only the page title (decision 0034). The reader (İP1, decision 0043) opens any `ReaderText`; this package fills it from a web article or a subtitle file.
Separately, Gemini's free tier was cut hard in 2026, so the text AI tasks need a second
provider when Gemini is out of quota.

## Decision

### fetch-article (edge function)

- `POST /functions/v1/fetch-article {url}` → `{url, title, byline, site, lang, paragraphs[],
truncated, usage}` (`_shared/article-contract.ts`). **Plain text only**: Readability's article
  element is walked by our own `blockTexts` (paragraphs, headings, list items, quotes); no HTML,
  attribute or link ever leaves the function.
- **Auth** as every function (`createAuthenticator`: a signed-in, non-anonymous JWT; `user_id`
  never from the client). **30 per user and UTC day** (`ARTICLE_DAILY_LIMIT`) in a new counter
  `article_usage` + `article_consume()` (migration `20261101000200_article_usage.sql`), the
  `tts_usage` pattern: service role only, RLS on with no policy, purged after 90 days by its own
  cron entry (`purge_article_usage`, so `purge_usage_counters()` keeps its shape). A malformed
  or blocked address is refused **before** it costs a fetch.
- **SSRF guard** (`_shared/net-guard.ts`), applied to **every hop**:
  - `http:` / `https:` only, **default ports only** (a non-default port is how internal admin
    panels are reached), no `user:pass@`, no single-label, `localhost`, `.local`, `.internal`,
    `.lan`, `.home.arpa` hosts;
  - the host is resolved (A + AAAA) and refused if **any** answer is non-public: 0/8, 10/8,
    100.64/10 (CGNAT), 127/8, 169.254/16 (incl. cloud metadata), 172.16/12, 192.0.0/24,
    192.0.2/24, 192.168/16, 198.18/15, documentation ranges, 224/4 multicast, 240/4; `::`,
    `::1`, IPv4-mapped/-compatible/-translated (`::ffff:…`), NAT64 of a private IPv4, 6to4,
    Teredo, ULA `fc00::/7`, link-local `fe80::/10`, site-local, multicast `ff00::/8`, anything
    outside `2000::/3`. Numeric host forms (`2130706433`, `0x7f.1`, `0177.0.0.1`) are
    normalised by the URL parser first and caught the same way;
  - redirects are followed by hand (`redirect: 'manual'`), **at most 3**, each target checked
    again (shape, DNS, robots.txt) before it is fetched;
  - **one 10 s deadline** for the whole request (robots.txt included), **2 MB** cap (by
    `Content-Length` and while streaming), **`text/html` only** (after the redirects; 401/402
    → `paywalled`, other non-2xx → `fetch_failed`).
- DNS: `Deno.resolveDns` where the runtime has it, else DNS-over-HTTPS (Cloudflare 1.1.1.1,
  JSON API). **Residual risk:** `fetch` resolves the name again, so a DNS-rebinding attacker
  with a TTL of 0 could still race the check. Accepted for now: the function runs on Supabase's
  edge network, not inside a private network, has no credentials to steal on the request, and
  returns text only. Pinning the checked IP needs a custom HTTP client (deferred).
- **robots.txt** for the product token `EngappReader` (User-Agent
  `EngappReader/1.0 (+https://engapp-65y.pages.dev/gizlilik)`), own RFC 9309 parser
  (`_shared/robots.ts`: our group over `*`, longest match, Allow wins ties, `*` and `$`). Fetched
  through the same guard, cached per origin within the request. 4xx = allow all; 5xx, network
  error, timeout or a blocked redirect = disallow (RFC 9309 "unreachable").
- **Parsing**: `linkedom` (ISC; deps htmlparser2, css-select and friends: MIT / BSD-2 / ISC) +
  `@mozilla/readability` (Apache-2.0), npm specifiers in the function's import map, pinned
  (`linkedom@0.18.13`, deliberately not the five-day-old 0.18.14; `readability@0.6.0`). Also dev
  dependencies of the app so the same code is tested under vitest. Charset from the header or
  `<meta charset>`; windows-1252 decoded by our own table (runtimes without full ICU decode it as
  Latin-1). Page furniture Readability keeps (wiki `[edit]` links, footnote marks, captions,
  tables, code, share bars) is dropped; a leading "By Ana Lima" becomes the byline.
- **Paywalls are never worked around.** schema.org `isAccessibleForFree: false` with fewer
  than 250 words → `paywalled`; a long text on a page with that markup was served to everyone
  (metered/free article) and is kept. Fewer than 60 words → `extract_failed` (JS shells, cookie
  walls, teasers). The client then shows "Bu sayfa alınamadı" and the copy-paste way.
- **Nothing is stored server-side**: no table holds the address or the text; logs carry only
  sizes, timing and the failure reason (not the URL). The text is saved on the device with
  `saveText({kind: 'article', source_url, title, body})` (criterion 10).
- New error codes (shared `ERROR_CODES`): `blocked_url` 400, `robots_disallowed` 422,
  `not_html` 422, `too_large` 422, `fetch_failed` 502, `paywalled` 422, `extract_failed` 422.

### Client

- Add sheet: **"Bağlantıdan makale"** → `/makale` (address field, `?url=` starts at once) and
  **"Altyazı dosyası (.srt / .vtt)"** → `/altyazi`.
- Share route (`kind: 'link'`): signed in, the article is fetched at once; offline, signed out
  or on any failure, a clear Turkish message, the **"Metni kopyala-yapıştır"** way and the old
  title-only actions remain (the title-only path is the fallback, not removed).
- Result → **"Okuyucuda aç"** (`saveText` → `readerPath(id)`) or **"Kelimeleri çıkar"** (the
  existing import job, same as a pasted text).
- Subtitles are parsed **on the device** (`src/domain/subtitles.ts`, pure): indices, timings,
  cue settings, `<i>`/`<font>`/`<c>`/`<v>` tags, karaoke timestamps, `{\an8}`, upper-case speaker
  labels, `>>`, dialogue dashes, `[MUSIC]`/`(LAUGHS)` and `♪` go; rolling auto-captions (each
  line shown twice, lines growing word by word) are de-duplicated; cues are merged into
  sentences and paragraphs break at a ≥ 2.5 s pause after a sentence end (or ~700 characters).
  UTF-8, else windows-1252. 5 MB cap. Stored as `kind: 'subtitle'`, `source_url` = file name.

### Claude fallback of the text AI tasks (A.8)

- `_shared/ai.ts` `createTextAiProvider(env)`: Gemini (model, then `GEMINI_FALLBACK_MODEL`, as
  before) and, when that ends in `quota_exceeded` (429 / `RESOURCE_EXHAUSTED`, and 503
  `UNAVAILABLE`, which the Gemini adapter already classes as quota), the **same request** on
  Claude (`_shared/ai-claude-text.ts`, official SDK, `CLAUDE_TEXT_MODEL`, default
  `claude-haiku-5-5`, key `ANTHROPIC_API_KEY`). Other failures are not retried on Claude.
  `AI_CLAUDE_FALLBACK=off` disables it; with no Gemini key, Claude alone.
- Structured output with each task's **existing JSON schema** (`output_config.format`),
  converted by `toClaudeSchema` (objects closed with `additionalProperties: false`, numeric /
  length / item-count keywords dropped, `type: [X, "null"]` → `anyOf`); each task's own
  `validate` still runs, with one retry on a mismatch; a `max_tokens` cut keeps the complete
  items like the Gemini path. Effort `low`, no sampling parameters.
- Wired once in `setup.ts` (`createAiFunction`), so ai-extract, ai-enrich, ai-examples,
  ai-themes, ai-mnemonic, ai-report and ai-contrast all get it with no change to their code;
  each of their import maps gains `@anthropic-ai/sdk@0.132.1` (already used by ai-image).
  `log()` moved to `_shared/log.ts` so tts, push-send, account-delete and fetch-article do not
  pull the SDK in.
- **Budget seam:** every answered Claude call reports `{model, usd, tokens}` to
  `recordTextSpend` (priced with `callCostUsd` from `image-models.ts`). There is no text budget
  table on this branch, so the default only logs. **TODO at merge:** connect it to İP5's text
  budget (`CLAUDE_TEXT_MONTHLY_USD=10`, decision 0047), and check that budget before the call.

## Why

- Readability is the extractor browsers use for reader mode; with our own text walk the output
  is plain text by construction. A server fetch is needed because most sites block cross-origin
  requests from the app.
- Default ports + every-hop DNS checks close the usual SSRF routes (metadata, localhost,
  internal hosts, redirect tricks); refusing on any private answer defeats mixed DNS answers.
- One wiring point keeps the fallback out of the task code and makes it testable with a mocked
  `fetch` for both APIs.

## Deviations from the plan

- A.4 says "honour robots.txt"; we also treat an unreachable robots.txt as disallow (RFC 9309).
- The SSRF list is wider than "private, loopback, link-local" (CGNAT, multicast, ULA, mapped,
  NAT64, 6to4, Teredo, documentation) and non-default ports are refused.
- 503 overload also triggers the Claude fallback (Gemini already treats it as quota).
- Server tests run under vitest like every `_shared` test (CI runs them); a small Deno test
  (`fetch-article/extract_test.ts`) checks linkedom + Readability through the Deno import map.
- The privacy policy now also names Anthropic Claude as the AI backup for text (the old text
  said Claude only sees dictionary words for pictures; that would no longer be true).

## Deferred

- Pinning the checked IP against DNS rebinding (custom HTTP client).
- The 20-site live check of criterion 3 (needs the deployed function; tests use saved
  fixtures only, no live web).
- Text budget enforcement for the Claude fallback (İP5 seam above); `scripts/system-jobs.ts`
  still uses Gemini alone.
- Server-side sync of `texts` (İP1 owns it; `user_texts` must stay out of shared tables).
