# 0031 — Pictures in the app: cache, card faces, word detail

## Context

v0.4 İP3. Every lexicon sense that can be drawn gets small flat SVG pictures (style B, owner's
choice; contract `supabase/functions/_shared/image-contract.ts`, pipeline and sanitizer in
İP2, review in İP4 / decision 0032). The app has to show them next to the meaning, offline,
without slowing the review session, and let the user steer what they see. Constraints:

- Offline-first: a picture seen once must show in airplane mode.
- Never inline SVG markup in the DOM; every picture passes the allowlist sanitizer on the
  client too, then `svgForTheme` (light → dark palette), then an `<img>` with a `data:` URL.
- 1,000-card session opens < 1 s, card switch < 100 ms, with pictures.
- The user's own choices are per account and never copied to another account (decision 0009).
- No shared-table writes from the client; the shared table is written by the pipeline only.

## Decision

1. **Cache table `images` (Dexie v21).** Read-only copies of `public.lexicon_images` rows
   (`id, sense_id` (lexicon sense), `variant, svg, alt_tr, status, created_at`) plus
   `fetched_at`. Indexes `id, sense_id, fetched_at`. Not synced, not in backups, kept when
   switching or copying accounts (it is shared content, like `lexicon_cache`). Only
   `approved` rows and `review` rows reach the client (RLS on the server returns review rows
   of senses in the reader's own cards); a review row is shown with a small "Yeni" badge
   ("Yeni görsel, henüz gözden geçirilmedi").
2. **Fetch.** `features/images/fetcher.ts` lists the manifest (`id, sense_id, variant,
   status, created_at`, no SVG) for the lexicon senses of the user's live senses in chunks
   of 80 ids, diffs it with the cache (`domain/images.ts` `diffManifest`: download new,
   update status, drop rows the server no longer returns), and downloads full rows in chunks
   of 40. It runs after every successful sync, a few seconds after the number of senses
   changes (cards added), when the browser comes back online and every 30 minutes; a fetch
   with the same sense set is skipped for 6 hours. One tab runs it at a time (tab runner).
   Offline or signed out it does nothing and keeps the cache. The cache is capped at ~20 MB
   (`IMAGE_CACHE_CAP_BYTES`); the oldest pictures that are not the one shown for a sense go
   first.
3. **Rendering.** `features/images/picture.ts` `pictureSrc(image, theme)`: `sanitizeSvg`
   (from `_shared/svg-sanitize.ts`, the same code the pipeline runs) → `svgForTheme` →
   `data:image/svg+xml,…`, memoized per (id, theme). A picture the sanitizer refuses (or a
   sanitizer that throws) is simply not shown. `CardPicture` renders `<img alt={alt_tr}
   width=256 height=256 draggable=false>`; the theme switch re-renders with the dark palette.
   The review session decodes the next card's picture while the current card is read
   (`preloadPicture`, alongside the existing view prefetch).
4. **Card faces.** On the back of recognition, production and cloze cards the picture sits
   beside the meaning (5.5 rem on phones, 7 rem from `sm`), the meaning left-aligned next to
   it; without a picture the layout is unchanged. Setting "Görseli ön yüzde de göster"
   (`settings.show_image_front`, default off because it can give the meaning away) adds it
   to the front as well. Which picture: the user's chosen variant, else the first approved,
   else the first review row; never a hidden or rejected one (`pickImage`).
5. **The user's rows (no new synced table).**
   - Choice / hide: `user_content` kind `image_choice`, one row per sense of the user (id =
     UUID v8 over ("user_content", "image_choice", sense id)), `lexicon_sense_id`,
     `replaces_id` = the chosen image id or null, `context` `chosen` | `hidden`,
     `selected` = not hidden, `text` = the context.
   - "Bu görsel anlamı anlatıyor mu? Evet / Hayır": `content_feedback` with
     `target_kind 'image'`, `target_id` = image id, `verdict` `like` | `reject` (id from
     `feedbackRowId`). `content_feedback` has no reason column, so the reason of a "Hayır"
     (`IMAGE_REJECT_REASONS`: `wrong_meaning`, `unclear`, `ugly`, `other`) is a
     `user_content` row of kind `image_feedback` (id over ("user_content", "image_feedback",
     image id), `replaces_id` = image id, `context` = `text` = the reason). A rejected
     picture is not shown on that user's cards; if it was the chosen one the choice is
     cleared. Undo takes the rows back (tombstones). Both kinds and the target kind pass the
     existing loose CHECKs of `user_content` / `content_feedback`, so the server needs no
     change for them. The account-copy rule keeps them out of another account (test in
     `features/auth/link.test.ts`).
6. **Word detail "Görsel" section** (`ImageSection`, before the mnemonic section, for senses
   in the shared lexicon): the shown picture (large), the Evet / Hayır question with the
   reasons, the other variants as buttons ("N. görsel: …. Bunu kullan"), "Yeniden üret"
   (`ai-image`, signed-in only) and "Görseli gizle / göster", each with an undo toast. A
   sense without a picture offers "Görsel üret" (needs sign-in; explains why when signed out,
   offline, or outside the shared lexicon). The four refusals of `ai-image` read as plain
   Turkish (`daily_limit` names the limit of 10, `budget`, `not_visual`, `failed`). A new
   picture is stored in the cache at once and becomes the chosen one. For an admin, an
   answer about a picture still in review is also sent as the review decision (decision 0032).
7. **Leech sheet** gets a "Görselle çalış" path that opens the same section for the card's
   sense.
8. **Server change.** Only `settings.show_image_front boolean` (migration
   `20261025000300_image_settings.sql`), a nullable late column (`LATE_COLUMNS`, absent =
   off); Dexie v21 re-pulls settings once (`pull_backfill`). Deviation from "client only":
   the setting syncs like every other setting, which needs the column.

## Consequences

- Pictures cost nothing at review time: the view query reads one indexed row per card and
  the data URL is memoized; measured with 1,000 cards, each with a picture
  (`tests/e2e/images-perf.spec.ts`): warm open 193 ms, cold 610 ms, switch median 13 ms,
  p95 16 ms (same machine, plain `perf.spec.ts`: 152 ms, 506 ms, 12 / 18 ms).
- The client depends on İP2's `sanitizeSvg`; on a build where it is still the stub that
  throws, no picture shows (nothing breaks). Unit tests mock it.
- Choosing, hiding and verdicts follow the user to other devices through sync; the shared
  table never sees them. Aggregating "Hayır" answers for the review queue is the server's
  job (not part of this package).
