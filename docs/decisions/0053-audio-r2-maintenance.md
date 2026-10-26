# 0053 — Pronunciation audio on Cloudflare R2; v0.5 maintenance

## Context

v0.5 İP11 (plan appendix A.8, acceptance criterion 12). The pronunciation and graded-library
audio (decisions on TTS pre-generation, setup step 15) sits in a public Supabase Storage bucket
and already uses about a third of the free 1 GB, growing with every library text and new word.
Cloudflare R2 offers 10 GB free with no charge for downloads. The move must be reversible, must
not break offline playback, and the app must keep working unchanged until the owner switches.

The same package carries the release maintenance: start-up bundle size, a licence check of
every dependency, stale tests, test-run stability, and (added during the package) the home
screen on a 10,000-card profile, which did not open within 10 s.

## Decision

### Audio on R2

1. **Same object keys, another origin.** An object's key in R2 is its path in the Supabase
   bucket, so one path gives two URLs (`ttsAudioUrls` in `_shared/tts-contract.ts`): the R2 public
   URL (`<AUDIO_BASE_URL>/<path>`, https only, `parseAudioBaseUrl`) first, Supabase second.
2. **The switch is the public base URL.** The client reads `VITE_AUDIO_BASE_URL` at build time;
   unset, it behaves exactly as before (Supabase only). The jobs and the `tts` function use R2
   only when the four `R2_*` secrets **and** `AUDIO_BASE_URL` are set; credentials alone only
   allow the copy workflow to run. Going back is unsetting the variables.
3. **Client fallback.** `fetchPregenerated` tries every source in order and every text candidate
   within a source; a 404 moves to the next candidate, a network/CORS error skips the source.
   Played audio is still stored in the app's own `engapp-tts` Cache Storage, so offline playback
   does not depend on the origin. The R2 host matches no Workbox route (no service-worker
   interception), and the Supabase rule stays NetworkOnly.
4. **Writers.** `tts-pregen` and the `tts` function's cache-on-miss upload to R2 when it is on
   (`withR2Audio`: find = R2 HEAD then Supabase; save = R2, Supabase if R2 fails), with
   `Cache-Control: public, max-age=31536000, immutable`. "Already present" for pre-generation is
   the union of both listings, so nothing is generated twice during the move.
5. **Thin SigV4, no SDK** (`_shared/r2.ts`): Web Crypto HMAC, path-style
   `https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`, region `auto`; HEAD, PUT, DELETE,
   ListObjectsV2 with continuation. Checked against AWS's published SigV4 examples, under Vitest
   and Deno. Runs unchanged in Node (scripts) and Deno (functions).
6. **One-time copy** `.github/workflows/audio-migrate.yml` (`scripts/audio-migrate.ts`): manual
   dispatch, dry run by default; lists both buckets, copies what is missing or differs in size
   (so a rerun continues where the last stopped), stops on a deadline or after 20 failures in a
   row, then checks a sample of public URLs including the CORS answer for the app's origin; the
   counts go to the job summary. It never deletes from Supabase; freeing that space is a manual,
   later step (setup step 19.9).
7. **CSP.** The app ships no Content-Security-Policy today (no `_headers`, no meta tag), so there
   is nothing to update. If one is added, the audio origin belongs in `connect-src` and
   `media-src`.

### Maintenance

8. **Start-up bundle** (entry + modulepreloads, gzip): 503.6 KB before v0.5, 516.2 KB after wave 1,
   **474.9 KB** now. English strings load on demand (`loadLanguage`, i18next
   `partialBundledLanguages`; `/privacy` awaits them), the library catalogue is a dynamic import.
   `scripts/check-bundle.ts` runs in CI after the build: budget 525 KB gzip, and it fails if an
   OCR/tesseract or reader chunk, or tesseract code, is in the start-up set.
9. **Licences.** `scripts/check-licenses.ts` runs in CI on `pnpm licenses list --json` with the
   allowlist MIT, Apache-2.0, BSD-2/3-Clause, ISC, 0BSD, CC0-1.0, Unlicense, Python-2.0,
   BlueOak-1.0.0 (SPDX `OR` needs one allowed side, `AND` all). Reviewed exceptions, all free for
   commercial use: the Source Serif 4 font (OFL-1.1, shipped as a font file); `pako`
   (MIT AND Zlib); build and test tools that never ship: `axe-core`, `@axe-core/playwright`,
   `@resvg/resvg-wasm`, `lightningcss` and its binaries (MPL-2.0, unmodified), `caniuse-lite`
   (CC-BY-4.0, data), `@csstools/*` (MIT-0). 627 packages, none failing.
10. **Tests.** No skipped test is obsolete: what remains are conditional `skipIf`s (the local
    Supabase stack) and the 10k restore timing that is skipped on CI by design. The Vitest pool
    and environment stay as they are; see "Not done".
11. **10,000-card home.** The home screen was bound by IndexedDB round trips, not by JavaScript:
    Dexie's `.filter()` and `anyOf` walk a cursor, one round trip per row, and several widgets read
    the whole history while the hero was loading. Now: `scanWhere`/`scanCount` (`data/scan.ts`)
    read with one `getAll` and filter in memory; `logsByCard` reads per card through the
    `card_id` index (whole table above 3,000 cards); `[state+due]` ranges are read, then filtered;
    the goals, "more", report shortcut and notes wait until the hero's counts are in. Locally
    (4 CPUs under load) both perf cases pass: 1k session open 192 ms, 10k 1.4 s warm (bound scaled
    by load), card switch p95 under 20 ms.
    Helpers that run inside a transaction chain on Dexie's promise instead of `async`/`await`:
    an `async` helper that awaited inside the home screen's concurrent queue transactions lost
    Dexie's zone and the transaction committed early (PrematureCommitError).

## Why

- Same keys keep the move a pure copy: no database rows change, no client migration, and either
  origin can serve any file. The fallback makes a half-done copy or a wrong CORS rule invisible
  to the user (only slower).
- A 300-line signer instead of the AWS SDK: no new dependency in the functions or the app, and
  the same code in Deno and Node.
- Reading whole tables is cheaper than cursors at this scale (tens of thousands of small rows);
  memory stays in the low megabytes.

## Not done (follow-ups)

- Home on 10k still reads the full review history twice after the hero (`countOptimizerReviews`
  in the FSRS optimiser offer, `loadRetentionInput` for goals) and computes the day facts in
  several concurrent transactions; `levelModel` and the maintenance jobs still use `anyOf`.
- Vitest: 198 of 246 files use jsdom and its setup is most of the run time. A trial with
  `pool: 'vmThreads'` failed tests (objects from another VM realm, e.g. in `link.test.ts` and
  `confusables.test.ts`), so the pool stays `forks`; the supabase and scripts tests already run
  in the node environment (the two new R2 test files now declare it too). The two timing-sensitive tests (`perf.test.tsx`, the home screen)
  pass alone and only flake on a loaded machine.
- Deleting the audio from Supabase after a few weeks on R2 (manual, setup step 19.9).
