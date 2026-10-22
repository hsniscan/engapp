// Load management on the device (v0.3 İP3, docs/decisions/0021-load-management.md): today's
// catch-up / vacation plan for the study queue, the home screen's notes, the 30-day forecast
// input, and the settings actions. The rules are pure functions in domain/capacity.ts,
// catchup.ts, forecast.ts and vacation.ts; this file only reads Dexie and caches.
import Dexie from 'dexie';
import { capacityMinutes, cardsForMinutes, secondsPerCard } from '../domain/capacity';
import { estimateCatchupDays, type LoadPlan, planLoad, rampedNewLimit } from '../domain/catchup';
import { addDays, type DayConfig, type DayKey, dayEndMs, dayKeyOf, dayStartMs } from '../domain/day';
import {
  FORECAST_DAYS,
  type ForecastCard,
  forecastTotals,
  forecastWorkload,
  type LoadAdvice,
  loadAdvice,
} from '../domain/forecast';
import { emptyFsrs, type Scheduler } from '../domain/fsrs';
import { replayCard } from '../domain/recompute';
import { type Card, CardState, type FsrsFields, type Millis, type Settings, type VacationRange } from '../domain/types';
import {
  aheadDaysBeforeVacation,
  daysSinceVacation,
  endVacationEarly,
  isOnVacation,
  isValidRange,
  withVacation,
} from '../domain/vacation';
import { db } from './db';
import { ActionError } from './errors';
import { logsByCard } from './history';
import { getMeta, setMeta } from './meta';
import { dayConfig, getSettings, schedulerFor, updateSettings } from './settings';

const DAY_MS = 86_400_000;
/** Device-local: the day the user closed the load warning (it stays hidden for a week). */
export const LOAD_WARNING_DISMISSED_KEY = 'load_warning_dismissed';
const WARNING_SNOOZE_DAYS = 7;

const studiable = (c: Card): boolean => c.deleted_at === null && !c.suspended && c.unlocked;

/** Studiable Review-state cards due before `until`. */
async function reviewCardsDueBefore(until: Millis): Promise<Card[]> {
  return db.cards
    .where('[state+due]')
    .between([CardState.Review, Dexie.minKey], [CardState.Review, until], true, false)
    .filter(studiable)
    .toArray();
}

interface DayFacts {
  /** Review-state cards due before the end of today, as of the start of today. */
  backlogToday: number;
  backlogYesterday: number;
  secPerCard: number;
}

let memo: { key: string; facts: DayFacts } | null = null;

/** FSRS fields of a card just before `at`, from its replay steps. */
function stateAt(steps: { log: { reviewed_at: Millis }; after: FsrsFields }[], created: Millis, at: Millis): FsrsFields {
  let f = emptyFsrs(created);
  for (const s of steps) {
    if (s.log.reviewed_at >= at) break;
    f = s.after;
  }
  return f;
}

/**
 * Backlogs at the start of today and yesterday, and the user's pace. Computed once per day
 * (and again when older logs arrive by sync or restore): cards answered since yesterday are
 * replayed to see where they stood at each day start.
 */
async function loadDayFacts(settings: Settings, cfg: DayConfig, today: DayKey, scheduler: Scheduler): Promise<DayFacts> {
  const tStart = dayStartMs(today, cfg);
  const tEnd = dayEndMs(today, cfg);
  const yStart = dayStartMs(addDays(today, -1), cfg);
  const before = await db.review_logs.where('reviewed_at').below(tStart).count();
  const key = [today, cfg.timezone, cfg.day_start_hour, settings.request_retention, settings.fsrs_params?.join(','), before].join('|');
  if (memo?.key === key) return memo.facts;

  const recent = await db.review_logs.where('reviewed_at').between(tStart - 30 * DAY_MS, tStart, true, false).toArray();
  const secPerCard = secondsPerCard(recent, tStart);

  const since = await db.review_logs.where('reviewed_at').aboveOrEqual(yStart).toArray();
  const answeredIds = new Set(since.map((l) => l.card_id));
  let backlogToday = 0;
  let backlogYesterday = 0;
  for (const c of await reviewCardsDueBefore(tEnd)) {
    if (answeredIds.has(c.id)) continue;
    backlogToday++;
    if (c.due < tStart) backlogYesterday++;
  }
  if (answeredIds.size) {
    const [cards, logs] = await Promise.all([db.cards.bulkGet([...answeredIds]), logsByCard(answeredIds)]);
    for (const card of cards) {
      if (!card || !studiable(card)) continue;
      const steps = replayCard(scheduler, card, logs.get(card.id) ?? []).steps;
      const atToday = stateAt(steps, card.created_at, tStart);
      if (atToday.state === CardState.Review && atToday.due < tEnd) backlogToday++;
      const atYesterday = stateAt(steps, card.created_at, yStart);
      if (atYesterday.state === CardState.Review && atYesterday.due < tStart) backlogYesterday++;
    }
  }
  const facts = { backlogToday, backlogYesterday, secPerCard };
  memo = { key, facts };
  return facts;
}

