import { useTranslation } from 'react-i18next';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';
import { Spinner } from './Spinner';
import { Tooltip } from './Tooltip';

export type SyncState = 'synced' | 'syncing' | 'pending' | 'offline' | 'error';

export interface SyncStatusProps {
  state: SyncState;
  /** Outbox size, used by 'pending'. */
  pendingCount?: number;
  className?: string;
}

const icons: Record<Exclude<SyncState, 'syncing'>, IconName> = {
  synced: 'sync-synced',
  pending: 'sync-pending',
  offline: 'sync-offline',
  error: 'sync-error',
};

/**
 * Top-bar sync indicator. Quiet when all is well (icon only on phones), explicit when not.
 * Purely presentational: the sync engine owns the state. Announced politely via role="status".
 */
export function SyncStatus({ state, pendingCount = 0, className }: SyncStatusProps) {
  const { t } = useTranslation();
  const full =
    state === 'pending'
      ? t('sync.pending', { count: pendingCount })
      : state === 'synced'
        ? t('sync.synced')
        : state === 'syncing'
          ? t('sync.syncing')
          : state === 'offline'
            ? t('sync.offline')
            : t('sync.error');
  const short =
    state === 'offline'
      ? t('sync.offlineShort')
      : state === 'error'
        ? t('sync.errorShort')
        : state === 'pending'
          ? String(pendingCount)
          : full;
  const quiet = state === 'synced' || state === 'syncing';

  return (
    <Tooltip content={full}>
      <div
        role="status"
        tabIndex={0}
        aria-label={`${t('sync.label')}: ${full}`}
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-sm',
          state === 'error' ? 'text-danger-text' : quiet ? 'text-fg-subtle' : 'text-fg-muted',
          !quiet && 'bg-hover',
          className,
        )}
      >
        {state === 'syncing' ? <Spinner size={16} /> : <Icon name={icons[state]} size={20} />}
        <span
          aria-hidden="true"
          className={cn('tabular whitespace-nowrap', quiet && 'hidden md:inline')}
        >
          <span className="md:hidden">{short}</span>
          <span className="hidden md:inline">{full}</span>
        </span>
      </div>
    </Tooltip>
  );
}
