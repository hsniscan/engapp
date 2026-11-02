import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureSettings } from '@/data';
import { setAuthStateForTesting } from '@/features/auth/session';
import type { SyncStatusInfo } from '@/sync/status';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { ProfilePage } from './ProfilePage';

const status: { value: SyncStatusInfo } = {
  value: {
    mode: 'account',
    state: 'error',
    pending: 3,
    stuck: 0,
    lastSyncAt: null,
    error: 'quota',
    backendConfigured: true,
  },
};
vi.mock('@/sync/status', () => ({ useSyncStatus: () => status.value }));

beforeEach(async () => {
  await resetDb();
  await ensureSettings();
  setAuthStateForTesting({
    status: 'signed_in',
    user: { id: 'u1', email: 'h@example.com', name: 'Hasan', avatarUrl: null },
  });
});

describe('Profil sync state (Bugün has no sync pill; ADR 0070)', () => {
  it('a refused daily quota says so in plain Turkish, at the top and in the row', async () => {
    renderRoute(<ProfilePage />, { path: '/profile' });
    const alert = await screen.findByTestId('profile-sync-alert');
    expect(alert).toHaveTextContent('Bugünkü eşitleme sınırı doldu');
    expect(alert).toHaveTextContent('bu cihazda güvende');
    expect(alert).toHaveAttribute('href', '/settings/hesap#senkron');
    expect(screen.getByText('Sınır doldu')).toBeInTheDocument();
  });

  it('a plain server error is a different message; all fine shows no card', async () => {
    status.value = { ...status.value, error: 'server' };
    const { unmount } = renderRoute(<ProfilePage />, { path: '/profile' });
    expect(await screen.findByTestId('profile-sync-alert')).toHaveTextContent(
      'Eşitleme başarısız',
    );
    unmount();
    status.value = { ...status.value, state: 'synced', error: null };
    renderRoute(<ProfilePage />, { path: '/profile' });
    await screen.findByRole('heading', { level: 1, name: 'Hasan' });
    expect(screen.queryByTestId('profile-sync-alert')).toBeNull();
  });
});
