// Thin wrapper over ts-fsrs. All scheduling goes through here so that the live answer
// path and recompute (replay from logs) use exactly the same parameters and fuzz seed.
import {
  type AbstractScheduler,
  type Card as TsCard,
  type FSRS,
  type Grade,
  fsrs as createFsrs,
  generatorParameters,
  StrategyMode,
} from 'ts-fsrs';
import { z } from 'zod';
import type { CardStateValue, FsrsFields, Id, Millis, RatingValue, Settings } from './types';
import { CardState, Rating } from './types';
import { FSRS_CONFIG, GRAD_CAP, PROVEN, RAMP_CAPS, RAMP_EPOCH, RAMP_FUZZ_MIN_DAYS, RAMP_LEN } from './fsrsConfig';
import { cardStage, isLearnedStage, type WordStage } from './stages';

export { FSRS_CONFIG };

export const RETENTION_MIN = 0.8;
export const RETENTION_MAX = 0.95;

export const fsrsSettingsSchema = z.object({
  request_retention: z.number().min(RETENTION_MIN).max(RETENTION_MAX),
  fsrs_params: z
    .array(z.number().finite())
    .refine((w) => [17, 19, 21].includes(w.length), 'FSRS weights must have 17, 19 or 21 values')
    .nullable(),
});

export type FsrsSettings = z.infer<typeof fsrsSettingsSchema>;

export interface Scheduler {
  readonly settings: FsrsSettings;
  readonly engine: FSRS;
  /** Interval fuzz (FSRS's own and the ramp's downward fuzz). Off only in tests and tools. */
  readonly fuzz: boolean;
}

export interface SchedulerOptions {
  /** Default FSRS_CONFIG.enable_fuzz. Tests turn it off to reproduce exact intervals. */
  fuzz?: boolean;
}

/** ts-fsrs card plus our id, which the seed strategy reads. */
type SeededCard = TsCard & { card_id: string };

/**
 * Fuzz seed = card id + review time + reps. Same card, same answer time, same history
 * → same interval, on every device and in every recompute.
 */
function seedStrategy(this: AbstractScheduler): string {
  const current = Reflect.get(this, 'current') as SeededCard;
  const reviewTime = Reflect.get(this, 'review_time') as Date;
  return `${current.card_id}|${reviewTime.getTime()}|${current.reps}`;
}

/** Validate settings and build a scheduler. Throws a ZodError on invalid values. */
export function createScheduler(
  settings: Pick<Settings, 'request_retention' | 'fsrs_params'>,
  options: SchedulerOptions = {},
): Scheduler {
  const fuzz = options.fuzz ?? FSRS_CONFIG.enable_fuzz;
  const parsed = fsrsSettingsSchema.parse({
    request_retention: settings.request_retention,
    fsrs_params: settings.fsrs_params,
  });
  const params = generatorParameters({
    request_retention: parsed.request_retention,
    maximum_interval: FSRS_CONFIG.maximum_interval,
    enable_fuzz: fuzz,
    enable_short_term: FSRS_CONFIG.enable_short_term,
    learning_steps: [...FSRS_CONFIG.learning_steps],
    relearning_steps: [...FSRS_CONFIG.relearning_steps],
    ...(parsed.fsrs_params ? { w: parsed.fsrs_params } : {}),
  });
  const engine = createFsrs(params).useStrategy(StrategyMode.SEED, seedStrategy);
  return { settings: parsed, engine, fuzz };
}

/** FSRS fields of a card that was never reviewed. */
export function emptyFsrs(createdAt: Millis): FsrsFields {
  return {
    due: createdAt,
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    last_review: null,
    ramp_step: 0,
    learned_at: null,
  };
}

export function toTsCard(id: Id, f: FsrsFields): SeededCard {
  return {
    card_id: id,
    due: new Date(f.due),
    stability: f.stability,
    difficulty: f.difficulty,
    elapsed_days: f.elapsed_days,
    scheduled_days: f.scheduled_days,
    learning_steps: f.learning_steps,
    reps: f.reps,
    lapses: f.lapses,
    state: f.state,
    ...(f.last_review !== null ? { last_review: new Date(f.last_review) } : {}),
  };
}

