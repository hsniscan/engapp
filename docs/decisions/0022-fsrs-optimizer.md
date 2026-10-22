# 0022 — Personal FSRS parameters: own TypeScript optimizer in a worker

## Context

v0.3 İP4 (plan "İP4 — Kişisel FSRS ayarı", Annex A.5, acceptance criterion 6): from 1 000
non-undone review logs (Anki imports included), Settings → Çalışma → "Algoritmayı hafızama göre
ayarla" fits FSRS parameters to the user's own history, on the device, in under 30 s on a phone;
it must never adopt worse parameters and must be reversible in one tap. The plan named
`fsrs-browser` (the WASM build of fsrs-rs, BSD-3-Clause) in a Web Worker, lazily loaded and
runtime-cached like the pdf.js worker (0008).

## Decision

1. **No fsrs-browser; a small optimizer in TypeScript** (`src/domain/fsrsOptimizer.ts`, pure).
   fsrs-browser 6.6.0 (fsrs-rs 6, 21 parameters, BSD-3 — licence and parameter count would be
   fine) is built with wasm-bindgen-rayon: it instantiates _shared_ WebAssembly memory and
   trains on a thread pool. That requires a cross-origin-isolated page (COOP + COEP on the whole
   site), which Firefox and Safari enforce, and COEP would also constrain every cross-origin
   load of the app (Supabase auth redirects, fonts, future embeds). A site-wide header change for
   one settings button is out of proportion, so the package is not used.
   Our optimizer re-implements the ts-fsrs FSRS-6 memory model (same formulas and bounds,
   elapsed days = difference of UTC dates as ts-fsrs counts them; a property test replays random
   histories through ts-fsrs and agrees to 1e-6) and follows the fsrs-rs recipe: binary
   log-loss of the predicted recall on every answer that comes on a later day than the previous
   one (same-day answers only update the state through the short-term formula), Adam
   (lr 0.04, batches of ~512 reviews made of whole cards, cosine decay, ~150 steps, at least one
   pass), parameters clipped to ts-fsrs' bounds after each step, a pretrain of the four initial
   stabilities from each card's second answer, and an L2 pull towards the starting parameters.
   Gradients are central finite differences (42 cheap folds per step), which keeps the code
   small and obviously correct; 20 000 reviews train in ~1.5 s in Node, 250 000 in ~3 s.
2. **Adoption rule.** Time-series split: the oldest 80 % of the evaluable answers train, the
   newest 20 % are held out (at least 100 each, otherwise "too few", nothing changes). The
   candidate is adopted only if it beats the current parameters on **both** held-out log-loss and
   RMSE (bins) (bins: elapsed days × earlier answers × earlier lapses, log-spaced, as in the FSRS
   benchmark). Otherwise the current parameters stay and the screen says so. The adopted set is
   the one that was validated (not re-trained on all data), so "never worse on held-out data"
   holds for what is stored. Deterministic (seeded shuffles): same history, same result.
3. **Worker, precached, not runtime-cached.** The worker (`src/features/fsrs/optimizer.worker.ts`)
   is created only when the user taps "Ayarla", but its file is 10.8 kB (no zod, no WASM), so it
   stays in the normal precache: it works offline from the first visit, which a CacheFirst rule
   (0008) would not give. The 0008 reasoning (avoid downloading 1.26 MB nobody uses) does not
   apply at this size. Without Worker support the same code runs inline.
4. **Storage and sync.** `settings.fsrs_params` (existing) holds the adopted weights;
   `fsrs_params_prev` (for "Eski ayara dön") and `fsrs_opt_at` (last run, adopted or not) are new
   optional synced settings (migration `20261023000400_fsrs_params.sql`, Dexie v15 re-pulls
   settings once, backup carries them; older backups without them still parse, so the backup
   `schema_version` is unchanged). Adopt and revert write the settings and replay every card
   from its logs in one transaction (`src/data/fsrsOpt.ts`); a device that pulls settings with
   different `fsrs_params` replays every card as well. Review logs are only read. The history
   never leaves the device; only the resulting settings row syncs. Revert goes to
   `fsrs_params_prev` (the defaults when it is null) and clears it.
5. **When it is offered.** The row is always in Settings; below 1 000 reviews it shows how many
   are missing. At 1 000 reviews, and then when `fsrs_opt_at` is 30 days old and there are new
   reviews since, the row highlights the suggestion and the home screen shows a dismissible
   note ("Sonra" hides it for 30 days on this device). The monthly re-run is suggested, not run
   silently: the plan's "ayda bir günceller" is met by the monthly offer, and a change to card
   timing always follows a tap.
6. **Plain-language result.** "Tahmin isabeti %X iyileşti" uses the relative drop of held-out
   RMSE (bins); "günlük tekrarın ~%Y azalacak/artacak" compares `domain/workload.ts` estimates
   (each card's current stability → interval at the target retention, plus one relearning step
   for forgotten reviews and the learning steps of new cards) under the old and the new
   parameters. The same estimate drives the retention helper (expected reviews per day at
   85 / 90 / 95 %). It is a steady-state snapshot, deliberately small; İP3's forecast replaces
   it where a day-by-day forecast is needed.

## Consequences

- No new dependency and no site-wide header change.
- Finite differences cost ~40× a forward pass; fine at these sizes, and the step count is
  capped, so very large Anki histories stay well under the 30 s budget.
- The optimizer has no outlier filter and no "recency weighting" (fsrs-rs has both); the
  adoption rule guards against the cases where that would matter.
- If ts-fsrs changes its model (FSRS-7), the property test against ts-fsrs replay fails first.
