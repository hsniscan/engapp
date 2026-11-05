import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { syncNow } from '@/sync';
import { useSyncStatus } from '@/sync/status';
import { Button, Icon, toast } from '@/ui';
import { useAuth } from './session';
import { heldHint, syncTitle } from './syncText';
import { formatSince } from './time';

/** "Senkron" section body for Settings: state, last successful sync, "Şimdi senkronla". */
export function SyncPanel() {
  const { t } = useTranslation();
  const s = useSyncStatus();
  const auth = useAuth();
  const [running, setRunning] = useState(false);

  const account = s.mode === 'account';
  const title = syncTitle(t, s);
  const quota = account && s.state === 'error' && s.error === 'quota';
  const hint = !account
    ? auth.status === 'guest' && s.pending > 0
      ? t('syncPanel.signedOutHint')
      : t('syncPanel.localHint')
    : s.lastSyncAt
      ? t('syncPanel.lastSync', { when: formatSince(s.lastSyncAt) })
      : t('syncPanel.never');

  const run = async () => {
    setRunning(true);
    try {
      const out = await syncNow();
      if (out.ok) toast({ title: t('syncPanel.done'), tone: 'success' });
      else if (out.reason === 'offline' || (out.reason === 'error' && out.error === 'network'))
        toast({ title: t('syncPanel.offline') });
      else if (out.reason === 'busy') toast({ title: t('syncPanel.busy') });
      else if (out.reason === 'error' && out.error === 'quota')
        toast({ title: t('syncPanel.quotaToast'), tone: 'warn' });
      else if (out.reason === 'error' && out.error === 'auth')
        toast({ title: t('syncPanel.authFailed'), tone: 'warn' });
      else if (out.reason === 'error') toast({ title: t('syncPanel.failed'), tone: 'danger' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 px-4 py-3.5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-ui font-medium text-fg" data-testid="sync-title">
            {title}
          </p>
          <p className="text-meta text-fg-muted">{hint}</p>
        </div>
        {account && (
          <Button
            variant="secondary"
            leadingIcon="refresh"
            className="shrink-0"
            loading={running || s.state === 'syncing'}
            onClick={() => void run()}
          >
            {t('sync.syncNow')}
          </Button>
        )}
      </div>
      {account && s.held && !quota && (
        <p
          role="status"
          data-testid="sync-held"
          className="flex items-start gap-2 rounded-control bg-warn-soft px-3 py-2.5 text-meta text-warn-text"
        >
          <Icon name="info" size={18} className="mt-px shrink-0" />
          <span>{heldHint(t, s.held)}</span>
        </p>
      )}
      {quota ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-control bg-warn-soft px-3 py-2.5 text-meta text-warn-text"
        >
          <Icon name="info" size={18} className="mt-px shrink-0" />
          <span>{t('syncPanel.quotaHint')}</span>
        </p>
      ) : (
        account &&
        s.stuck > 0 && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-control bg-danger-soft px-3 py-2.5 text-meta text-danger-text"
          >
            <Icon name="alert" size={18} className="mt-px shrink-0" />
            <span>{t('syncPanel.stuck', { count: s.stuck })}</span>
          </p>
        )
      )}
    </div>
  );
}
