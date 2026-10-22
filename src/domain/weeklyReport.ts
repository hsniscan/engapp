// Weekly report (v0.3 İP7, docs/decisions/0027). Every number is computed here, on the device,
// by fixed rules; the AI (ai-report) only writes a 3–4 sentence comment about these numbers and
// never produces one itself. Pure: no Dexie, no React, no network.
//
//   - Week: Monday to Sunday in local days (timezone + day_start_hour). The report about last
//     week is made on the first open after Monday's day start.
//   - active days, answers, minutes, new cards: daily_activity (the review-log cache).
//   - new learned: notes whose first card first reached Review during the week.
//   - retention, strongest / weakest category: domain/retention.ts (the Gelişim rule, n ≥ 20);
//     over the week, or over the 28 days ending with it when no category had 20 answers.
//   - streak: domain/streak.ts at the end of the week (vacation days are neutral).
//   - goals: domain/goals.ts.
//   - focus: one key of REPORT_FOCUS_KEYS by a fixed priority (chooseFocus), with its action.
import {
  isNameableGroupKey,
  REPORT_FOCUS_KEYS,
  type ReportFocusKey,
  type ReportRequest,
} from '../../supabase/functions/_shared/report-contracts';
import { addDays, type DayKey, weekdayMon0 } from './day';
import { goalProgress, type Goals } from './goals';
import { isLeech } from './leech';
import {
  type GroupRetention,
  MIN_ANSWERS,
  overallRetention,
  RETENTION_DIMENSIONS,
  type RetentionCardFacts,
  type RetentionData,
  type RetentionStat,
  retentionByAllGroups,
  retentionStat,
  strongestGroup,
  weakestGroup,
  type WindowOptions,
  groupKeys,
  recognitionProductionGap,
  biggestGapNoteIds,
} from './retention';
import { currentStreak, isActive } from './streak';
import type { DailyActivity, Id, Millis, ReportGroupStat, WeeklyReportSummary } from './types';

export { REPORT_FOCUS_KEYS, type ReportFocusKey };

/**
 * Fallback for the "hard words" focus: while fewer than MIN_FOCUS_NOTES words are leeches
 * (İP6 rule, domain/leech.ts), a card with this many lapses counts as hard too.
 */
export const HARD_LAPSES = 3;
/** A practice or mnemonic focus needs at least this many words. */
export const MIN_FOCUS_NOTES = 3;
/** Notes in a focus list (a practice round holds at most 20 cards). */
export const FOCUS_LIST_SIZE = 20;
/** The weakest category is worth a focus when it is this far below the overall rate… */
export const WEAK_MARGIN = 0.05;
/** …or below this rate. */
export const WEAK_RATE = 0.8;
/** A recognition–production gap of at least this much is worth a focus. */
export const GAP_FOCUS = 0.1;
/** With this many active days or fewer (vacation days aside) the focus is coming back. */
export const FEW_ACTIVE_DAYS = 2;
/** Fallback window of the categories when the week alone has too few answers. */
export const GROUP_FALLBACK_DAYS = 28;

/** Monday of the week a day belongs to. */
export function mondayOf(day: DayKey): DayKey {
  return addDays(day, -weekdayMon0(day));
}

/** The week the report on `today` is about: the last complete week (its Monday). */
export function reportWeekFor(today: DayKey): DayKey {
  return addDays(mondayOf(today), -7);
}

/** The local day each note first reached Review (its earliest card). */
export function noteLearnedDays(
  data: Pick<RetentionData, 'reachedReview'>,
  facts: ReadonlyMap<Id, RetentionCardFacts>,
): Map<Id, DayKey> {
  const out = new Map<Id, DayKey>();
  for (const [cardId, r] of data.reachedReview) {
    const f = facts.get(cardId);
    if (!f) continue;
    const prev = out.get(f.note_id);
    if (prev === undefined || r.day < prev) out.set(f.note_id, r.day);
  }
  return out;
}

/** Notes learned between two days (both included). */
export function countLearned(learned: ReadonlyMap<Id, DayKey>, from: DayKey, to: DayKey): number {
  let n = 0;
  for (const day of learned.values()) if (day >= from && day <= to) n++;
  return n;
}

