import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import '@/features/auth/register';
import { AccountLinkDialog } from '@/features/auth/AccountLinkDialog';
import { startConnectedFeatures } from '@/features/auth/startConnected';
import { useSyncStatus } from '@/sync/status';
import { Icon, SyncStatus, Tooltip } from '@/ui';

/**
 * Mounted once by the root layout, on every screen: the account-linking dialog (reachable from
 * anywhere) and the connected features. The visible state is SyncIndicator, which may be shown
 * in several places (the home header, the side rail, the slim bar of a session).
 */
export function SyncServices() {
  useEffect(() => {
    startConnectedFeatures(); // idempotent safety net if main.tsx did not start it
  }, []);
  return <AccountLinkDialog />;
}

/**
 * Sync state. Signed in: the engine's state (Senkronlandı / N değişiklik bekliyor /
 * Çevrimdışı / hata). Guest: a quiet "Bu cihazda" that leads to sign-in.
 */
export function SyncIndicator({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const s = useSyncStatus();

  if (s.mode === 'local') {
    const full = s.backendConfigured
      ? t('syncPanel.localIndicatorFull')
      : t('syncPanel.unavailableIndicatorFull');
    const body = (
      <>
        <Icon name="sync-offline" size={20} />
        <span
          aria-hidden="true"
          className={compact ? 'sr-only' : 'hidden whitespace-nowrap md:inline'}
        >
          {t('syncPanel.localIndicator')}
        </span>
      </>
    );
    const cls =
      'inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-sm text-fg-subtle transition-colors duration-(--duration-micro) hover:bg-hover hover:text-fg-muted';
    return (
      <Tooltip content={full}>
        {s.backendConfigured ? (
          <Link to="/auth" aria-label={`${t('sync.label')}: ${full}`} className={cls}>
            {body}
          </Link>
        ) : (
          <span
            role="status"
            tabIndex={0}
            aria-label={`${t('sync.label')}: ${full}`}
            className={cls}
          >
            {body}
          </span>
        )}
      </Tooltip>
    );
  }

  return <SyncStatus state={s.state} pendingCount={s.pending} />;
}
