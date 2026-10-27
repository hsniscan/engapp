# 0041 — Learning model: word stages and the ramp

**Context.** The owner had two complaints: the app counted a word as "learned" too early, and it
sent words away too early. Both came from one place. "Öğrenilen kart" counted cards (up to four
per word) in FSRS state Review. A card got there after two "İyi" ten minutes apart, so recall
from short-term memory was enough. With default weights, FSRS-6 then went 10 min → 2 d → 11 d →
46 d → 163 d. The level model's "learned" evidence (the first three answers had no "Tekrar")
had the same flaw. The spec is `ogrenme-modeli.md` (Turkish, approved by the owner) and its
English technical appendix. A simulation by the spec author (ts-fsrs 5.4.2, the app's FSRS
settings) produced every interval and stage table in it.

## Decision

1. **A ramp counter per card** (`cards.ramp_step`, "sağlam tekrar"). It counts reviews in
   Review state answered Hard, Good or Easy on another day. An early review does not count:
   under 12 h, or under half the planned interval ("Yarının kartlarını şimdi tekrar et").
   Amended by ADR 0055: an answer on a later local calendar day (day start 04:00) that is not
   before the card's due day counts even under 12 h. A
   long recalled gap proves a level by itself: 3 / 7 / 14 / 30 days → at least 1 / 2 / 3 / 4.
   Again resets the counter to 0, or to 1 when it was ≥ 3, so one slip does not undo months.
   Learning steps never move it.
2. **Stages** (`src/domain/stages.ts`, pure). Yeni = never answered. Öğreniyor = (re)learning,
   or ramp 0. Pekişiyor = ramp 1–2, or ramp ≥ 3 with stability < 14 d. Öğrenildi = ramp ≥ 3 and
   S ≥ 14 d. Kalıcı = ramp ≥ 5 and S ≥ 90 d. `cards.learned_at` is the first time a card was at
   Öğrenildi; a later lapse never clears it. A word's stage is its primary recognition card's
   stage. Its production card gives "Aktif". Cloze and picture cards never change a word's
   stage.
3. **The ramp** (`applyRating` in `src/domain/fsrs.ts`; constants in `fsrsConfig.ts`). This is
   still the only scheduling entry point, and it stays pure. FSRS computes the memory state
   exactly as before. The ramp only lowers the interval FSRS proposes:
   - leaving (re)learning: 1 day (Hard, Good) or 3 days (Easy);
   - in Review, by ramp_step 0..3: Hard 2/4/7/15, Good 3/7/14/30, Easy 7/14/30/60 days;
   - FSRS is free from ramp_step 4 on.
   Good and Easy never get less than the gap just survived (the proven-gap floor). Table caps of
   14 days and more get a deterministic downward fuzz of up to 10 % (FNV-1a of
   `${id}|${at}|${reps}`), never below the floor. Caps apply only to answers at or after
   `RAMP_EPOCH`, a code constant. The counter is tracked for every log, so stages are honest
   for old cards, and replaying old logs gives exactly the old due dates. `request_retention`
   stays 0.9.
4. **Words, not cards.** "Öğrendiğin kelime" counts live word/phrase/pattern notes (affix roots
   and contrast notes left out) whose recognition card is Öğrenildi or Kalıcı. Suspended words
   keep their stage. "Biliyorum" known terms never count; they have their own number
   (`src/domain/wordStages.ts`, `src/data/wordStages.ts`, `useWordStages`). The weekly series,
   the weekly report's `new_learned` and the "new words this month" goal date a word by its
   recognition card's `learned_at`.
5. **Level evidence.** The "learned" kind now needs the recognition card's `learned_at`, with no
   lapse (Again in Review) before it. `learnedEvidence` gets this from a replay. `easy_first` and
   `lapses` stay as they were. The vocabulary estimate's "outside the list" words count only at
   Öğrenildi or Kalıcı. The tile says "Tahmini kelime hazinen" and adds the disclaimer.