/** Answers, minutes and active days over days `from`..`to` (both included). */
export function activityTotals(
  activity: readonly DailyActivity[],
  from: DayKey,
  to: DayKey,
): { active_days: number; reviews: number; minutes: number; new_cards: number } {
  let active = 0;
  let reviews = 0;
  let timeMs = 0;
  let newCards = 0;
  for (const d of activity) {
    if (d.date < from || d.date > to) continue;
    if (isActive(d)) active++;
    reviews += d.reviews;
    timeMs += d.time_ms;
    newCards += d.new_cards;
  }
  return {
    active_days: active,
    reviews,
    minutes: Math.round(timeMs / 60_000),
    new_cards: newCards,
  };
}

/**
 * Notes of the cards in `group` that were missed (Again on a counted answer) within the window:
 * most misses first, then most answers, then note id. These make the practice round of the
 * "practice_weakest" focus.
 */
export function missedNoteIds(
  data: Pick<RetentionData, 'events'>,
  facts: ReadonlyMap<Id, RetentionCardFacts>,
  group: Pick<ReportGroupStat, 'dimension' | 'key'>,
  window: WindowOptions,
  limit = FOCUS_LIST_SIZE,
): Id[] {
  const perNote = new Map<Id, { misses: number; n: number }>();
  for (const e of data.events) {
    if (
      (window.from !== undefined && e.at < window.from) ||
      (window.to !== undefined && e.at >= window.to)
    )
      continue;
    const f = facts.get(e.card_id);
    if (!f || !groupKeys(f, group.dimension).includes(group.key)) continue;
    let c = perNote.get(f.note_id);
    if (!c) perNote.set(f.note_id, (c = { misses: 0, n: 0 }));
    c.n++;
    if (!e.passed) c.misses++;
  }
  return [...perNote]
    .filter(([, c]) => c.misses > 0)
    .sort(([a, x], [b, y]) => y.misses - x.misses || y.n - x.n || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, limit)
    .map(([id]) => id);
}

/**
 * Notes with a hard card, most lapses first, then note id. Hard = a leech (İP6 rule,
 * `isLeech`; card.lapses equals the lapses counted from the logs, invariant 3). While fewer
 * than MIN_FOCUS_NOTES notes have a leech, cards with lapses ≥ HARD_LAPSES count as well.
 */
export function hardNoteIds(
  cards: readonly { note_id: Id; lapses: number }[],
  limit = FOCUS_LIST_SIZE,
): Id[] {
  const best = new Map<Id, number>();
  for (const c of cards) {
    if (c.lapses < HARD_LAPSES) continue;
    best.set(c.note_id, Math.max(best.get(c.note_id) ?? 0, c.lapses));
  }
  const ranked = [...best].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0));
  const leeches = ranked.filter(([, lapses]) => isLeech(lapses));
  return (leeches.length >= MIN_FOCUS_NOTES ? leeches : ranked).slice(0, limit).map(([id]) => id);
}

function toStat(g: GroupRetention | null): ReportGroupStat | null {
  return g ? { dimension: g.dimension, key: g.key, n: g.n, passed: g.passed } : null;
}

export function statRate(s: { n: number; passed: number }): number | null {
  return s.n > 0 ? s.passed / s.n : null;
}

export interface FocusInput {
  activeDays: number;
  /** Vacation days of the week (they excuse inactivity). */
  frozenDays: number;
  /** Load forecast: first day over capacity and the suggested limit (domain/forecast.ts). */
  load: { overDay: number | null; suggestedLimit: number | null; currentLimit: number } | null;
  weakest: ReportGroupStat | null;
  /** Retention of all counted answers in the weakest group's window. */
  overall: RetentionStat;
  weakestNoteIds: readonly Id[];
  /** Recognition − production retention (null without 20 answers on each side). */
  gap: number | null;
  gapNoteIds: readonly Id[];
  hardNoteIds: readonly Id[];
  /** New cards waiting to be studied. */
  newAvailable: number;
}