/** The FSRS engine's own fields of a ts-fsrs card (the ramp fields are added by applyRating). */
export function fromTsCard(c: TsCard): Omit<FsrsFields, 'ramp_step' | 'learned_at'> {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as number as CardStateValue,
    last_review: c.last_review ? c.last_review.getTime() : null,
  };
}

export function pickFsrs(f: FsrsFields): FsrsFields {
  return {
    due: f.due,
    stability: f.stability,
    difficulty: f.difficulty,
    elapsed_days: f.elapsed_days,
    scheduled_days: f.scheduled_days,
    learning_steps: f.learning_steps,
    reps: f.reps,
    lapses: f.lapses,
    state: f.state,
    last_review: f.last_review,
    ramp_step: f.ramp_step,
    learned_at: f.learned_at,
  };
}

export function fsrsEqual(a: FsrsFields, b: FsrsFields): boolean {
  return (
    a.due === b.due &&
    a.stability === b.stability &&
    a.difficulty === b.difficulty &&
    a.elapsed_days === b.elapsed_days &&
    a.scheduled_days === b.scheduled_days &&
    a.learning_steps === b.learning_steps &&
    a.reps === b.reps &&
    a.lapses === b.lapses &&
    a.state === b.state &&
    a.last_review === b.last_review &&
    a.ramp_step === b.ramp_step &&
    a.learned_at === b.learned_at
  );
}

export const RATINGS: readonly RatingValue[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];

