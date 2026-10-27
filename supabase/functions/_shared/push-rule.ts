// Smart notification rule (v0.3 İP8, docs/decisions/0024-web-push.md). Pure TypeScript,
// shared by the push-send edge function and the web client (src/domain/notify.ts re-exports
// it), so the settings screen explains exactly what the server does.
//
// A user gets at most one reminder per user-day, and only when all of these hold:
//   - notifications are on (settings.notify.enabled) and the device has a subscription;
//   - local wall-clock time is inside 09:00–22:00 and at or after the chosen hour;
//   - no review was answered on the user's current day (timezone + day_start_hour);
//   - the day is not inside settings.vacation (optional, written by the load-management
//     package; read defensively);
//   - at least one review is due before the end of the user's day (counted on the server
//     from the synced cards);
//   - no reminder was sent on this user-day yet (push_log).
// The text is built from counts only, never from the user's words.

/** Wall-clock hours with no notifications: from 22:00 to 09:00 local time. */
export const QUIET_FROM_HOUR = 22;
export const QUIET_UNTIL_HOUR = 9;
/** Hours a reminder can be set to (the last full hour before the quiet hours). */
export const FIRST_NOTIFY_HOUR = QUIET_UNTIL_HOUR;
export const LAST_NOTIFY_HOUR = QUIET_FROM_HOUR - 1;
/** Hour used before there is any review history ("auto" with no data). */
export const DEFAULT_NOTIFY_HOUR = 19;
/** Pace before there is any history (seconds per review). */
export const DEFAULT_SEC_PER_CARD = 10;

export type NotifyMode = 'auto' | 'fixed';

export interface NotifyPref {
  enabled: boolean;
  mode: NotifyMode;
  /** Resolved local hour (auto: computed on the device; fixed: chosen). null = default. */
  hour: number | null;
}

/** Keeps an hour inside 09–21 (a reminder at 22:00 would fall into the quiet hours). */
export function clampNotifyHour(hour: number): number {
  if (!Number.isFinite(hour)) return DEFAULT_NOTIFY_HOUR;
  return Math.min(LAST_NOTIFY_HOUR, Math.max(FIRST_NOTIFY_HOUR, Math.round(hour)));
}

/** settings.notify as stored (any JSON); null when absent or unusable. */
export function parseNotify(raw: unknown): NotifyPref | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.enabled !== 'boolean') return null;
  const mode: NotifyMode = r.mode === 'fixed' ? 'fixed' : 'auto';
  const hour =
    typeof r.hour === 'number' && Number.isFinite(r.hour) ? clampNotifyHour(r.hour) : null;
  return { enabled: r.enabled, mode, hour };
}

/** The hour a reminder goes out at. */
export function notifyHour(pref: NotifyPref): number {
  return pref.hour ?? DEFAULT_NOTIFY_HOUR;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface VacationRange {
  start: string; // YYYY-MM-DD, inclusive
  end: string; // YYYY-MM-DD, inclusive
}

/** settings.vacation = {start, end} day strings; null when absent or malformed. */
export function parseVacation(raw: unknown): VacationRange | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.start !== 'string' || !DAY_RE.test(r.start)) return null;
  const end = typeof r.end === 'string' && DAY_RE.test(r.end) ? r.end : null;
  if (!end || end < r.start) return null;
  return { start: r.start, end };
}

export function onVacation(day: string, raw: unknown): boolean {
  const v = parseVacation(raw);
  return !!v && v.start <= day && day <= v.end;
}

// ------------------------------------------------------------------ local time
// A copy of the few src/domain/day.ts operations the server needs (the edge functions cannot
// import from src/). push-rule.test.ts checks that both give the same answers.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** A usable IANA zone (falls back to UTC for unknown names). */
export function safeTimeZone(tz: unknown): string {
  if (typeof tz !== 'string' || !tz) return 'UTC';
  try {
    formatter(tz);
    return tz;
  } catch {
    return 'UTC';
  }
}

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wall(ms: number, tz: string): Wall {
  const parts = formatter(tz).formatToParts(new Date(ms));
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function offsetMs(ms: number, tz: string): number {
  const w = wall(ms, tz);
  return (
    Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) -
    (ms - (((ms % 1000) + 1000) % 1000))
  );
}

function addDaysKey(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86_400_000);
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Local wall-clock hour (0–23) at `ms`. */
export function localHour(ms: number, tz: string): number {
  return wall(ms, tz).hour;
}