6. **Unlocking** (replaces decision 0004's trigger). Production, cloze and picture cards open
   when the word reaches Pekişiyor (`recognitionUnlocks`: Review or Relearning with
   ramp_step ≥ 1). A card with history of its own stays open, as before.
7. **Sync and storage.** `ramp_step` (smallint, not null, default 0) and `learned_at` (bigint,
   null) on `public.cards` (migration `20261028000100_learning_model.sql`). A trigger fills the
   default when an older client inserts a card without the key. A push that leaves the keys out
   keeps the stored values. Both values derive from the logs, so `replayCard` recomputes them on
   undo, sync, restore and integrity repair. That heals any value an older client left behind.
   Dexie v26 gives existing rows 0 / null. A one-off job at start-up then replays every card
   (`backfillLearningModel`, meta `learning_model_backfill_v1`). Due dates do not move. The
   one-time Bugün note is meta `stage_rule_v1_seen` (false = still to show;
   `stageRuleNoticePending` / `markStageRuleNoticeSeen`).
8. **Button labels.** `formatNextInterval(ms)` returns "10 dk", "3 sa", "yarın", "3 gün",
   "1 hafta", "13 gün", "1,5 ay", "6 ay", "1,5 yıl". Each `previewIntervals` entry gains
   `stageAfter`. The UI draws the arrow line with `stageChangeLabel(cardStage(card), stageAfter)`.
9. **The forecast** (`src/domain/forecast.ts`) walks each branch's ramp counter and applies the
   same caps. The future is always after the release, so it always applies them.

## Deviations from the spec, and why

- **Easy's proven-gap floor is the gap + 1 day**, not the gap. With the spec's floor, a review
  answered long after a low ramp step gave Good and Easy the same interval: gap ≥ the Easy cap
  raised both to floor(gap). That broke the spec's own "Hard < Good < Easy stays strict" (the
  10 000-state property test found it). The downward fuzz is also clamped at the floor, for the
  same reason.
- **Unlocking also accepts Relearning with ramp_step ≥ 1**, and keeps cards the old rule opened.
  The spec says `state === Review && ramp_step >= 1`. A lapse at Öğrenildi drops the counter to
  1 and the card into a 10-minute relearning step. Review-only would close the word's unstudied
  cards for those minutes and open them again right after. Section 6 says cards opened earlier
  stay open. So a recognition card that reached Review before `RAMP_EPOCH` and was not answered
  since still unlocks, as under decision 0004.
- **The `WordStage` API names** follow the shared redesign brief: `consolidating` and
  `mastered` (the appendix says `durable`). Relearning is not a stage of its own;
  `isRelearning(card)` gives the chip its "Yeniden öğreniyor".
  `stageProgress` returns `{step, of: 3}` for every stage, not only Pekişiyor.
- **"Bu hafta +k"** counts words whose recognition `learned_at` falls in the last 7 days.
- **The per-mode study queue** (cardTypes filter, a first-time counter per mode, burying only
  first-time production/cloze/image cards whose recognition sibling was answered today) lives in
  the study-session package (`src/domain/queue.ts`). This package does not change it.

## Why not raise the target retention instead

At 0.93 without the ramp, the simulation shows about the same load as the ramp (78 vs 78
answers/day over 60 days). But that load falls on every word forever. The ramp puts it only on a
word's first one or two months, which is where the complaint was. After 180 days the ramp gives
+8 % answers per day, recall 87.7 % → 90.3 %, and 1 545 instead of 1 322 words at Öğrenildi.

## Tests

- `src/domain/learningModel.test.ts`: every row of the spec's simulation tables (3.5) and the
  button table (5.1) with fuzz off; pre-epoch intervals unchanged; replay of pre-epoch logs
  equal to ts-fsrs without the ramp (property test); Hard < Good < Easy over 10 000 random
  states; the proven-gap floor (20 days late); a lapse at ramp ≥ 3 → 1; an early review does not
  count; proven levels; `learned_at`; the fuzz bounds; stage thresholds at every boundary;
  `formatNextInterval`.
- `src/domain/wordStages.test.ts`: the home count ignores production/cloze/picture cards,
  known terms, affix and contrast notes; suspended words count; "this week".
- `src/data/learningModel.test.ts`: unlocking at ramp ≥ 1, not at graduation; undo closes again;
  the home count end to end; the backfill fills the fields without moving due dates and runs
  once; cards the old rule opened stay open; the notice flag.
- `src/data/db.test.ts`: the Dexie v26 upgrade. `supabase/tests/database/40_learning_model.test.sql`:
  the columns, the old-client insert, keep-on-push, the checks.
- Updated: level evidence (`levelUpdate.test.ts`, `levelModel.test.ts`), the weekly series and
  report, progress and goals, the forecast (its ground truth now answers after the epoch).
