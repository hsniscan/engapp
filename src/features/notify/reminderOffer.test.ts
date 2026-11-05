import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSettings } from '@/data';
import { ensureSettings } from '@/data/settings';
import { parseNotify } from '@/domain/notify';
import { resetDb } from '@/test/db';
import {
  readReminderState,
  resetReminderStateForTesting,
  type NotifierPort,
  type Permission,
  type ScheduledNotification,
} from './nativeReminder';
import {
  answerOffer,
  offerKind,
  pingWhenDue,
  REMINDER_OFFER_KEY,
  STEP_PING_ID,
  suggestedHour,
  turnOnReminder,
} from './reminderOffer';

const base = {
  answered: null,
  answers: 12,
  sessionOver: true,
  native: true,
  nativeEnabled: false,
  webSupported: false,
  signedIn: false,
  accountEnabled: false,
  backend: true,
} as const;

function fakePort(granted = true) {
  const scheduled: ScheduledNotification[] = [];
  const port: NotifierPort = {
    checkPermission: vi.fn(async (): Promise<Permission> => (granted ? 'granted' : 'prompt')),
    requestPermission: vi.fn(async (): Promise<Permission> => (granted ? 'granted' : 'denied')),
    ensureChannel: vi.fn(async () => {}),
    schedule: vi.fn(async (l: ScheduledNotification[]) => void scheduled.push(...l)),
    cancel: vi.fn(async () => {}),
    clearShown: vi.fn(async () => {}),
  };
  return { port, scheduled };
}

beforeEach(async () => {
  await resetDb();
  localStorage.clear();
  resetReminderStateForTesting();
  await ensureSettings();
});

describe('offerKind (A4)', () => {
  it('Android after the first finished session, until the reminder is on', () => {
    expect(offerKind(base)).toBe('native');
    expect(offerKind({ ...base, nativeEnabled: true })).toBeNull();
    expect(offerKind({ ...base, answers: 0 })).toBeNull();
    expect(offerKind({ ...base, sessionOver: false })).toBeNull();
  });

  it('never again after an answer, yes or no', () => {
    expect(offerKind({ ...base, answered: 'no' })).toBeNull();
    expect(offerKind({ ...base, answered: 'yes' })).toBeNull();
  });

  it('web: push where supported; a guest gets the account offer; nothing without push', () => {
    const web = { ...base, native: false, webSupported: true };
    expect(offerKind({ ...web, signedIn: true })).toBe('web');
    expect(offerKind(web)).toBe('webGuest');
    expect(offerKind({ ...web, webSupported: false })).toBeNull();
    expect(offerKind({ ...web, signedIn: true, accountEnabled: true })).toBeNull();
    expect(offerKind({ ...web, backend: false })).toBeNull();
  });

  it('answerOffer is kept on the device', () => {
    answerOffer('no');
    expect(localStorage.getItem(`engapp.${REMINDER_OFFER_KEY}`)).toBe('no');
  });
});

describe('suggestedHour', () => {
  it('the hour just studied, inside 09–21', () => {
    expect(suggestedHour(Date.UTC(2026, 10, 5, 17, 30), 'Europe/Istanbul')).toBe(20);
    expect(suggestedHour(Date.UTC(2026, 10, 5, 21, 30), 'Europe/Istanbul')).toBe(21);
    expect(suggestedHour(Date.UTC(2026, 10, 5, 4, 0), 'Europe/Istanbul')).toBe(9);
  });
});

describe('turnOnReminder on Android', () => {
  it('saves the chosen hour and turns this phone’s reminder on', async () => {
    const { port } = fakePort();
    const r = await turnOnReminder('native', 20, {
      userId: null,
      native: async () => ({ port, cleanWebPush: async () => 0 }),
    });
    expect(r).toEqual({ ok: true });
    expect(readReminderState().enabled).toBe(true);
    expect(parseNotify((await getSettings()).notify)).toMatchObject({ mode: 'fixed', hour: 20 });
  });

  it('permission refused: nothing turned on', async () => {
    const { port } = fakePort(false);
    const r = await turnOnReminder('native', 20, {
      userId: null,
      native: async () => ({ port, cleanWebPush: async () => 0 }),
    });
    expect(r).toEqual({ ok: false, reason: 'denied' });
    expect(readReminderState().enabled).toBe(false);
  });
});

describe('pingWhenDue (A6)', () => {
  it('one notification at the given time, replacing an earlier ping', async () => {
    const { port, scheduled } = fakePort();
    const at = Date.UTC(2026, 10, 5, 17, 41);
    const ok = await pingWhenDue(at, { title: 'Kartların hazır', body: 'x' }, async () => ({
      port,
      cleanWebPush: async () => 0,
    }));
    expect(ok).toBe(true);
    expect(port.cancel).toHaveBeenCalledWith([STEP_PING_ID]);
    expect(scheduled).toEqual([expect.objectContaining({ id: STEP_PING_ID, at, title: 'Kartların hazır' })]);
  });
});
