// Read-only view models for the home dashboard and the end-of-session summary.
// Everything comes from indexed reads and the daily_activity cache, so it is safe (and
// fast) inside useLiveQuery.
import Dexie from 'dexie';
import { db, getHeatmap, getHomeSummary, getSettings, type HomeSummary } from '@/data';
import {
  addDays,
  type DayConfig,
  dayBounds,
  dayKeyOf,
  type DayKey,
  dayEndMs,
  isValidTimeZone,
} from '@/domain/day';
import type { HeatmapCell } from '@/domain/streak';
import { type Card, CardState, type Millis, type Settings } from '@/domain/types';

const STUDIED_STATES = [CardState.Learning, CardState.Review, CardState.Relearning] as const;
/** Fallback pace before there is any history. */
const DEFAULT_MS_PER_CARD = 10_000;

export function cfgOf(s: Pick<Settings, 'timezone' | 'day_start_hour'>): DayConfig {
  return {
    timezone: isValidTimeZone(s.timezone) ? s.timezone : 'UTC',
    day_start_hour: s.day_start_hour,
  };
}

const studiable = (c: Card) => c.deleted_at === null && !c.suspended && c.unlocked;

/** When the next card is waiting, once today's queue is empty. */
export type NextDue =
  | { kind: 'later'; at: Millis }
  | { kind: 'tomorrow'; count: number }
  | { kind: 'date'; day: DayKey }
  | { kind: 'none' };

export interface ForecastDay {
  date: DayKey;
  count: number;
  today: boolean;
}

/** Studied cards due before `until`, through the [state+due] index. */
async function studiedDueBefore(until: Millis): Promise<Card[]> {
  const parts = await Promise.all(
    STUDIED_STATES.map((s) =>
      db.cards.where('[state+due]').between([s, Dexie.minKey], [s, until], true, false).toArray(),
    ),
  );
  return parts.flat().filter(studiable);
}

async function nextDueFrom(
  now: Millis,
  cfg: DayConfig,
  settings: Settings,
  soon: Card[],
): Promise<NextDue> {
  const today = dayBounds(now, cfg);
  let later: Millis | null = null;
  for (const c of soon) {
    const learning = c.state === CardState.Learning || c.state === CardState.Relearning;
    if (learning && c.due > now && c.due < today.end && (later === null || c.due < later))
      later = c.due;
  }
  if (later !== null) return { kind: 'later', at: later };

  const tomorrowEnd = dayEndMs(addDays(today.key, 1), cfg);
  const dueTomorrow = soon.filter((c) => c.due < tomorrowEnd).length;
  const fresh = await db.cards
    .where('[state+due]')
    .between([CardState.New, Dexie.minKey], [CardState.New, Dexie.maxKey])
    .filter(studiable)
    .count();
  const count = dueTomorrow + Math.min(fresh, settings.daily_new_limit);
  if (count > 0) return { kind: 'tomorrow', count };

  let first: Millis | null = null;
  for (const s of STUDIED_STATES) {
    const c = await db.cards
      .where('[state+due]')
      .between([s, Dexie.minKey], [s, Dexie.maxKey])
      .filter(studiable)
      .first();
    if (c && (first === null || c.due < first)) first = c.due;
  }
  return first === null ? { kind: 'none' } : { kind: 'date', day: dayKeyOf(first, cfg) };
}

export async function getNextDue(now: Millis = Date.now()): Promise<NextDue> {
  const settings = await getSettings(now);
  const cfg = cfgOf(settings);
  const until = dayEndMs(addDays(dayKeyOf(now, cfg), 1), cfg);
  return nextDueFrom(now, cfg, settings, await studiedDueBefore(until));
}

export interface RecentNote {
  id: string;
  term: string;
  meaning: string;
}

export interface HomeDashboard {
  summary: HomeSummary;
  hasCards: boolean;
  /** Last 14 local days, oldest first, ending today. */
  strip: HeatmapCell[];
  /** Today (incl. overdue) and the next 6 days: studied cards that fall due. */
  forecast: ForecastDay[];
  next: NextDue;
  /** Average answer time over the cached history. */
  msPerCard: number;
  recent: RecentNote[];
  timezone: string;
  now: Millis;
}

export async function getHomeDashboard(now: Millis = Date.now()): Promise<HomeDashboard> {
  const settings = await getSettings(now);
  const cfg = cfgOf(settings);
  const todayKey = dayKeyOf(now, cfg);
  const horizonEnd = dayEndMs(addDays(todayKey, 6), cfg);

  const [summary, heat, soon, activity, recentNotes] = await Promise.all([
    getHomeSummary(now),
    getHeatmap(now, 3),
    studiedDueBefore(horizonEnd),
    db.daily_activity.where('date').aboveOrEqual(addDays(todayKey, -29)).toArray(),
    // Ids are UUID v7, so id order is creation order.
    db.notes
      .orderBy('id')
      .reverse()
      .filter((n) => n.deleted_at === null)
      .limit(5)
      .toArray(),
  ]);

  const strip = heat
    .flat()
    .filter((c) => !c.future)
    .slice(-14);

  const forecast: ForecastDay[] = Array.from({ length: 7 }, (_, i) => ({
    date: addDays(todayKey, i),
    count: 0,
    today: i === 0,
  }));
  const index = new Map(forecast.map((d, i) => [d.date, i]));
  for (const c of soon) {
    const key = dayKeyOf(c.due, cfg);
    const i = key <= todayKey ? 0 : index.get(key);
    if (i !== undefined) forecast[i]!.count++;
  }
  // Today's bar shows what is still to do (the live queue), not what was already answered.
  forecast[0]!.count = summary.queue.total;

  let time = 0;
  let reviews = 0;
  for (const d of activity) {
    time += d.time_ms;
    reviews += d.reviews;
  }

  const senses = recentNotes.length
    ? await db.senses
        .where('note_id')
        .anyOf(recentNotes.map((n) => n.id))
        .toArray()
    : [];
  const recent = recentNotes.map((n) => ({
    id: n.id,
    term: n.term,
    meaning: senses
      .filter((s) => s.note_id === n.id && s.deleted_at === null)
      .sort((a, b) => a.sense_no - b.sense_no)
      .map((s) => s.meaning_tr_override ?? s.meaning_tr)
      .join(', '),
  }));

  return {
    summary,
    hasCards: recentNotes.length > 0,
    strip,
    forecast,
    next:
      summary.queue.total === 0 ? await nextDueFrom(now, cfg, settings, soon) : { kind: 'none' },
    msPerCard: reviews ? time / reviews : DEFAULT_MS_PER_CARD,
    recent,
    timezone: cfg.timezone,
    now,
  };
}
