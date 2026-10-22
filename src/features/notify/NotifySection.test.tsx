import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureSettings, getSettings, updateSettings } from '@/data';
import { setAuthStateForTesting } from '@/features/auth/session';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import * as ui from '@/ui';
import { NotifySection } from './NotifySection';
import { fakeBrowser } from './testing';

const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'h@test.local',
  name: 'H',
  avatarUrl: null,
};

beforeEach(async () => {
  await resetDb();
  localStorage.clear();
  await ensureSettings();
  setAuthStateForTesting({ status: 'signed_in', user: USER });
});
afterEach(() => {
  setAuthStateForTesting({ status: 'guest', user: null });
  vi.restoreAllMocks();
});

const daily = () => screen.findByRole('switch', { name: /Günlük hatırlatma/ });

describe('Settings → Bildirim', () => {
  it('explains that a guest needs a Google account', async () => {
    setAuthStateForTesting({ status: 'guest', user: null });
    renderRoute(<NotifySection env={fakeBrowser().env} />);
    expect(await screen.findByText(/Bildirimler Google hesabıyla çalışır/)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('turns the reminder on (permission, subscription, setting) and off again', async () => {
    const toast = vi.spyOn(ui, 'toast');
    const fb = fakeBrowser();
    const user = userEvent.setup();
    renderRoute(<NotifySection env={fb.env} />);
    const sw = await daily();
    await waitFor(() => expect(sw).toBeEnabled());
    expect(sw).not.toBeChecked();
    expect(screen.getByText(/Android'de uygulamayı ana ekrana yükle/)).toBeInTheDocument();

    await user.click(sw);
    await waitFor(async () =>
      expect((await getSettings()).notify).toEqual({ enabled: true, mode: 'auto', hour: 19 }),
    );
    expect(fb.sub).not.toBeNull();
    expect(await daily()).toBeChecked();
    expect(await screen.findByText(/En sık çalışmaya başladığın saat: 19\.00/)).toBeInTheDocument();

    // Fixed time keeps the hour until another is chosen.
    await user.click(screen.getByRole('radio', { name: 'Sabit saat' }));
    await waitFor(async () =>
      expect((await getSettings()).notify).toEqual({ enabled: true, mode: 'fixed', hour: 19 }),
    );

    await user.click(screen.getByRole('button', { name: 'Deneme bildirimi gönder' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Deneme bildirimi gönderildi.' }),
      ),
    );

    await user.click(await daily());
    await waitFor(async () => expect((await getSettings()).notify?.enabled).toBe(false));
    expect(fb.sub).toBeNull();
    expect(fb.rpc).toHaveBeenLastCalledWith('push_unsubscribe', expect.anything());
    expect(await daily()).not.toBeChecked();
  });

  it('says when it is on for another device only', async () => {
    await updateSettings({ notify: { enabled: true, mode: 'auto', hour: 20 } });
    renderRoute(<NotifySection env={fakeBrowser().env} />);
    expect(await screen.findByText(/başka bir cihazında açık/)).toBeInTheDocument();
    expect(await daily()).not.toBeChecked();
  });

  it('explains a blocked permission', async () => {
    const fb = fakeBrowser();
    fb.setPermission('denied', 'denied');
    renderRoute(<NotifySection env={fb.env} />);
    expect(await screen.findByText(/Bildirim izni kapalı/)).toBeInTheDocument();
    expect(await daily()).toBeDisabled();
  });

  it('shows the iPhone install steps in a Safari tab', async () => {
    const fb = fakeBrowser({
      hasPushManager: false,
      notification: null,
      ios: true,
      standalone: false,
      userAgent: 'iPhone',
    });
    renderRoute(<NotifySection env={fb.env} />);
    expect(await screen.findByText("iPhone'da önce ana ekrana ekle")).toBeInTheDocument();
    expect(screen.getByText(/Paylaş düğmesine dokun/)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('reports a browser without push', async () => {
    renderRoute(
      <NotifySection env={fakeBrowser({ hasPushManager: false, notification: null }).env} />,
    );
    expect(await screen.findByText(/Bu tarayıcı bildirimleri desteklemiyor/)).toBeInTheDocument();
  });
});
