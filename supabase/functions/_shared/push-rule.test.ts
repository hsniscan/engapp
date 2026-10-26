// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  clampNotifyHour,
  decidePush,
  dueMessage,
  estimateMinutes,
  parseNotify,
  parseVacation,
  pushSlot,
  userDayBounds,
  userDayKey,
  type PushCandidate,
} from './push-rule.ts';

const IST = 'Europe/Istanbul'; // UTC+3 all year
/** Instant of a wall-clock time in Istanbul. */
const ist = (day: string, hour: number, minute = 0) =>
  Date.parse(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+03:00`);

function cand(over: Partial<PushCandidate> = {}): PushCandidate {
  return {
    timezone: IST,
    day_start_hour: 4,
    notify: { enabled: true, mode: 'auto', hour: 19 },
    vacation: null,
    last_review_at: null,
    last_push_day: null,
    ...over,
  };
}

describe('settings parsing', () => {
  it('reads notify defensively and keeps the hour inside 09–21', () => {
    expect(parseNotify(null)).toBeNull();
    expect(parseNotify('on')).toBeNull();
    expect(parseNotify({ mode: 'auto' })).toBeNull();
    expect(parseNotify({ enabled: true })).toEqual({ enabled: true, mode: 'auto', hour: null });
    expect(parseNotify({ enabled: true, mode: 'fixed', hour: 23 })).toEqual({
      enabled: true,
      mode: 'fixed',
      hour: 21,
    });
    expect(parseNotify({ enabled: false, mode: 'weird', hour: 3 })).toEqual({
      enabled: false,
      mode: 'auto',
      hour: 9,
    });
    expect(clampNotifyHour(22)).toBe(21);
    expect(clampNotifyHour(8.6)).toBe(9);
    expect(clampNotifyHour(Number.NaN)).toBe(19);
  });

  it('reads the vacation range only when well formed', () => {
    expect(parseVacation({ start: '2026-10-20', end: '2026-10-25' })).toEqual({
      start: '2026-10-20',
      end: '2026-10-25',
    });
    expect(parseVacation({ start: '2026-10-20' })).toBeNull();
    expect(parseVacation({ start: '2026-10-25', end: '2026-10-20' })).toBeNull();
    expect(parseVacation({ start: 'yarın', end: '2026-10-20' })).toBeNull();
    expect(parseVacation([1])).toBeNull();
    expect(parseVacation(undefined)).toBeNull();
  });
});

describe('user day', () => {
  it('starts at day_start_hour local time', () => {
    expect(userDayKey(ist('2026-10-23', 3, 59), IST, 4)).toBe('2026-10-22');
    expect(userDayKey(ist('2026-10-23', 4), IST, 4)).toBe('2026-10-23');
    const b = userDayBounds(ist('2026-10-23', 20), IST, 4);
    expect(b).toEqual({
      day: '2026-10-23',
      start: ist('2026-10-23', 4),
      end: ist('2026-10-24', 4),
    });
  });

  it('handles a DST day (Berlin, 25 hours)', () => {
    const t = Date.parse('2026-10-25T12:00:00+01:00');
    const b = userDayBounds(t, 'Europe/Berlin', 4);
    expect(b.day).toBe('2026-10-25');
    expect(b.start).toBe(Date.parse('2026-10-25T04:00:00+01:00'));
    expect(b.end).toBe(Date.parse('2026-10-26T04:00:00+01:00'));
  });
});

describe('send decision (acceptance criterion 7)', () => {
  const day = '2026-10-23';

  it('sends at the chosen hour when nothing was reviewed today and reviews are due', () => {
    const d = decidePush(cand(), ist(day, 19, 15), 23, 15);
    expect(d).toEqual({
      send: true,
      day,
      message: {
        title: 'Engapp',
        body: 'Bugün 23 kart tekrara hazır, yaklaşık 6 dk.',
        url: '/study',
        tag: 'engapp-due',
      },
    });
  });

  it('waits for the hour, and still sends later in the evening if a run was missed', () => {
    expect(decidePush(cand(), ist(day, 18, 45), 5, null)).toEqual({
      send: false,
      reason: 'before_hour',
    });
    expect(decidePush(cand(), ist(day, 21, 45), 5, null).send).toBe(true);
  });

  it('never sends between 22:00 and 09:00 local time', () => {
    const early = cand({ notify: { enabled: true, mode: 'fixed', hour: 9 } });
    for (const h of [22, 23, 0, 3, 8]) {
      const t = h < 9 ? ist('2026-10-24', h, 30) : ist(day, h, 30);
      expect(decidePush(early, t, 40, null)).toEqual({ send: false, reason: 'quiet_hours' });
    }
    expect(decidePush(early, ist(day, 9), 40, null).send).toBe(true);
    // A stored hour of 22 or more is read as 21, so the window is never empty.
    expect(
      decidePush(
        cand({ notify: { enabled: true, mode: 'fixed', hour: 22 } }),
        ist(day, 21),
        4,
        null,
      ).send,
    ).toBe(true);
  });

  it('does not send when the user already reviewed today (user day, not calendar day)', () => {
    expect(decidePush(cand({ last_review_at: ist(day, 4, 30) }), ist(day, 19), 9, null)).toEqual({
      send: false,
      reason: 'reviewed_today',
    });
    // A review at 03:00 belongs to yesterday's user day.
    expect(decidePush(cand({ last_review_at: ist(day, 3) }), ist(day, 19), 9, null).send).toBe(
      true,
    );
  });

  it('does not send when nothing is due', () => {
    expect(decidePush(cand(), ist(day, 19), 0, null)).toEqual({
      send: false,
      reason: 'nothing_due',
    });
  });

  it('sends at most once per user day', () => {
    expect(decidePush(cand({ last_push_day: day }), ist(day, 20), 9, null)).toEqual({
      send: false,
      reason: 'already_sent',
    });
    expect(decidePush(cand({ last_push_day: '2026-10-22' }), ist(day, 20), 9, null).send).toBe(
      true,
    );
  });

  it('does not send on vacation (inclusive range), and ignores a malformed vacation', () => {
    const vac = { start: '2026-10-21', end: day };
    expect(decidePush(cand({ vacation: vac }), ist(day, 20), 9, null)).toEqual({
      send: false,
      reason: 'vacation',
    });
    expect(decidePush(cand({ vacation: vac }), ist('2026-10-24', 20), 9, null).send).toBe(true);
    expect(decidePush(cand({ vacation: { start: 'x' } }), ist(day, 20), 9, null).send).toBe(true);
  });

  it('does not send when turned off or never set', () => {
    expect(
      decidePush(
        cand({ notify: { enabled: false, mode: 'auto', hour: 19 } }),
        ist(day, 20),
        9,
        null,
      ).send,
    ).toBe(false);
    expect(decidePush(cand({ notify: null }), ist(day, 20), 9, null)).toEqual({
      send: false,
      reason: 'disabled',
    });
  });

  it('uses the user time zone, and UTC for an unknown one', () => {
    const tokyo = cand({ timezone: 'Asia/Tokyo' });
    expect(decidePush(tokyo, Date.parse('2026-10-23T19:10:00+09:00'), 3, null).send).toBe(true);
    expect(decidePush(tokyo, Date.parse('2026-10-23T19:10:00+03:00'), 3, null)).toEqual({
      send: false,
      reason: 'quiet_hours',
    });
    expect(
      decidePush(cand({ timezone: 'Mars/Olympus' }), Date.parse('2026-10-23T19:10:00Z'), 3, null)
        .send,
    ).toBe(true);
  });

  it('gives the slot with the end of the user day for the due count', () => {
    expect(pushSlot(cand(), ist(day, 19))).toEqual({ ok: true, day, dayEnd: ist('2026-10-24', 4) });
  });
});

describe('message', () => {
  it('is built from counts only', () => {
    expect(dueMessage(1, null).body).toBe('Bugün 1 kart tekrara hazır, yaklaşık 1 dk.');
    expect(dueMessage(120, 10).body).toBe('Bugün 120 kart tekrara hazır, yaklaşık 20 dk.');
    expect(estimateMinutes(23, 15)).toBe(6);
    expect(estimateMinutes(10, 1000)).toBe(10); // a pace above 60 s per card is capped
    expect(estimateMinutes(2, null)).toBe(1);
  });
});
