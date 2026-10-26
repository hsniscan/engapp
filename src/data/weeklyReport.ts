// Weekly report and goals (v0.3 İP7, docs/decisions/0027), data side. The numbers come from
// domain/weeklyReport.ts and domain/goals.ts; this module gathers their input, keeps the
// report of a week while its AI comment has not come (report_drafts, local only) and stores
// the final report in weekly_reports (synced, insert-only, one per week).
import type { DayKey } from '../domain/day';
import { addDays, dayKeyOf, dayStartMs } from '../domain/day';
import {
  goalProgress,
  type GoalProgress,
  type Goals,
  type GoalSuggestion,
  type GoalKey,
  suggestGoals,
  SUGGESTION_WEEKS,
  type WeekFacts,
} from '../domain/goals';
import { streakFrozenDay } from './streakFreeze';
import {
  activityTotals,
  buildWeeklySummary,
  countLearned,
  GROUP_FALLBACK_DAYS,
  mondayOf,
  noteLearnedDays,
  reportWeekFor,
} from '../domain/weeklyReport';
import type {
  CefrLevel,
  Millis,
  ReportDraft,
  Settings,
  WeeklyReport,
  WeeklyReportSummary,
} from '../domain/types';
import { db } from './db';
import { listDailyActivity } from './dailyActivity';
import { computeWorkload, getWorkloadInput } from './load';
import { getCurrentUserId, getMeta, setMeta } from './meta';
import { loadRetentionInput } from './progress';
import { dayConfig, getSettings, updateSettings } from './settings';
import { writeTx } from './writer';

/** A draft waits at most this long for its comment; then the report is kept without one. */
export const REPORT_COMMENT_WAIT_MS = 7 * 24 * 60 * 60_000;
/** Failed comment requests before the report is kept without one. */
export const REPORT_MAX_ATTEMPTS = 4;

/** "Report of week X seen" (home note), per account on this device. */
export const reportSeenKey = (userId: string | null): string => `report_seen:${userId ?? 'guest'}`;

export type EnsureReportOutcome =
  | { status: 'exists'; week: DayKey }
  | { status: 'no_history'; week: DayKey }
  | { status: 'created'; week: DayKey; draft: ReportDraft };

/** The summary of one week (every number of the report), computed now. */
export async function computeWeeklySummary(
  week: DayKey,
  now: Millis = Date.now(),
): Promise<WeeklyReportSummary> {
  const settings = await getSettings(now);
  const cfg = dayConfig(settings);
  const [activity, retention, workloadInput, cards] = await Promise.all([
    listDailyActivity(),
    loadRetentionInput(now),
    getWorkloadInput(now),
    db.cards.filter((c) => c.deleted_at === null && !c.suspended).toArray(),
  ]);
  const advice = computeWorkload(workloadInput).advice;
  const live = new Set(retention.facts.keys());
  return buildWeeklySummary({
    week,
    from: dayStartMs(week, cfg),
    to: dayStartMs(addDays(week, 7), cfg),
    fallbackFrom: dayStartMs(addDays(week, 7 - GROUP_FALLBACK_DAYS), cfg),
    activity,
    data: retention.data,
    facts: retention.facts,
    isFrozenDay: streakFrozenDay(settings),
    goals: settings.goals ?? null,
    load: {
      overDay: advice.overDay,
      suggestedLimit: advice.suggestedLimit,
      currentLimit: settings.daily_new_limit,
    },
    newAvailable: workloadInput.newAvailable,
    cards: cards
      .filter((c) => live.has(c.id))
      .map((c) => ({ note_id: c.note_id, lapses: c.lapses })),
  });
}

/**
 * Make last week's report on the first open after Monday's day start. Does nothing when the
 * week has a report or a draft already, or when nothing was studied before the week ended
 * (a new account gets its first report a week after it starts). The report waits as a draft
 * for its comment (processReportDraft).
 */
