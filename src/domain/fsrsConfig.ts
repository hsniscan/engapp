// Scheduler constants, in a module of their own so the optimizer worker can use them without
// pulling in zod (domain/fsrs.ts validates settings with it).
export const FSRS_CONFIG = {
  maximum_interval: 36500,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ['1m', '10m'] as const,
  relearning_steps: ['10m'] as const,
} as const;

// ------------------------------------------------------------------ learning model (ADR 0041)
// The ramp: upper bounds on the first intervals so a word is not sent away before it has
// been recalled on three separate days. FSRS still computes memory (stability, difficulty);
// the ramp only shortens the interval it proposes. See docs/decisions/0041-learning-model.md.

/**
 * Release instant of the learning model. A code constant, the same on every device: caps apply
 * only to answers at or after it, so replaying older logs reproduces their due dates exactly.
 * The ramp counter (ramp_step) is tracked for every log, before and after, so stages are honest.
 */
export const RAMP_EPOCH = Date.UTC(2026, 9, 26, 6, 0, 0); // 2026-10-26T06:00:00Z, the release

/** Cap (days) when a card leaves (re)learning for Review, per rating. Again never graduates. */
export const GRAD_CAP = { Hard: 1, Good: 1, Easy: 3 } as const;

/** Cap (days) in Review per rating, indexed by ramp_step (0..3). ramp_step ≥ 4: FSRS is free. */
export const RAMP_CAPS = {
  Hard: [2, 4, 7, 15],
  Good: [3, 7, 14, 30],
  Easy: [7, 14, 30, 60],
} as const;

/** Number of ramp rows; at ramp_step ≥ RAMP_LEN the scheduler is no longer capped. */
export const RAMP_LEN = 4;

/** A recalled gap of at least PROVEN[i] days proves ramp level i + 1 (3 d → 1 … 30 d → 4). */
export const PROVEN = [3, 7, 14, 30] as const;

/** Stage thresholds (domain/stages.ts): ramp steps and stability (days). */
export const STAGE = { learnedStep: 3, learnedS: 14, durableStep: 5, durableS: 90 } as const;

/** Capped intervals of at least this many days get a small downward fuzz (≤ 10 %). */
export const RAMP_FUZZ_MIN_DAYS = 14;