export interface Focus {
  focus: ReportFocusKey;
  note_ids: Id[];
  value: number | null;
}

/**
 * The one focus of the week, by fixed priority:
 *   1. lower_new_limit  — the forecast exceeds the daily capacity and a lower limit fits;
 *   2. come_back        — at most 2 active days (vacation days count as excused);
 *   3. practice_weakest — the weakest category is ≥ 5 points below the overall rate or below
 *                         80 %, and has ≥ 3 missed words;
 *   4. practice_gap     — recognition beats production by ≥ 10 points, ≥ 3 such words;
 *   5. mnemonic_hard    — ≥ 3 words with a card forgotten ≥ 3 times;
 *   6. add_words        — no new card is waiting;
 *   7. keep_going.
 */
export function chooseFocus(i: FocusInput): Focus {
  const l = i.load;
  if (l && l.overDay !== null && l.suggestedLimit !== null && l.suggestedLimit < l.currentLimit)
    return { focus: 'lower_new_limit', note_ids: [], value: l.suggestedLimit };
  if (i.activeDays + i.frozenDays <= FEW_ACTIVE_DAYS && i.frozenDays < 7)
    return { focus: 'come_back', note_ids: [], value: null };
  if (i.weakest && i.weakestNoteIds.length >= MIN_FOCUS_NOTES) {
    const rate = statRate(i.weakest)!;
    const overall = i.overall.rate ?? 1;
    if (rate < WEAK_RATE || rate <= overall - WEAK_MARGIN)
      return { focus: 'practice_weakest', note_ids: [...i.weakestNoteIds], value: null };
  }
  if (i.gap !== null && i.gap >= GAP_FOCUS && i.gapNoteIds.length >= MIN_FOCUS_NOTES)
    return { focus: 'practice_gap', note_ids: [...i.gapNoteIds], value: null };
  if (i.hardNoteIds.length >= MIN_FOCUS_NOTES)
    return { focus: 'mnemonic_hard', note_ids: [...i.hardNoteIds], value: null };
  if (i.newAvailable === 0) return { focus: 'add_words', note_ids: [], value: null };
  return { focus: 'keep_going', note_ids: [], value: null };
}

export interface WeeklyReportInput {
  /** Monday of the reported week. */
  week: DayKey;
  /** Start of Monday's local day and of the next Monday's. */
  from: Millis;
  to: Millis;
  /** Start of the local day GROUP_FALLBACK_DAYS before `to`. */
  fallbackFrom: Millis;
  activity: readonly DailyActivity[];
  data: RetentionData;
  facts: ReadonlyMap<Id, RetentionCardFacts>;
  isFrozenDay?: (day: DayKey) => boolean;
  goals?: Goals | null;
  load: FocusInput['load'];
  newAvailable: number;
  /** Live, unsuspended cards with their lapses. */
  cards: readonly { note_id: Id; lapses: number }[];
}

/** The weakest and strongest category of a window (strongest null when it is the same group). */
export function rankedGroups(
  data: Pick<RetentionData, 'events'>,
  facts: ReadonlyMap<Id, RetentionCardFacts>,
  window: WindowOptions,
): { weakest: GroupRetention | null; strongest: GroupRetention | null; overall: RetentionStat } {
  const groups = retentionByAllGroups(data, facts, window);
  const all = RETENTION_DIMENSIONS.flatMap((d) => groups[d]);
  const weakest = weakestGroup(all);
  let strongest = strongestGroup(all);
  if (
    strongest &&
    weakest &&
    ((strongest.dimension === weakest.dimension && strongest.key === weakest.key) ||
      strongest.passed * weakest.n === weakest.passed * strongest.n)
  )
    strongest = null;
  return { weakest, strongest, overall: overallRetention(data, facts, window) };
}