/** The user's day (YYYY-MM-DD) an instant belongs to; days start at `dayStartHour`. */
export function userDayKey(ms: number, tz: string, dayStartHour: number): string {
  const w = wall(ms, tz);
  const key = `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
  return w.hour < dayStartHour ? addDaysKey(key, -1) : key;
}

/** First instant of a local wall-clock hour on a calendar day (DST gaps resolve forward). */
function zonedToUtc(key: string, hour: number, tz: string): number {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const target = Date.UTC(y, m - 1, d, hour);
  const t1 = target - offsetMs(target, tz);
  const t2 = target - offsetMs(t1, tz);
  const hits = [
    t1,
    t2,
    target - offsetMs(target - 43_200_000, tz),
    target - offsetMs(target + 43_200_000, tz),
  ].filter((t) => {
    const w = wall(t, tz);
    return w.year === y && w.month === m && w.day === d && w.hour === hour;
  });
  if (hits.length) return Math.min(...hits);
  return Math.max(t1, t2); // inside a DST gap: the first instant after it
}

/** Start and exclusive end of the user's day that contains `ms`. */
export function userDayBounds(
  ms: number,
  tz: string,
  dayStartHour: number,
): { day: string; start: number; end: number } {
  const day = userDayKey(ms, tz, dayStartHour);
  return {
    day,
    start: zonedToUtc(day, dayStartHour, tz),
    end: zonedToUtc(addDaysKey(day, 1), dayStartHour, tz),
  };
}

// ------------------------------------------------------------------ the decision

/** What the server knows about one user when the scheduled job runs. */
export interface PushCandidate {
  timezone: unknown;
  day_start_hour: unknown;
  notify: unknown;
  vacation?: unknown;
  /** Latest answered review (epoch ms), null when none. */
  last_review_at: number | null;
  /** User-day of the last reminder sent, null when none. */
  last_push_day: string | null;
}

export type SkipReason =
  | 'disabled'
  | 'quiet_hours'
  | 'before_hour'
  | 'reviewed_today'
  | 'vacation'
  | 'already_sent'
  | 'nothing_due';

export type SlotDecision =
  { ok: true; day: string; dayEnd: number } | { ok: false; reason: SkipReason };

function dayStartHourOf(raw: unknown): number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 23 ? raw : 4;
}

/**
 * Everything but the due count: is a reminder for this user possible right now? On `ok` the
 * caller counts the reviews due before `dayEnd` and calls `decidePush`.
 */
export function pushSlot(c: PushCandidate, now: number): SlotDecision {
  const pref = parseNotify(c.notify);
  if (!pref?.enabled) return { ok: false, reason: 'disabled' };
  const tz = safeTimeZone(c.timezone);
  const hour = localHour(now, tz);
  if (hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR)
    return { ok: false, reason: 'quiet_hours' };
  if (hour < notifyHour(pref)) return { ok: false, reason: 'before_hour' };
  const { day, start, end } = userDayBounds(now, tz, dayStartHourOf(c.day_start_hour));
  if (c.last_push_day === day) return { ok: false, reason: 'already_sent' };
  if (onVacation(day, c.vacation)) return { ok: false, reason: 'vacation' };
  if (c.last_review_at !== null && c.last_review_at >= start)
    return { ok: false, reason: 'reviewed_today' };
  return { ok: true, day, dayEnd: end };
}

export interface PushMessage {
  title: string;
  body: string;
  /** Opened when the notification is tapped. */
  url: string;
  /** A newer reminder replaces an older one on the device. */
  tag: string;
}

/** Minutes for `due` reviews at `secPerCard` seconds each (at least 1). */
export function estimateMinutes(due: number, secPerCard: number | null): number {
  const sec =
    secPerCard && Number.isFinite(secPerCard)
      ? Math.min(60, Math.max(3, secPerCard))
      : DEFAULT_SEC_PER_CARD;
  return Math.max(1, Math.round((due * sec) / 60));
}

/**
 * Notification texts. They are built on the server (the app may be closed), from numbers
 * only; Turkish is the app's language. Not UI strings of the web app (those live in i18n).
 *
 * Calm and plain (v0.5 İP10, docs/decisions/0052): what is ready and how long it takes, no
 * pressure, no guilt, no mascot ("seni bekliyor", "serin bozulacak", "üzüldük" are out;
 * push-rule.test.ts keeps it so).
 */
export function dueMessage(due: number, secPerCard: number | null): PushMessage {
  return {
    title: 'Engapp',
    body: `Bugün ${due} kart çalışmaya hazır, yaklaşık ${estimateMinutes(due, secPerCard)} dk.`,
    // The study picker with every mode (v0.5.1), not only Kelime çalışma.
    url: '/study',
    tag: 'engapp-due',
  };
}

export const TEST_MESSAGE: PushMessage = {
  title: 'Engapp',
  body: 'Bildirimler çalışıyor. Çalışma zamanı gelince sana buradan haber vereceğim.',
  url: '/study',
  tag: 'engapp-test',
};

export type PushDecision =
  { send: true; day: string; message: PushMessage } | { send: false; reason: SkipReason };

/** The full rule: the slot check plus the due count from the synced cards. */
export function decidePush(
  c: PushCandidate,
  now: number,
  due: number,
  secPerCard: number | null,
): PushDecision {
  const slot = pushSlot(c, now);
  if (!slot.ok) return { send: false, reason: slot.reason };
  if (!(due > 0)) return { send: false, reason: 'nothing_due' };
  return { send: true, day: slot.day, message: dueMessage(due, secPerCard) };
}
