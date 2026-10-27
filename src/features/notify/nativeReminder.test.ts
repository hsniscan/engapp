import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReminderFacts } from '@/data/reminder';
import { defaultSettings } from '@/data/settings';
import type { Settings } from '@/domain/types';
import {
  disableReminder,
  enableReminder,
  readReminderState,
  REMINDER_ID,
  rescheduleReminder,
  resetReminderStateForTesting,
  setAnswerCards,
  syncWebPushCleanup,
  type NotifierPort,
  type Permission,
  type ScheduledNotification,
} from './nativeReminder';

// Istanbul (UTC+3, no DST): 10:00 local on Tue 20 Oct 2026.
const NOW = Date.UTC(2026, 9, 20, 7);
const H = 3_600_000;
const D = 86_400_000;

function fakePort(perm: Permission = 'granted') {
  const scheduled: ScheduledNotification[] = [];
  const port: NotifierPort & { scheduled: ScheduledNotification[] } = {
    scheduled,
    checkPermission: vi.fn(async () => (perm === 'granted' ? 'granted' : 'prompt')),
    requestPermission: vi.fn(async () => perm),
    ensureChannel: vi.fn(async () => {}),
    schedule: vi.fn(async (list: ScheduledNotification[]) => {
      scheduled.push(...list);
    }),
    cancel: vi.fn(async () => {}),
    clearShown: vi.fn(async () => {}),
  };
  return port;
}

function facts(over: Partial<ReminderFacts> = {}, settings: Partial<Settings> = {}): ReminderFacts {
  return {
    settings: {
      ...defaultSettings(NOW),
      timezone: 'Europe/Istanbul',
      day_start_hour: 4,
      notify: { enabled: false, mode: 'fixed', hour: 19 },
      vacation: null,
      ...settings,
    },
    lastReviewAt: null,
    dueTimes: [NOW - D, NOW + 2 * H],
    secPerCard: 10,
    ...over,
  };
}

