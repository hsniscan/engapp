import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { db, getSettings } from '@/data';
import { Button, Icon, IconButton } from '@/ui';
import { shouldRemindBackup } from './backupReminder';
import { downloadBackup } from './backupActions';
import { fileDate, relativeDays } from './download';
import { flags } from './platform';

const DISMISS_KEY = 'backupReminder.dismissed';

/**
 * Small banner for guests who have not backed up for 7 days. Mounted above the routed page
 * by RootLayout and shown on the home screen only; "Yedek al" downloads at once, the close
 * button hides it until tomorrow.
 */
export function BackupReminder() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState(() => flags.get(DISMISS_KEY));
  const [busy, setBusy] = useState(false);
  const today = fileDate();
  const info = useLiveQuery(async () => {
    const [settings, user, noteCount] = await Promise.all([
      getSettings(),
      db.meta.get('user_id'),
      // getAll, then filter: a Dexie .filter() walks a cursor, one round trip per row.
      db.notes.toArray().then((ns) => ns.filter((n) => n.deleted_at === null).length),
    ]);
    return { settings, guest: !user?.value, noteCount, now: Date.now() };
  }, []);
  if (pathname !== '/' || !info) return null;
  const show = shouldRemindBackup({
    guest: info.guest,
    noteCount: info.noteCount,
    lastBackupAt: info.settings.last_backup_at,
    startedAt: info.settings.created_at,
    dismissedOn: dismissed,
    todayKey: today,
    now: info.now,
  });
  if (!show) return null;
  const last = info.settings.last_backup_at;
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-4 sm:px-6 md:pt-6">
      <div
        role="region"
        aria-label={t('backup.reminderLabel')}
        className="flex items-start gap-3 rounded-card border border-warn/40 bg-warn-soft py-2 pr-1 pl-3.5"
      >
        <Icon name="alert" size={20} className="mt-2.5 shrink-0 text-warn-text" />
        <div className="flex min-w-0 flex-1 flex-col gap-2 py-2 sm:flex-row sm:items-center sm:gap-4">
          <p className="flex-1 text-sm text-warn-text">
            <strong className="font-semibold">
              {last
                ? t('backup.reminderTitle', { when: relativeDays(last) })
                : t('backup.reminderNever')}
            </strong>{' '}
            {t('backup.reminderBody')}
          </p>
          <Button
            size="sm"
            variant="secondary"
            leadingIcon="file"
            loading={busy}
            className="self-start sm:self-auto"
            onClick={async () => {
              setBusy(true);
              await downloadBackup();
              setBusy(false);
            }}
          >
            {t('backup.download')}
          </Button>
        </div>
        <IconButton
          icon="x"
          size="sm"
          label={t('backup.reminderDismiss')}
          className="mt-1 text-warn-text hover:text-warn-text"
          onClick={() => {
            flags.set(DISMISS_KEY, today);
            setDismissed(today);
          }}
        />
      </div>
    </div>
  );
}
