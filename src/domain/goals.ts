// Goals on the continuity panel (v0.3 İP7, docs/decisions/0027): "haftada 6 gün", "ayda 150
// yeni kelime", "haftada 120 dakika". The user sets them; the app suggests a realistic value
// from the last 8 weeks (80th percentile, rounded). Pure: no Dexie, no React.
import {
  REPORT_GOAL_KEYS,
  type ReportGoalKey,
} from '../../supabase/functions/_shared/report-contracts';

export const GOAL_KEYS = REPORT_GOAL_KEYS;
export type GoalKey = ReportGoalKey;

/** settings.goals: every field optional; absent or null = no goal of that kind. */
export interface Goals {
  week_active_days?: number | null;
  month_new_terms?: number | null;
  week_minutes?: number | null;
}

/** Values the user can set. */
export const GOAL_LIMITS: Record<GoalKey, { min: number; max: number; step: number }> = {
  week_active_days: { min: 1, max: 7, step: 1 },
  week_minutes: { min: 5, max: 2000, step: 5 },
  month_new_terms: { min: 5, max: 2000, step: 5 },
};

/** Weeks of history behind a suggestion. */
export const SUGGESTION_WEEKS = 8;
/** The suggestion is this percentile of the weeks (a good week, not the best one). */
export const SUGGESTION_PERCENTILE = 0.8;
/** With fewer weeks of history than this, the suggestion is a modest default. */
export const MIN_SUGGESTION_WEEKS = 2;
/** Suggestions without history. */
export const DEFAULT_GOALS: Record<GoalKey, number> = {
  week_active_days: 4,
  week_minutes: 60,
  month_new_terms: 40,
};
/** Days of a month for the monthly suggestion from weekly numbers. */
const MONTH_PER_WEEK = 30 / 7;

/** One past week (Monday to Sunday). */
export interface WeekFacts {
  active_days: number;
  minutes: number;
  /** Notes that first reached the review stage that week. */
  learned: number;
}

/** The goals that are set, as numbers (invalid values dropped). */
export function activeGoals(goals: Goals | null | undefined): Partial<Record<GoalKey, number>> {
  const out: Partial<Record<GoalKey, number>> = {};
  if (!goals) return out;
  for (const key of GOAL_KEYS) {
    const v = goals[key];
    if (
      typeof v === 'number' &&
      Number.isInteger(v) &&
      v >= GOAL_LIMITS[key].min &&
      v <= GOAL_LIMITS[key].max
    )
      out[key] = v;
  }
  return out;
}

export interface GoalProgress {
  key: GoalKey;
  target: number;
  value: number;
  /** value / target, at most 1 (for the ring). */
  ratio: number;
  met: boolean;
}

/** Progress of each goal that is set, in GOAL_KEYS order. */
export function goalProgress(
  goals: Goals | null | undefined,
  facts: { weekActiveDays: number; weekMinutes: number; monthLearned: number },
): GoalProgress[] {
  const value: Record<GoalKey, number> = {
    week_active_days: facts.weekActiveDays,
    week_minutes: facts.weekMinutes,
    month_new_terms: facts.monthLearned,
  };
  const set = activeGoals(goals);
  return GOAL_KEYS.flatMap((key) => {
    const target = set[key];
    if (target === undefined) return [];
    const v = value[key];
    return [{ key, target, value: v, ratio: Math.min(1, v / target), met: v >= target }];
  });
}

/**
 * The p-th percentile (0–1) by linear interpolation between the closest ranks (the common
 * "type 7" definition: the median of 1..4 is 2.5). Null for an empty list.
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function clamp(key: GoalKey, v: number): number {
  return Math.min(GOAL_LIMITS[key].max, Math.max(GOAL_LIMITS[key].min, v));
}

export interface GoalSuggestion {
  value: number;
  /** 'history': from the last weeks; 'default': too little history, a modest start. */
  basis: 'history' | 'default';
  /** Weeks the suggestion looked at. */
  weeks: number;
}

/**
 * Suggested goals from the last complete weeks (oldest first, at most SUGGESTION_WEEKS are
 * used). Weeks before the first active week are left out (the account did not exist yet).
 * Each value is the 80th percentile, rounded: days to a whole day, minutes and the monthly
 * number of new words to 5 (the monthly one from the weekly numbers × 30/7).
 */
export function suggestGoals(weeks: readonly WeekFacts[]): Record<GoalKey, GoalSuggestion> {
  const recent = weeks.slice(-SUGGESTION_WEEKS);
  const first = recent.findIndex((w) => w.active_days > 0);
  const used = first < 0 ? [] : recent.slice(first);
  if (used.length < MIN_SUGGESTION_WEEKS) {
    const out = {} as Record<GoalKey, GoalSuggestion>;
    for (const key of GOAL_KEYS)
      out[key] = { value: DEFAULT_GOALS[key], basis: 'default', weeks: used.length };
    return out;
  }
  const p = (f: (w: WeekFacts) => number) => percentile(used.map(f), SUGGESTION_PERCENTILE)!;
  const at = (key: GoalKey, value: number): GoalSuggestion => ({
    value: clamp(key, value),
    basis: 'history',
    weeks: used.length,
  });
  return {
    week_active_days: at('week_active_days', Math.round(p((w) => w.active_days))),
    week_minutes: at(
      'week_minutes',
      roundTo(
        p((w) => w.minutes),
        5,
      ),
    ),
    month_new_terms: at('month_new_terms', roundTo(p((w) => w.learned) * MONTH_PER_WEEK, 5)),
  };
}