export async function ensureWeeklyReport(now: Millis = Date.now()): Promise<EnsureReportOutcome> {
  const settings = await getSettings(now);
  const today = dayKeyOf(now, dayConfig(settings));
  const week = reportWeekFor(today);
  const weekEnd = addDays(week, 6);
  if (
    (await db.weekly_reports.where('week').equals(week).count()) > 0 ||
    (await db.report_drafts.get(week))
  )
    return { status: 'exists', week };
  const activity = await listDailyActivity();
  if (!activity.some((d) => d.date <= weekEnd && d.reviews > 0))
    return { status: 'no_history', week };

  const summary = await computeWeeklySummary(week, now);
  const draft = await writeTx([db.report_drafts, db.weekly_reports], now, async (w) => {
    // Another tab (or a pull) may have stored the week meanwhile.
    if ((await db.weekly_reports.where('week').equals(week).count()) > 0) return null;
    const existing = await db.report_drafts.get(week);
    if (existing) return existing;
    const d: ReportDraft = {
      week,
      report: {
        id: w.newId(),
        user_id: w.userId,
        week,
        summary,
        comment: null,
        comment_model: null,
        prompt_version: null,
        device_id: w.deviceId,
        created_at: now,
        hlc: w.nextHlc(),
      },
      attempts: 0,
      next_attempt_at: now,
      last_error: null,
    };
    await db.report_drafts.put(d);
    return d;
  });
  return draft ? { status: 'created', week, draft } : { status: 'exists', week };
}

/** Drafts whose comment may be asked for now, oldest week first. */
export async function dueReportDrafts(now: Millis = Date.now()): Promise<ReportDraft[]> {
  const all = await db.report_drafts.toArray();
  return all.filter((d) => d.next_attempt_at <= now).sort((a, b) => (a.week < b.week ? -1 : 1));
}

/** All drafts (the runner's timer looks at the earliest retry). */
export function listReportDrafts(): Promise<ReportDraft[]> {
  return db.report_drafts.toArray();
}

/**
 * Should this draft stop waiting for its comment? After REPORT_COMMENT_WAIT_MS, after
 * REPORT_MAX_ATTEMPTS failures, or once a newer week has a report or a draft.
 */
export async function draftExpired(d: ReportDraft, now: Millis = Date.now()): Promise<boolean> {
  if (now - d.report.created_at >= REPORT_COMMENT_WAIT_MS) return true;
  if (d.attempts >= REPORT_MAX_ATTEMPTS) return true;
  const newerReport = await db.weekly_reports.where('week').above(d.week).count();
  const newerDraft = await db.report_drafts.where('week').above(d.week).count();
  return newerReport + newerDraft > 0;
}

/**
 * Store a draft as the week's report, with its comment or without one. A report of the week
 * that arrived from another device meanwhile wins (one report per week); the draft goes.
 */
export async function finalizeReportDraft(
  week: DayKey,
  comment: { text: string; model: string | null; promptVersion: string } | null,
  now: Millis = Date.now(),
): Promise<WeeklyReport | null> {
  return writeTx([db.report_drafts, db.weekly_reports], now, async (w) => {
    const d = await db.report_drafts.get(week);
    if (!d) return null;
    await db.report_drafts.delete(week);
    if ((await db.weekly_reports.where('week').equals(week).count()) > 0) return null;
    const report: WeeklyReport = {
      ...d.report,
      user_id: w.userId,
      comment: comment?.text ?? null,
      comment_model: comment?.model ?? null,
      prompt_version: comment?.promptVersion ?? null,
      hlc: w.nextHlc(),
    };
    await w.insertWeeklyReport(report);
    return report;
  });
}

/** A failed comment request: try again at `nextAttemptAt`. */
export async function deferReportDraft(
  week: DayKey,
  error: string,
  nextAttemptAt: Millis,
  countAttempt = true,
): Promise<void> {
  await db.report_drafts
    .where('week')
    .equals(week)
    .modify((d) => {
      if (countAttempt) d.attempts += 1;
      d.last_error = error.slice(0, 100);
      d.next_attempt_at = nextAttemptAt;
    });
}

// ------------------------------------------------------------------ reading

export interface ReportListItem {
  week: DayKey;
  summary: WeeklyReportSummary;
  comment: string | null;
  /** The comment has not come yet (offline, signed out): it is added later. */
  pending: boolean;
}

