import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { AccountLinkDialog } from '@/features/auth/AccountLinkDialog';
import { startConnectedFeatures } from '@/features/auth/startConnected';
import { useSyncStatus } from '@/sync/status';
import { Icon, SyncStatus, Tooltip } from '@/ui';

/**
 * Top-bar sync state. Signed in: the engine's state (Senkronlandı / N değişiklik bekliyor /
 * Çevrimdışı / hata). Guest: a quiet "Bu cihazda" that leads to sign-in. Also hosts the
 * account-linking dialog, which must be reachable from any screen.
 */
export function SyncIndicator() {
  const { t } = useTranslation();
  const s = useSyncStatus();

  useEffect(() => {
    startConnectedFeatures(); // idempotent safety net if main.tsx did not start it
  }, []);

  if (s.mode === 'local') {
    const full = s.backendConfigured
      ? t('syncPanel.localIndicatorFull')
      : t('syncPanel.unavailableIndicatorFull');
    const body = (
      <>
        <Icon name="sync-offline" size={20} />
        <span aria-hidden="true" className="hidden whitespace-nowrap md:inline">
          {t('syncPanel.localIndicator')}
        </span>
      </>
    );
    const cls =
      'inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-sm text-fg-subtle transition-colors duration-(--duration-micro) hover:bg-hover hover:text-fg-muted';
    return (
      <>
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
        <AccountLinkDialog />
      </>
    );
  }

  return (
    <>
      <SyncStatus state={s.state} pendingCount={s.pending} />
      <AccountLinkDialog />
    </>
  );
}