/** Every number of the report on one week. */
export function buildWeeklySummary(input: WeeklyReportInput): WeeklyReportSummary {
  const week = input.week;
  const weekEnd = addDays(week, 6);
  const frozen = input.isFrozenDay ?? (() => false);
  const totals = activityTotals(input.activity, week, weekEnd);

  const learned = noteLearnedDays(input.data, input.facts);
  const newLearned = countLearned(learned, week, weekEnd);
  const monthLearned = countLearned(learned, `${weekEnd.slice(0, 7)}-01`, weekEnd);

  const weekWindow = { from: input.from, to: input.to };
  const retention = overallRetention(input.data, input.facts, weekWindow);
  let groupsDays: 7 | 28 = 7;
  let window: WindowOptions = weekWindow;
  let ranked = rankedGroups(input.data, input.facts, window);
  if (!ranked.weakest) {
    groupsDays = GROUP_FALLBACK_DAYS;
    window = { from: input.fallbackFrom, to: input.to };
    ranked = rankedGroups(input.data, input.facts, window);
  }

  const active = new Set<DayKey>();
  for (const d of input.activity) if (d.date <= weekEnd && isActive(d)) active.add(d.date);
  const streak = currentStreak(active, weekEnd, frozen);
  let frozenDays = 0;
  for (let i = 0; i < 7; i++) {
    const day = addDays(week, i);
    if (!active.has(day) && frozen(day)) frozenDays++;
  }

  const goals = goalProgress(input.goals, {
    weekActiveDays: totals.active_days,
    weekMinutes: totals.minutes,
    monthLearned,
  }).map(({ key, target, value }) => ({ key, target, value }));

  const gap = recognitionProductionGap(input.data, input.facts, window);
  const weakest = toStat(ranked.weakest);
  const focus = chooseFocus({
    activeDays: totals.active_days,
    frozenDays,
    load: input.load,
    weakest,
    overall: ranked.overall,
    weakestNoteIds: weakest ? missedNoteIds(input.data, input.facts, weakest, window) : [],
    gap: gap.gap,
    gapNoteIds: biggestGapNoteIds(gap),
    hardNoteIds: hardNoteIds(input.cards),
    newAvailable: input.newAvailable,
  });

  return {
    v: 1,
    week,
    week_end: weekEnd,
    active_days: totals.active_days,
    reviews: totals.reviews,
    minutes: totals.minutes,
    new_cards: totals.new_cards,
    new_learned: newLearned,
    retention: { n: retention.n, passed: retention.passed },
    groups_days: groupsDays,
    strongest: toStat(ranked.strongest),
    weakest,
    streak,
    goals,
    focus: focus.focus,
    focus_note_ids: focus.note_ids,
    focus_value: focus.value,
  };
}

/** Whole percent, as the app shows it. */
export function pct(rate: number): number {
  return Math.round(rate * 100);
}

/** The week's retention as shown: null with fewer than MIN_ANSWERS answers. */
export function shownRetention(s: { n: number; passed: number }): number | null {
  return retentionStat(s.passed, s.n).enough ? s.passed / s.n : null;
}

/**
 * What ai-report receives: the summary numbers and group names from fixed lists only. No note
 * id, word, sentence or source title is ever put in it (a source is sent without its key).
 */
export function toReportRequest(s: WeeklyReportSummary): ReportRequest {
  const group = (g: ReportGroupStat | null) =>
    g
      ? {
          dimension: g.dimension,
          key: isNameableGroupKey(g.dimension, g.key) ? g.key : null,
          rate_pct: pct(g.passed / g.n),
        }
      : null;
  const retention = shownRetention(s.retention);
  return {
    week: s.week,
    active_days: s.active_days,
    reviews: s.reviews,
    minutes: s.minutes,
    new_learned: s.new_learned,
    retention_pct: retention === null ? null : pct(retention),
    groups_days: s.groups_days,
    strongest: group(s.strongest),
    weakest: group(s.weakest),
    streak_days: s.streak,
    goals: s.goals.map((g) => ({ key: g.key, target: g.target, value: g.value })),
    focus: (REPORT_FOCUS_KEYS as readonly string[]).includes(s.focus)
      ? (s.focus as ReportFocusKey)
      : 'keep_going',
  };
}

/** A group needs MIN_ANSWERS answers to be named (re-exported for the UI). */
export { MIN_ANSWERS };
