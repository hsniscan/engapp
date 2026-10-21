import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { pendingChangesCount } from '@/data';
import { Button, Icon, buttonClasses } from '@/ui';
import { useUserId } from './useAppSettings';

export function DefaultAccount() {
  const { t } = useTranslation();
  const userId = useUserId();
  const guest = userId === null || userId === undefined;
  return (
    <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
      <div className="flex flex-1 items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-fg-muted">
          <Icon name="user" size={22} />
        </span>
        <div className="flex min-w-0 flex-col">
          <p className="font-medium text-fg">
            {guest ? t('settings.account.guest') : t('settings.account.signedIn')}
          </p>
          <p className="text-sm text-fg-muted">
            {guest ? t('settings.account.guestHint') : userId}
          </p>
        </div>
      </div>
      {guest && (
        <Link to="/auth" className={buttonClasses({ variant: 'secondary', className: 'shrink-0' })}>
          {t('settings.account.signIn')}
        </Link>
      )}
    </div>
  );
}

export function DefaultSync() {
  const { t } = useTranslation();
  const userId = useUserId();
  const pending = useLiveQuery(() => pendingChangesCount(), []) ?? 0;
  const guest = !userId;
  return (
    <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="font-medium text-fg">
          {guest ? t('settings.sync.off') : t('sync.pending', { count: pending })}
        </p>
        <p className="text-sm text-fg-muted">
          {guest ? t('settings.sync.offHint') : t('settings.sync.lastNever')}
        </p>
      </div>
      <Button variant="secondary" leadingIcon="refresh" disabled className="shrink-0">
        {t('sync.syncNow')}
      </Button>
    </div>
  );
}
