// Streak freeze ("Seri koruması", v0.5 İP10, docs/decisions/0052-smart-review.md). Pure.
//
// The streak counts days with at least one answer (domain/streak.ts isActive; separate from the
// daily goal). Two protections per calendar month cover a missed day automatically: when the
// app opens after a gap, every missed day since the last active day is covered if the months'
// allowances can cover all of them; otherwise the streak ends as before and nothing is spent.
//
// Stored as the list of covered days in the synced settings row (settings.streak_freezes), so
// every device of the account counts the same protections and another account never sees
// them (settings never move between accounts). Vacation days never consume a protection: they
// are neutral for the streak on their own (domain/vacation.ts). A covered day that turns out
// active after all (answers from another device synced late) or that later lies inside a
// vacation does not count as used: a protection is only used by a day that needs it.
import { addDays, type DayKey, diffDays } from './day';

/** Protections per calendar month. */
export const FREEZES_PER_MONTH = 2;
/** Covered days kept in settings (newest); about two years. Same bound as the server check. */
export const MAX_FREEZE_DAYS = 48;
/** How far back the last active day is looked for (a longer gap has nothing to save anyway). */
const LOOKBACK_DAYS = 62;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM" of a day. */
export const monthOf = (day: DayKey): string => day.slice(0, 7);

/** settings.streak_freezes as stored (any JSON): valid unique day keys, ascending. */
export function parseFreezeDays(raw: unknown): DayKey[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((d): d is string => typeof d === 'string' && DAY_RE.test(d)))].sort();
}

export interface FreezeFacts {
  /** Days with at least one answer. */
  active: ReadonlySet<DayKey>;
  /** Vacation days (current and earlier vacations). */
  isVacationDay: (day: DayKey) => boolean;
  /** Days covered so far (settings.streak_freezes). */
  freezeDays: readonly DayKey[];
  today: DayKey;
}

/** Covered days that use a protection: not active and not a vacation day. */
export function usedFreezeDays(f: Omit<FreezeFacts, 'today'>): DayKey[] {
  return parseFreezeDays(f.freezeDays).filter((d) => !f.active.has(d) && !f.isVacationDay(d));
}

/** Protections still free in a month. */
export function freezesLeftIn(used: readonly DayKey[], month: string): number {
  return Math.max(0, FREEZES_PER_MONTH - used.filter((d) => monthOf(d) === month).length);
}

/** Frozen for the streak: a vacation day or a covered day (neither breaks nor extends it). */
export function frozenDayRule(f: Pick<FreezeFacts, 'isVacationDay' | 'freezeDays'>): (day: DayKey) => boolean {
  const covered = new Set(parseFreezeDays(f.freezeDays));
  return (day) => f.isVacationDay(day) || covered.has(day);
}

/**
 * Days to cover now: the missed days between the last active day and today (today itself is
 * never missed yet), skipping vacation days and days covered already. All of them or none:
 * when a month's allowance cannot cover its missed days the streak ends and nothing is spent.
 * Nothing either when there is no active day before the gap (no streak to keep).
 * Deterministic; the result is ascending.
 */
export function planFreezes(f: FreezeFacts): DayKey[] {
  const covered = new Set(parseFreezeDays(f.freezeDays));
  const missed: DayKey[] = [];
  let found = false;
  for (let i = 1; i <= LOOKBACK_DAYS; i++) {
    const day = addDays(f.today, -i);
    if (f.active.has(day)) {
      found = true;
      break;
    }
    if (f.isVacationDay(day) || covered.has(day)) continue;
    missed.push(day);
  }
  if (!found || missed.length === 0) return [];
  const used = usedFreezeDays(f);
  const need = new Map<string, number>();
  for (const d of missed) need.set(monthOf(d), (need.get(monthOf(d)) ?? 0) + 1);
  for (const [month, n] of need) if (n > freezesLeftIn(used, month)) return [];
  return missed.sort();
}

/** The stored list after covering `added`: unique, ascending, the newest MAX_FREEZE_DAYS. */
export function withFreezeDays(existing: unknown, added: readonly DayKey[]): DayKey[] {
  return parseFreezeDays([...parseFreezeDays(existing), ...added]).slice(-MAX_FREEZE_DAYS);
}

export interface FreezeNote {
  /** Days the latest gap's protections covered (the last of them is yesterday). */
  covered: number;
  /** Protections left this month. */
  left: number;
  /** The covered day the note is about (to remember it was seen). */
  day: DayKey;
}

/**
 * The calm note on Bugün: shown on the day after a protection covered a missed day (the gap
 * ended yesterday), until the user closes it. null otherwise.
 */
export function freezeNote(f: FreezeFacts, seenDay: DayKey | null): FreezeNote | null {
  const used = usedFreezeDays(f);
  const yesterday = addDays(f.today, -1);
  if (!used.includes(yesterday) || seenDay === yesterday) return null;
  const set = new Set(used);
  let covered = 0;
  for (let d = yesterday; set.has(d) || f.isVacationDay(d); d = addDays(d, -1)) {
    if (set.has(d)) covered++;
    if (diffDays(d, f.today) > LOOKBACK_DAYS) break;
  }
  return { covered, left: freezesLeftIn(used, monthOf(f.today)), day: yesterday };
}