export function isRating(value: unknown): value is RatingValue {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const RATING_KEY = { 2: 'Hard', 3: 'Good', 4: 'Easy' } as const;

/** 32-bit FNV-1a: deterministic on every device. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Integer in [min, max] from a string seed. */
export function seededInt(seed: string, min: number, max: number): number {
  if (max <= min) return min;
  return min + (fnv1a(seed) % (max - min + 1));
}

/** Ramp level a recalled gap of `gapDays` proves on its own (3 d → 1, 7 → 2, 14 → 3, 30 → 4). */
export function provenLevel(gapDays: number): number {
  return PROVEN.filter((d) => gapDays >= d).length;
}

/** A ramp cap: `days` the upper bound; only a table cap (`fromTable`) gets the downward fuzz,
 * and never below `min`, the proven-gap floor of the answer. */
export interface RampCap {
  days: number;
  fromTable: boolean;
  min: number;
}

/**
 * The ramp's cap (days) for an answer, or null when FSRS is free. Leaving (re)learning: 1 day
 * (Hard, Good) or 3 (Easy). In Review, by ramp_step from RAMP_CAPS; Good and Easy never get a
 * shorter interval than the gap the word has just survived (Easy one day more, so a long gap
 * never makes Good and Easy equal). `fromTable` is false for the graduation cap and when the
 * floor raised the cap.
 */
export function rampCap(before: CardStateValue, rating: RatingValue, rampStep: number, gapDays: number): RampCap | null {
  if (rating === Rating.Again) return null;
  const key = RATING_KEY[rating];
  if (before !== CardState.Review) return { days: GRAD_CAP[key], fromTable: false, min: 0 };
  if (rampStep >= RAMP_LEN) return null;
  const table = RAMP_CAPS[key][rampStep]!;
  const floor = rating === Rating.Hard ? 0 : Math.floor(gapDays) + (rating === Rating.Easy ? 1 : 0);
  if (floor > table) return { days: floor, fromTable: false, min: floor };
  return { days: table, fromTable: true, min: floor };
}

/**
 * Ramp counter after an answer. Learning steps never move it; Again resets it (to 1 when the
 * word had been learned, ramp ≥ 3); an early review (under 12 h, or under half the planned
 * interval) does not count; otherwise +1, and at least the level the gap itself proves.
 */
export function nextRampStep(
  before: CardStateValue,
  rating: RatingValue,
  rampStep: number,
  gapDays: number,
  scheduledDays: number,
): number {
  if (before !== CardState.Review) return rampStep;
  if (rating === Rating.Again) return rampStep >= 3 ? 1 : 0;
  if (gapDays < 0.5 || gapDays < scheduledDays / 2) return rampStep;
  return Math.max(rampStep + 1, provenLevel(gapDays));
}

/**
 * Apply one answer. Pure and deterministic: the live answer path, the button previews and the
 * replay from logs all go through here and agree. FSRS computes the memory state as before;
 * for answers at or after RAMP_EPOCH the ramp caps the interval (docs/decisions/0041).
 */
export function applyRating(
  scheduler: Scheduler,
  card: { id: Id } & FsrsFields,
  rating: RatingValue,
  at: Millis,
): FsrsFields {
  if (!isRating(rating)) throw new Error(`Invalid rating ${String(rating)}`);
  const before = card.state;
  const rampStep = card.ramp_step ?? 0;
  const gapDays = card.last_review !== null ? (at - card.last_review) / DAY : 0;
  const item = scheduler.engine.next(toTsCard(card.id, card), new Date(at), rating as number as Grade);
  const fsrs = fromTsCard(item.card);
  if (at >= RAMP_EPOCH && fsrs.state === CardState.Review && rating !== Rating.Again) {
    const cap = rampCap(before, rating, rampStep, gapDays);
    if (cap !== null && fsrs.scheduled_days > cap.days) {
      let days = cap.days;
      if (scheduler.fuzz && cap.fromTable && days >= RAMP_FUZZ_MIN_DAYS) {
        days = Math.max(cap.min, days - seededInt(`${card.id}|${at}|${card.reps}`, 0, Math.floor(days * 0.1)));
      }
      fsrs.scheduled_days = days;
      fsrs.due = at + days * DAY;
    }
  }
  const ramp_step = nextRampStep(before, rating, rampStep, gapDays, card.scheduled_days);
  const next: FsrsFields = { ...fsrs, ramp_step, learned_at: card.learned_at ?? null };
  if (next.learned_at === null && isLearnedStage(cardStage(next))) next.learned_at = at;
  return next;
}

export interface IntervalPreview {
  rating: RatingValue;
  due: Millis;
  interval_ms: number;
  /** Button label (formatNextInterval): "10 dk", "yarın", "3 gün", "2 hafta", "1 ay". */
  label: string;
  state: CardStateValue;
  /** The card's stage after this answer (compare with cardStage(card) for the arrow line). */
  stageAfter: WordStage;
}

/** Next interval and stage for each of the four answer buttons. */
export function previewIntervals(
  scheduler: Scheduler,
  card: { id: Id } & FsrsFields,
  at: Millis,
): Record<RatingValue, IntervalPreview> {
  const out = {} as Record<RatingValue, IntervalPreview>;
  for (const rating of RATINGS) {
    const next = applyRating(scheduler, card, rating, at);
    const interval = Math.max(0, next.due - at);
    out[rating] = {
      rating,
      due: next.due,
      interval_ms: interval,
      label: formatNextInterval(interval),
      state: next.state,
      stageAfter: cardStage(next),
    };
  }
  return out;
}

function trNumber(n: number): string {
  // One decimal at most, Turkish decimal comma, no trailing ",0".
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace('.', ',');
}

/** Short Turkish interval label: "1 dk", "10 dk", "5 sa", "3 g", "2 ay", "1,5 yıl". */
export function formatInterval(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))} dk`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} sa`;
  const days = ms / DAY;
  if (days < 30) return `${Math.round(days)} g`;
  if (days < 365) return `${trNumber(days / 30)} ay`;
  return `${trNumber(days / 365)} yıl`;
}

/**
 * Plain label of the next review under an answer button (ogrenme-modeli.md 5.1):
 * under 1 h "6 dk"; same day "3 sa"; next day "yarın"; 2–6 days "3 gün"; 7/14/21/28 days
 * "1 hafta"…"4 hafta", other days "13 gün"; 30 days to 3 months in half months ("1 ay",
 * "1,5 ay"); 3 months to a year in whole months ("4 ay"); a year and more in half years.
 */
export function formatNextInterval(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))} dk`;
  if (ms < DAY) return `${Math.min(23, Math.round(ms / HOUR))} sa`;
  const days = Math.round(ms / DAY);
  if (days <= 1) return 'yarın';
  if (days < 7) return `${days} gün`;
  if (days < 30) return days % 7 === 0 ? `${days / 7} hafta` : `${days} gün`;
  if (days < 90) return `${trNumber(Math.round((days / 30) * 2) / 2)} ay`;
  const months = Math.round(days / 30);
  if (days < 365 && months < 12) return `${months} ay`;
  return `${trNumber(Math.max(1, Math.round((days / 365) * 2) / 2))} yıl`;
}