/** Every report on this device (final ones and drafts), newest week first. */
export async function listWeeklyReports(): Promise<ReportListItem[]> {
  const [finals, drafts] = await Promise.all([
    db.weekly_reports.toArray(),
    db.report_drafts.toArray(),
  ]);
  const byWeek = new Map<DayKey, ReportListItem>();
  for (const d of drafts)
    byWeek.set(d.week, { week: d.week, summary: d.report.summary, comment: null, pending: true });
  for (const r of finals) {
    const prev = byWeek.get(r.week);
    // Two reports of a week only until the next pull; the one with a comment is shown.
    if (prev && !prev.pending && prev.comment) continue;
    byWeek.set(r.week, { week: r.week, summary: r.summary, comment: r.comment, pending: false });
  }
  return [...byWeek.values()].sort((a, b) => (a.week < b.week ? 1 : -1));
}

/** The week the latest report is about, and whether this account has seen it here. */
export async function getReportNotice(now: Millis = Date.now()): Promise<{ week: DayKey } | null> {
  const settings = await getSettings(now);
  const week = reportWeekFor(dayKeyOf(now, dayConfig(settings)));
  const has =
    (await db.weekly_reports.where('week').equals(week).count()) > 0 ||
    (await db.report_drafts.get(week));
  if (!has) return null;
  const seen = await getMeta<string>(reportSeenKey(await getCurrentUserId()));
  return seen === week ? null : { week };
}

export async function markReportSeen(week: DayKey): Promise<void> {
  await setMeta(reportSeenKey(await getCurrentUserId()), week);
}

// ------------------------------------------------------------------ goals

export interface GoalsView {
  goals: Goals;
  /** Progress this week (days, minutes) and this month (new words), goals that are set. */
  progress: GoalProgress[];
  suggestions: Record<GoalKey, GoalSuggestion>;
  /** The user's current level (the dialog offers target levels above it). */
  level: CefrLevel;
}

/** Facts of the SUGGESTION_WEEKS complete weeks before the current one, oldest first. */
export function pastWeekFacts(
  activity: Parameters<typeof activityTotals>[0],
  learned: ReadonlyMap<string, DayKey>,
  today: DayKey,
): WeekFacts[] {
  const monday = mondayOf(today);
  const out: WeekFacts[] = [];
  for (let i = SUGGESTION_WEEKS; i >= 1; i--) {
    const from = addDays(monday, -7 * i);
    const to = addDays(from, 6);
    const t = activityTotals(activity, from, to);
    out.push({
      active_days: t.active_days,
      minutes: t.minutes,
      learned: countLearned(learned, from, to),
    });
  }
  return out;
}

export async function getGoalsView(now: Millis = Date.now()): Promise<GoalsView> {
  const settings: Settings = await getSettings(now);
  const [activity, retention] = await Promise.all([listDailyActivity(), loadRetentionInput(now)]);
  const today = retention.today;
  const learned = noteLearnedDays(retention.data, retention.facts);
  const week = activityTotals(activity, mondayOf(today), today);
  const goals = settings.goals ?? {};
  return {
    goals,
    progress: goalProgress(goals, {
      weekActiveDays: week.active_days,
      weekMinutes: week.minutes,
      monthLearned: countLearned(learned, `${today.slice(0, 7)}-01`, today),
    }),
    suggestions: suggestGoals(pastWeekFacts(activity, learned, today)),
    level: settings.level,
  };
}

/** Set the goals (null or empty = none). */
export async function setGoals(goals: Goals | null, now: Millis = Date.now()): Promise<Settings> {
  const clean = goals
    ? Object.fromEntries(
        Object.entries(goals).filter(([, v]) => typeof v === 'number' || typeof v === 'string'),
      )
    : {};
  return updateSettings({ goals: Object.keys(clean).length ? clean : null }, now);
}

/**
 * Change some goals and keep the others (null clears one). For editors that show only part
 * of the goals, e.g. the redesign's daily minutes and target level.
 */
export async function updateGoals(patch: Goals, now: Millis = Date.now()): Promise<Settings> {
  const current = (await getSettings(now)).goals ?? {};
  return setGoals({ ...current, ...patch }, now);
}
