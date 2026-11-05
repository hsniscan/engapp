import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import '@/features/auth/register';
import { AccountLinkDialog } from '@/features/auth/AccountLinkDialog';
import { heldHint } from '@/features/auth/syncText';
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
      'inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-meta text-fg-subtle transition-colors duration-(--duration-micro) hover:bg-hover hover:text-fg-muted';
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

  const quota = s.state === 'error' && s.error === 'quota';
  if (quota || (s.held && s.state !== 'error' && s.state !== 'offline')) {
    // A refused daily quota (ADR 0060/0070), or rows the server holds back while everything
    // else syncs (ADR 0075): say plainly what happened and that data is safe.
    const hint = quota || !s.held ? t('syncPanel.quotaHint') : heldHint(t, s.held);
    return (
      <Tooltip content={hint}>
        <Link
          to="/settings/hesap#senkron"
          aria-label={`${t('sync.label')}: ${hint}`}
          className="inline-flex h-11 items-center gap-1.5 rounded-full bg-warn-soft px-2.5 text-meta font-semibold text-warn-text transition-colors duration-(--duration-micro) hover:bg-hover"
        >
          <Icon name="sync-error" size={18} />
          <span aria-hidden="true" className={compact ? 'sr-only' : 'whitespace-nowrap'}>
            {quota ? t('sync.quotaShort') : t('sync.heldShort')}
          </span>
        </Link>
      </Tooltip>
    );
  }
  return <SyncStatus state={s.state} pendingCount={s.pending} />;
}
