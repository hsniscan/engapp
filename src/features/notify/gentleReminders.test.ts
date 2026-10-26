// Gentle reminders (v0.5 İP10, docs/decisions/0052): the reminder copy on every path is calm
// (no guilt, no pressure, no mascot), and there is at most one reminder a day on both paths,
// the reminder that asks a card included.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dueMessage, TEST_MESSAGE } from '../../../supabase/functions/_shared/push-rule';
import type { ReminderFacts } from '@/data/reminder';
import { defaultSettings } from '@/data/settings';
import { onePerDay } from '@/domain/reminderSchedule';
import tr from '@/i18n/tr.json';
import en from '@/i18n/en.json';
import {
  enableReminder,
  planFromFacts,
  readReminderState,
  rescheduleReminder,
  resetReminderStateForTesting,
  type NotifierPort,
  type ScheduledNotification,
} from './nativeReminder';

// Guilt, pressure and mascot phrasing that must never reach a reminder or the streak note.
const GUILT_TR = /üzül|üzgün|kaybed|kaybet|kaçırma|kaçırdın|bozulacak|bozuldu|tehlike|hayal kırıklığı|özledi|seni bekliyor|unutma|son şans|ayıp|tembel|hemen|acele|!/i;
const GUILT_EN = /\b(sad|miss(ed)? you|lose|losing|lost|danger|disappoint\w*|don't forget|last chance|hurry|lazy|waiting for you)\b|!/i;

function strings(o: unknown): string[] {
  if (typeof o === 'string') return [o];
  if (o && typeof o === 'object') return Object.values(o).flatMap(strings);
  return [];
}

describe('reminder copy', () => {
  it('the push / local reminder text is calm, plain and from numbers only', () => {
    for (const due of [1, 2, 12, 120, 999]) {
      const m = dueMessage(due, 9);
      expect(m.body).not.toMatch(GUILT_TR);
      expect(m.title).toBe('Engapp');
      expect(m.body).toMatch(new RegExp(`^Bugün ${due} kart tekrara hazır, yaklaşık \\d+ dk\\.$`));
    }
    expect(TEST_MESSAGE.body).not.toMatch(GUILT_TR);
  });

  it('notification, reminder and streak strings in the app carry no guilt either', () => {
    const trTexts = [
      ...strings(tr.native.reminders),
      ...strings(tr.widget.notify),
      ...strings(tr.settings.notify),
      ...strings(tr.smart),
    ];
    const enTexts = [...strings(en.native.reminders), ...strings(en.widget.notify), ...strings(en.settings.notify), ...strings(en.smart)];
    expect(trTexts.length).toBeGreaterThan(20);
    for (const s of trTexts) expect(s, s).not.toMatch(GUILT_TR);
    for (const s of enTexts) expect(s, s).not.toMatch(GUILT_EN);
  });
});

describe('onePerDay', () => {
  it('keeps the first reminder of each day and none on the day one was shown', () => {
    const plans = [
      { day: '2026-10-20', at: 1 },
      { day: '2026-10-20', at: 2 },
      { day: '2026-10-21', at: 3 },
      { day: '2026-10-22', at: 4 },
    ];
    expect(onePerDay(plans, null).map((p) => p.at)).toEqual([1, 3, 4]);
    expect(onePerDay(plans, '2026-10-20').map((p) => p.at)).toEqual([3, 4]);
  });
});

// Istanbul (UTC+3): 10:00 local on Tue 20 Oct 2026.
const NOW = Date.UTC(2026, 9, 20, 7);
const H = 3_600_000;
const D = 86_400_000;

function facts(over: Partial<ReminderFacts> = {}): ReminderFacts {
  return {
    settings: {
      ...defaultSettings(NOW),
      timezone: 'Europe/Istanbul',
      day_start_hour: 4,
      notify: { enabled: false, mode: 'fixed', hour: 19 },
      vacation: null,
    },
    lastReviewAt: null,
    // Reviews due every day for a month.
    dueTimes: Array.from({ length: 31 }, (_, i) => NOW - D + i * D),
    secPerCard: 10,
    ...over,
  };
}

function fakePort() {
  const scheduled: ScheduledNotification[] = [];
  const port: NotifierPort & { scheduled: ScheduledNotification[] } = {
    scheduled,
    checkPermission: vi.fn(async () => 'granted' as const),
    requestPermission: vi.fn(async () => 'granted' as const),
    ensureChannel: vi.fn(async () => {}),
    schedule: vi.fn(async (list: ScheduledNotification[]) => {
      scheduled.splice(0, scheduled.length, ...list);
    }),
    cancel: vi.fn(async () => {}),
    clearShown: vi.fn(async () => {}),
  };
  return port;
}

const localDay = (at: number) => new Date(at + 3 * H - 4 * H).toISOString().slice(0, 10);

describe('one reminder a day on the phone, the card question included', () => {
  beforeEach(() => resetReminderStateForTesting());

  it('every planned reminder (all asking a card) falls on its own day', async () => {
    const port = fakePort();
    const card = { card_id: 'c1', term: 'cope', meaning: 'başa çıkmak' };
    await enableReminder({
      port,
      facts: async () => facts(),
      cards: async (ats) => ats.map(() => card),
      now: () => NOW,
      userId: null,
      cleanWebPush: async () => 0,
    });
    expect(port.scheduled.length).toBeGreaterThan(3);
    expect(port.scheduled.every((n) => n.card?.card_id === 'c1')).toBe(true);
    const days = port.scheduled.map((n) => localDay(n.at));
    expect(new Set(days).size).toBe(days.length);
  });

  it('after today’s reminder was shown, nothing more comes today', async () => {
    const port = fakePort();
    const deps = { port, facts: async () => facts(), cards: async (ats: number[]) => ats.map(() => null), userId: null, cleanWebPush: async () => 0 };
    await enableReminder({ ...deps, now: () => NOW });
    const first = port.scheduled[0]!;
    expect(localDay(first.at)).toBe('2026-10-20');
    // The app opens again after it was shown (19:00 passed): today is used up.
    const later = first.at + H;
    await rescheduleReminder({ ...deps, now: () => later });
    expect(readReminderState().lastShownDay).toBe('2026-10-20');
    expect(port.scheduled.map((n) => localDay(n.at))).not.toContain('2026-10-20');
    expect(planFromFacts(facts(), readReminderState(), later).map((p) => p.day)).not.toContain('2026-10-20');
  });
});