describe('native reminder', () => {
  beforeEach(() => resetReminderStateForTesting());

  it('turning on asks for permission, plans today 19:00 and removes the account’s Web Push', async () => {
    const port = fakePort('granted');
    const clean = vi.fn(async () => 2);
    const r = await enableReminder({
      port,
      userId: 'u1',
      cleanWebPush: clean,
      facts: async () => facts(),
      now: () => NOW,
    });
    expect(r).toEqual({ ok: true, webRemoved: 2, webFailed: false });
    expect(port.ensureChannel).toHaveBeenCalled();
    // Today and the following days (if the app is not opened), one a day.
    expect(port.scheduled.length).toBeGreaterThan(1);
    expect(port.scheduled[0]).toMatchObject({
      id: REMINDER_ID,
      at: Date.UTC(2026, 9, 20, 16),
      body: 'Bugün 2 kart çalışmaya hazır, yaklaşık 1 dk.',
      url: '/study',
    });
    expect(clean).toHaveBeenCalledWith('u1');
    expect(readReminderState()).toMatchObject({ enabled: true, webCleanedFor: 'u1' });
  });

  it('works for guests (no account, nothing to clean)', async () => {
    const clean = vi.fn(async () => 0);
    const r = await enableReminder({
      port: fakePort(),
      userId: null,
      cleanWebPush: clean,
      facts: async () => facts(),
      now: () => NOW,
    });
    expect(r.ok).toBe(true);
    expect(clean).not.toHaveBeenCalled();
  });

  it('stays off when Android 13+ permission is refused', async () => {
    const port = fakePort('denied');
    const r = await enableReminder({
      port,
      userId: 'u1',
      cleanWebPush: async () => 0,
      facts: async () => facts(),
      now: () => NOW,
    });
    expect(r).toEqual({ ok: false, reason: 'denied' });
    expect(readReminderState().enabled).toBe(false);
    expect(port.schedule).not.toHaveBeenCalled();
  });

  it('studying cancels today’s reminder and plans tomorrow', async () => {
    const port = fakePort();
    await enableReminder({
      port,
      userId: null,
      cleanWebPush: async () => 0,
      facts: async () => facts(),
      now: () => NOW,
    });
    const later = NOW + 2 * H;
    await rescheduleReminder({
      port,
      facts: async () => facts({ lastReviewAt: later - 1000 }),
      now: () => later,
    });
    expect(port.cancel).toHaveBeenLastCalledWith(expect.arrayContaining([REMINDER_ID]));
    expect(port.clearShown).toHaveBeenCalledWith(expect.arrayContaining([REMINDER_ID]));
    const last = vi.mocked(port.schedule).mock.calls.at(-1)![0];
    expect(last[0]!.at).toBe(Date.UTC(2026, 9, 21, 16));
  });

  it('never twice a day: after today’s reminder was shown the next one is tomorrow', async () => {
    const port = fakePort();
    await enableReminder({
      port,
      userId: null,
      cleanWebPush: async () => 0,
      facts: async () => facts(),
      now: () => NOW,
    });
    const after = Date.UTC(2026, 9, 20, 17); // 20:00 local, reminder was at 19:00
    const plans = await rescheduleReminder({ port, facts: async () => facts(), now: () => after });
    expect(plans[0]?.day).toBe('2026-10-21');
    expect(readReminderState().lastShownDay).toBe('2026-10-20');
  });

  it('turning off cancels the pending reminder', async () => {
    const port = fakePort();
    await enableReminder({
      port,
      userId: null,
      cleanWebPush: async () => 0,
      facts: async () => facts(),
      now: () => NOW,
    });
    await disableReminder({ port, facts: async () => facts(), now: () => NOW });
    expect(port.cancel).toHaveBeenLastCalledWith(expect.arrayContaining([REMINDER_ID]));
    expect(readReminderState()).toMatchObject({ enabled: false, scheduled: [] });
  });

  it('retries the Web Push cleanup after a failure, and does it once per account', async () => {
    await enableReminder({
      port: fakePort(),
      userId: 'u1',
      cleanWebPush: async () => null,
      facts: async () => facts(),
      now: () => NOW,
    });
    expect(readReminderState().webCleanedFor).toBeNull();
    const clean = vi.fn(async () => 1);
    expect(await syncWebPushCleanup('u1', clean)).toEqual({ removed: 1, failed: false });
    expect(await syncWebPushCleanup('u1', clean)).toEqual({ removed: null, failed: false });
    expect(clean).toHaveBeenCalledTimes(1);
    await syncWebPushCleanup('u2', clean); // another account signed in on this phone
    expect(clean).toHaveBeenCalledTimes(2);
  });

  describe('answering from the notification (ADR 0048)', () => {
    const card = { card_id: 'c1', term: 'resilient', meaning: 'dayanıklı' };
    const enable = (port: ReturnType<typeof fakePort>, cards: (ats: number[]) => Promise<(typeof card | null)[]>) =>
      enableReminder({
        port,
        userId: null,
        cleanWebPush: async () => 0,
        facts: async () => facts(),
        cards,
        now: () => NOW,
      });

    it('asks a due card on the first reminder by default', async () => {
      const port = fakePort();
      const cards = vi.fn(async (ats: number[]) => ats.map((_, i) => (i === 0 ? card : null)));
      await enable(port, cards);
      expect(readReminderState().answerCards).toBe(true);
      expect(cards).toHaveBeenCalledWith(port.scheduled.map((n) => n.at));
      expect(port.scheduled[0]?.card).toEqual(card);
      expect(port.scheduled[1]?.card).toBeUndefined();
    });

    it('turned off, or when the lookup fails, the reminder stays plain', async () => {
      const port = fakePort();
      await enable(port, async () => {
        throw new Error('db closed');
      });
      expect(port.scheduled.length).toBeGreaterThan(0);
      expect(port.scheduled.every((n) => n.card === undefined)).toBe(true);

      const again = fakePort();
      const cards = vi.fn(async () => [card]);
      await setAnswerCards(false, { port: again, facts: async () => facts(), cards, now: () => NOW });
      expect(readReminderState().answerCards).toBe(false);
      expect(cards).not.toHaveBeenCalled();
      expect(again.scheduled.every((n) => n.card === undefined)).toBe(true);
    });
  });
});