export interface LoadToday {
  day: DayKey;
  plan: LoadPlan;
  capacityMin: number;
  /** Cards a day that fit the capacity. */
  capacity: number;
  secPerCard: number;
  backlogToday: number;
  /** Review-state cards still due today (not answered yet). */
  dueReviewsLeft: number;
  /** Reviews answered today (backlog − still due). */
  reviewsDoneToday: number;
  /** The daily new-card limit after the ramp. */
  newLimitToday: number;
  onVacation: boolean;
  daysSinceVacation: number | null;
}

/** Today's load plan (call inside a read transaction over cards, review_logs, settings). */
export async function getLoadToday(settings: Settings, now: Millis): Promise<LoadToday> {
  const cfg = dayConfig(settings);
  const day = dayKeyOf(now, cfg);
  const scheduler = schedulerFor(settings);
  const facts = await loadDayFacts(settings, cfg, day, scheduler);
  const dueReviewsLeft = (await reviewCardsDueBefore(dayEndMs(day, cfg))).length;
  const reviewsDoneToday = Math.max(0, facts.backlogToday - dueReviewsLeft);
  const capacityMin = capacityMinutes(settings);
  const capacity = cardsForMinutes(capacityMin, facts.secPerCard);
  const since = daysSinceVacation(settings, day);
  const onVacation = isOnVacation(settings, day);
  const plan = planLoad({
    capacity,
    catchupAuto: settings.catchup_auto !== false,
    backlogToday: facts.backlogToday,
    backlogYesterday: facts.backlogYesterday,
    reviewsDoneToday,
    onVacationToday: onVacation,
    daysSinceVacation: since,
  });
  return {
    day,
    plan,
    capacityMin,
    capacity,
    secPerCard: facts.secPerCard,
    backlogToday: facts.backlogToday,
    dueReviewsLeft,
    reviewsDoneToday,
    newLimitToday: rampedNewLimit(settings.daily_new_limit, plan.newFactor),
    onVacation,
    daysSinceVacation: since,
  };
}

/** Days after today whose reviews "Yarının kartları" may bring now (more before a vacation). */
export function aheadDaysFor(settings: Settings, today: DayKey): number {
  return Math.max(1, aheadDaysBeforeVacation(settings, today));
}

// ------------------------------------------------------------------ home notes

export interface LoadStatus extends LoadToday {
  /** Catch-up: days until the backlog is gone (today = 1), null when beyond 30 days. */
  catchupDays: number | null;
  vacation: VacationRange | null;
  /** Before a vacation: days of reviews that can be done now (0 = no offer), and how many. */
  aheadDays: number;
  aheadCount: number;
}

export async function getLoadStatus(now: Millis = Date.now()): Promise<LoadStatus> {
  return db.transaction('r', [db.cards, db.review_logs, db.settings], async () => {
    const settings = await getSettings(now);
    const cfg = dayConfig(settings);
    const today = await getLoadToday(settings, now);
    let catchupDays: number | null = null;
    if (today.plan.mode === 'catchup') {
      const ends = Array.from({ length: FORECAST_DAYS }, (_, i) => dayEndMs(addDays(today.day, i + 1), cfg));
      const upcoming = await db.cards
        .where('[state+due]')
        .between([CardState.Review, dayEndMs(today.day, cfg)], [CardState.Review, ends.at(-1)!], true, false)
        .filter(studiable)
        .toArray();
      const arrivals = new Array<number>(FORECAST_DAYS).fill(0);
      for (const c of upcoming) {
        const i = ends.findIndex((e) => c.due < e);
        if (i >= 0) arrivals[i]!++;
      }
      catchupDays = estimateCatchupDays(today.backlogToday, today.capacity, arrivals);
    }
    const aheadDays = aheadDaysBeforeVacation(settings, today.day);
    const aheadCount = aheadDays
      ? (
          await db.cards
            .where('[state+due]')
            .between(
              [CardState.Review, dayEndMs(today.day, cfg)],
              [CardState.Review, dayEndMs(addDays(today.day, aheadDays), cfg)],
              true,
              false,
            )
            .filter(studiable)
            .toArray()
        ).length
      : 0;
    return {
      ...today,
      catchupDays,
      vacation: settings.vacation && isValidRange(settings.vacation) ? settings.vacation : null,
      aheadDays,
      aheadCount,
    };
  });
}

// ------------------------------------------------------------------ forecast

export interface WorkloadInput {
  settings: Settings;
  cards: ForecastCard[];
  bounds: Millis[];
  days: DayKey[];
  newAvailable: number;
  newToday: number;
  skipDays: boolean[];
  newFactor: number[];
  capacity: number;
  capacityMin: number;
  secPerCard: number;
  dailyNewLimit: number;
}

