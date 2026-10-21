# 0007 — Home is a glanceable dashboard, not a single streak line

## Context

The plan puts one line on the home screen ("Seri: 12 gün · Bugün: 34 / 60 kart · En uzun: 21")
above a large "Tekrara başla" button and keeps everything else on the Stats page. Reviewing the
placeholder, Hasan found the line too plain and the lower half of the screen empty.

## Decision

Home (`src/features/home`) shows, in this priority order on phones and in two columns from
1024 px:

1. Streak: the current streak as a large serif number, with the longest streak and total active
   days as secondary figures.
2. Today: a progress ring (done / planned today), due and new counts, an estimated time left,
   the primary "Tekrara başla" button (disabled with "Bugünlük bitti" and the next due time when
   nothing is due) and the secondary "Kart ekle".
3. The last 14 days as a heat strip (the heat tokens of the Stats heatmap), today outlined.
4. A 7-day workload forecast from card due dates.
5. Learned cards and retention.
6. The five most recently added words, linking to Kartlar.

The streak and today blocks are above the fold at 360 × 780, so the start button needs no scroll.
All figures come from indexed reads and the `daily_activity` cache in one `useLiveQuery`.

## Why

The figures that motivate daily use (streak, today's progress, what's coming) are now visible at
a glance, while the design language stays calm: one accent button, hairline surfaces, no
decoration. The Stats page keeps the full 26-week heatmap and all seven metrics.
