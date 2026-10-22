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
import { Rating } from './types';
import { FSRS_CONFIG } from './fsrsConfig';

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
export function createScheduler(settings: Pick<Settings, 'request_retention' | 'fsrs_params'>): Scheduler {
  const parsed = fsrsSettingsSchema.parse({
    request_retention: settings.request_retention,
    fsrs_params: settings.fsrs_params,
  });
  const params = generatorParameters({
    request_retention: parsed.request_retention,
    maximum_interval: FSRS_CONFIG.maximum_interval,
    enable_fuzz: FSRS_CONFIG.enable_fuzz,
    enable_short_term: FSRS_CONFIG.enable_short_term,
    learning_steps: [...FSRS_CONFIG.learning_steps],
    relearning_steps: [...FSRS_CONFIG.relearning_steps],
    ...(parsed.fsrs_params ? { w: parsed.fsrs_params } : {}),
  });
  const engine = createFsrs(params).useStrategy(StrategyMode.SEED, seedStrategy);
  return { settings: parsed, engine };
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

export function fromTsCard(c: TsCard): FsrsFields {
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
    a.last_review === b.last_review
  );
}

export const RATINGS: readonly RatingValue[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];

export function isRating(value: unknown): value is RatingValue {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

/** Apply one answer. Pure: returns new FSRS fields. */
export function applyRating(
  scheduler: Scheduler,
  card: { id: Id } & FsrsFields,
  rating: RatingValue,
  at: Millis,
): FsrsFields {
  if (!isRating(rating)) throw new Error(`Invalid rating ${String(rating)}`);
  const item = scheduler.engine.next(toTsCard(card.id, card), new Date(at), rating as number as Grade);
  return fromTsCard(item.card);
}

export interface IntervalPreview {
  rating: RatingValue;
  due: Millis;
  interval_ms: number;
  label: string; // "10 dk", "3 g"
  state: CardStateValue;
}

/** Next interval for each of the four answer buttons. */
export function previewIntervals(
  scheduler: Scheduler,
  card: { id: Id } & FsrsFields,
  at: Millis,
): Record<RatingValue, IntervalPreview> {
  const out = {} as Record<RatingValue, IntervalPreview>;
  for (const rating of RATINGS) {
    const next = applyRating(scheduler, card, rating, at);
    const interval = Math.max(0, next.due - at);
    out[rating] = { rating, due: next.due, interval_ms: interval, label: formatInterval(interval), state: next.state };
  }
  return out;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

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
