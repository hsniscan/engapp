import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureSettings } from '@/data';
import { setAuthStateForTesting } from '@/features/auth/session';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import * as ui from '@/ui';
import { NativeNotifySection } from './NativeNotifySection';
import { NotifySection } from './NotifySection';
import {
  readReminderState,
  resetReminderStateForTesting,
  type NotifierPort,
} from './nativeReminder';

function port(perm: 'granted' | 'denied' = 'granted'): NotifierPort {
  return {
    checkPermission: async () => 'prompt',
    requestPermission: async () => perm,
    ensureChannel: async () => {},
    schedule: vi.fn(async () => {}),
    cancel: async () => {},
    clearShown: async () => {},
  };
}

beforeEach(async () => {
  await resetDb();
  localStorage.clear();
  resetReminderStateForTesting();
  await ensureSettings();
  setAuthStateForTesting({
    status: 'signed_in',
    user: { id: 'u1', email: null, name: null, avatarUrl: null },
  });
});
afterEach(() => {
  setAuthStateForTesting({ status: 'guest', user: null });
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
  vi.restoreAllMocks();
});

describe('Settings → Bildirim in the Android app', () => {
  it('replaces the Web Push section when running as the native app', async () => {
    (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    renderRoute(<NotifySection />);
    expect(await screen.findByText(/Telefonda hesaplanır/)).toBeInTheDocument();
    expect(screen.queryByText(/Deneme bildirimi/)).toBeNull();
  });

  it('turns on with a notice that browser notifications were removed', async () => {
    const toast = vi.spyOn(ui, 'toast');
    const cleanWebPush = vi.fn(async () => 1);
    const user = userEvent.setup();
    renderRoute(<NativeNotifySection deps={async () => ({ port: port(), cleanWebPush })} />);
    const sw = await screen.findByRole('switch', { name: /Günlük hatırlatma/ });
    expect(sw).not.toBeChecked();
    await user.click(sw);
    await waitFor(() => expect(readReminderState().enabled).toBe(true));
    expect(cleanWebPush).toHaveBeenCalledWith('u1');
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Hatırlatma açıldı. Bu telefona gelir.',
        description: expect.stringMatching(/tarayıcı bildirimi kapatıldı \(1 cihaz\)/),
      }),
    );
    expect(await screen.findByRole('switch', { name: /Günlük hatırlatma/ })).toBeChecked();
  });

  it('explains where to allow notifications when the permission is refused', async () => {
    const user = userEvent.setup();
    renderRoute(
      <NativeNotifySection
        deps={async () => ({ port: port('denied'), cleanWebPush: async () => 0 })}
      />,
    );
    await user.click(await screen.findByRole('switch', { name: /Günlük hatırlatma/ }));
    expect(await screen.findAllByText(/Bildirim izni kapalı/)).not.toHaveLength(0);
    expect(readReminderState().enabled).toBe(false);
  });
});
