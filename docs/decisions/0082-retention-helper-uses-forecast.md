# 0082 — The retention helper runs İlerleme's forecast and adds the long-run change

## Context

Review 2026-11-26 (#9): Ayarlar › Çalışma › "Hedef orana göre günlük tekrar" showed ~122 / 124 /
129 a day for 85 / 90 / 95 %, while İlerleme said "günde ortalama 18 tekrar" on the same data.
`domain/workload.ts` added a fixed `daily_new_limit × 3` (first sight plus two learning steps) to
a steady-state review figure: at 40 new a day that is 120 at every target, whether or not any new
words are waiting, and it hid the real difference between the targets.

Running İlerleme's own 30-day forecast (`domain/forecast.ts`) at each target fixes the agreement,
but its three figures stay close for a young collection: the learning ramp (ADR 0041) caps most
intervals in the first weeks whatever the target retention is. The target matters once cards are
past the ramp.

## Decision

- Each option's main number is the 30-day forecast's daily average at that target
  (`computeRetentionWorkloads` in `data/load.ts`, `averagePerDay` in `domain/forecast.ts`): the
  same cards, the same new-card budget and the same averaging as İlerleme, so the current target
  shows exactly İlerleme's "günde ortalama". It is labelled "~N kart/gün".
- The new-card budget is the real one: `daily_new_limit` over the waiting Kelime çalışma
  (recognition) cards only (ADR 0079); extra-mode first-time cards are not waiting for it. This
  input is shared with İlerleme's forecast, which therefore no longer counts those cards either.
- The other two options add one line, "Uzun vadede %X daha az / daha çok tekrar": the steady-state
  review-only change against the current target (`longRunReviewChangePct`, no new-card term).
- The hint says what the number contains (30-day average, N new words a day or reviews only, same
  as İlerleme) and why the numbers can be close.

## Why

One number that disagrees with İlerleme confuses; one that agrees but barely moves cannot help
choose a target. The pair is honest about both horizons. The optimizer's workload comparison
(`fsrsOptimizer.workloadFor`) still uses `expectedDailyReviews` with the new-card term; it compares
two parameter sets at the same target and was left as it is.