/** Everything the 30-day forecast needs; cheap reads, safe in useLiveQuery. */
export async function getWorkloadInput(now: Millis = Date.now()): Promise<WorkloadInput> {
  return db.transaction('r', [db.cards, db.review_logs, db.settings], async () => {
    const settings = await getSettings(now);
    const cfg = dayConfig(settings);
    const today = await getLoadToday(settings, now);
    const days = Array.from({ length: FORECAST_DAYS }, (_, i) => addDays(today.day, i));
    const bounds = [...days.map((d) => dayStartMs(d, cfg)), dayEndMs(days.at(-1)!, cfg)];
    const studied = await Promise.all(
      [CardState.Learning, CardState.Review, CardState.Relearning].map((s) =>
        db.cards.where('[state+due]').between([s, Dexie.minKey], [s, Dexie.maxKey]).filter(studiable).toArray(),
      ),
    );
    const newAvailable = await db.cards
      .where('[state+due]')
      .between([CardState.New, Dexie.minKey], [CardState.New, Dexie.maxKey])
      .filter(studiable)
      .count();
    const introducedToday = await countIntroducedToday(bounds[0]!, bounds[1]!);
    const skipDays = days.map((d, i) => i > 0 && isOnVacation(settings, d));
    const newFactor = days.map((d, i) => {
      if (i === 0) return today.plan.newFactor;
      if (isOnVacation(settings, d)) return 0;
      const since = daysSinceVacation(settings, d);
      return since === 1 ? 0 : since === 2 ? 0.5 : 1;
    });
    return {
      settings,
      cards: studied.flat().map((c) => ({
        state: c.state,
        due: c.due,
        stability: c.stability,
        difficulty: c.difficulty,
        last_review: c.last_review,
      })),
      bounds,
      days,
      newAvailable,
      newToday: Math.max(0, today.newLimitToday - introducedToday),
      skipDays,
      newFactor,
      capacity: today.capacity,
      capacityMin: today.capacityMin,
      secPerCard: today.secPerCard,
      dailyNewLimit: settings.daily_new_limit,
    };
  });
}

/** Cards whose first answer is today (new cards opened today). */
async function countIntroducedToday(start: Millis, end: Millis): Promise<number> {
  const todays = await db.review_logs.where('reviewed_at').between(start, end, true, false).toArray();
  const ids = new Set(todays.filter((l) => l.undo_of === null).map((l) => l.card_id));
  if (!ids.size) return 0;
  const earlier = await db.review_logs.where('card_id').anyOf([...ids]).filter((l) => l.reviewed_at < start).toArray();
  for (const l of earlier) ids.delete(l.card_id);
  return ids.size;
}

export interface WorkloadView {
  days: DayKey[];
  /** Expected answers per day with the current new-card limit. */
  totals: number[];
  capacity: number;
  capacityMin: number;
  secPerCard: number;
  dailyNewLimit: number;
  advice: LoadAdvice;
}

/** Run the forecast (pure, ~10–40 ms for 5 000 cards; call it from an idle callback). */
export function computeWorkload(input: WorkloadInput): WorkloadView {
  const f = forecastWorkload(schedulerFor(input.settings), {
    cards: input.cards,
    bounds: input.bounds,
    newAvailable: input.newAvailable,
    newToday: input.newToday,
    skipDays: input.skipDays,
    newFactor: input.newFactor,
  });
  return {
    days: input.days,
    totals: forecastTotals(f, input.dailyNewLimit),
    capacity: input.capacity,
    capacityMin: input.capacityMin,
    secPerCard: input.secPerCard,
    dailyNewLimit: input.dailyNewLimit,
    advice: loadAdvice(f, input.capacity, input.dailyNewLimit),
  };
}

// ------------------------------------------------------------------ actions

/** Hide the load warning on the home screen for a week (this device). */
export async function dismissLoadWarning(now: Millis = Date.now()): Promise<void> {
  const settings = await getSettings(now);
  await setMeta(LOAD_WARNING_DISMISSED_KEY, dayKeyOf(now, dayConfig(settings)));
}

/** The warning was closed less than a week ago. */
export async function isLoadWarningSnoozed(now: Millis = Date.now()): Promise<boolean> {
  const day = await getMeta<string>(LOAD_WARNING_DISMISSED_KEY);
  if (typeof day !== 'string') return false;
  const settings = await getSettings(now);
  return dayKeyOf(now, dayConfig(settings)) < addDays(day, WARNING_SNOOZE_DAYS);
}

/** Set (or replace) the vacation. Days of a vacation that already began stay a vacation. */
export async function setVacation(range: VacationRange, now: Millis = Date.now()): Promise<Settings> {
  if (!isValidRange(range)) throw new ActionError('invalid_input', 'Invalid vacation range');
  const settings = await getSettings(now);
  const today = dayKeyOf(now, dayConfig(settings));
  if (range.end < today) throw new ActionError('invalid_input', 'Vacation is over');
  return updateSettings(withVacation(settings, range, today), now);
}

/** End the vacation today (or cancel one that has not begun). */
export async function endVacation(now: Millis = Date.now()): Promise<Settings> {
  const settings = await getSettings(now);
  const today = dayKeyOf(now, dayConfig(settings));
  const next = endVacationEarly(settings, today);
  return next ? updateSettings(next, now) : settings;
}

/** For tests: forget the per-day cache. */
export function resetLoadCache(): void {
  memo = null;
}
