// Rows the server holds back while everything else syncs (decision 0075): Ayarlar → Hesap and
// the sync indicator say so in plain Turkish.
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncIndicator } from '@/app/SyncIndicator';
import { ensureSettings } from '@/data';
import type { SyncStatusInfo } from '@/sync/status';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { setAuthStateForTesting } from './session';
import { SyncPanel } from './SyncPanel';

const status: { value: SyncStatusInfo } = {
  value: {
    mode: 'account',
    state: 'pending',
    pending: 1,
    stuck: 0,
    lastSyncAt: null,
    error: null,
    backendConfigured: true,
    held: 'storage',
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

describe('held rows (decision 0075)', () => {
  it('a nearly full server: texts wait, reviews keep syncing', async () => {
    status.value = { ...status.value, held: 'storage' };
    renderRoute(<SyncPanel />, { path: '/settings' });
    const note = await screen.findByTestId('sync-held');
    expect(note).toHaveTextContent('Sunucuda yer azaldı');
    expect(note).toHaveTextContent('tekrarların, kelimelerin ve ayarların eşitlenmeye devam ediyor');
  });

  it('the text quota has its own sentence; nothing held shows nothing', async () => {
    status.value = { ...status.value, held: 'texts' };
    const { unmount } = renderRoute(<SyncPanel />, { path: '/settings' });
    expect(await screen.findByTestId('sync-held')).toHaveTextContent('Kaydedilmiş metin sınırına ulaştın');
    unmount();
    status.value = { ...status.value, held: null };
    renderRoute(<SyncPanel />, { path: '/settings' });
    await screen.findByTestId('sync-title');
    expect(screen.queryByTestId('sync-held')).toBeNull();
  });

  it('the indicator shows a calm "some waiting" that leads to the explanation', async () => {
    status.value = { ...status.value, held: 'storage' };
    renderRoute(<SyncIndicator />, { path: '/' });
    const link = await screen.findByRole('link', { name: /Sunucuda yer azaldı/ });
    expect(link).toHaveAttribute('href', '/settings/hesap#senkron');
    expect(screen.getByText('Bir kısmı bekliyor')).toBeInTheDocument();
  });
});
