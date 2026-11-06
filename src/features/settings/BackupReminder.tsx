import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db, getSettings } from '@/data';
import { HomeNote } from '@/features/home/HomeNote';
import { Button } from '@/ui';
import { shouldRemindBackup } from './backupReminder';
import { downloadBackup } from './backupActions';
import { fileDate, relativeDays } from './download';
import { flags } from './platform';

const DISMISS_KEY = 'backupReminder.dismissed';
const SEEN_KEY = 'backupReminder.seen';

function readSeen(): { day: string; at: number } | null {
  try {
    const v = JSON.parse(flags.get(SEEN_KEY) ?? 'null') as { day?: unknown; at?: unknown } | null;
    return v && typeof v.day === 'string' && typeof v.at === 'number' ? { day: v.day, at: v.at } : null;
  } catch {
    return null;
  }
}

/**
 * The guest backup reminder (7 days without a backup), as one note in Bugün's single note slot
 * below the Today card (v0.5.3 A7, ADR 0072) instead of an amber banner above it every day. It
 * shows on one day, then rests for a week; "Yedek al" downloads at once, the close button hides
 * it for today.
 */
export function BackupReminder() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(() => flags.get(DISMISS_KEY));
  const [seen] = useState(readSeen);
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
  const show =
    !!info &&
    shouldRemindBackup({
      guest: info.guest,
      noteCount: info.noteCount,
      lastBackupAt: info.settings.last_backup_at,
      startedAt: info.settings.created_at,
      dismissedOn: dismissed,
      seen,
      todayKey: today,
      now: info.now,
    });
  // The first showing of the week starts the week's rest.
  useEffect(() => {
    if (show && seen?.day !== today) flags.set(SEEN_KEY, JSON.stringify({ day: today, at: Date.now() }));
  }, [show, seen, today]);
  if (!show || !info) return null;
  const last = info.settings.last_backup_at;
  return (
    <HomeNote
      titleId="backup-reminder-title"
      icon="file"
      data-testid="backup-reminder"
      title={last ? t('backup.reminderTitle', { when: relativeDays(last) }) : t('backup.reminderNever')}
      onClose={() => {
        flags.set(DISMISS_KEY, today);
        setDismissed(today);
      }}
      actions={
        <Button
          size="sm"
          variant="tonal"
          leadingIcon="file"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await downloadBackup();
            setBusy(false);
          }}
        >
          {t('backup.download')}
        </Button>
      }
    >
      <p>{t('backup.reminderBody')}</p>
    </HomeNote>
  );
}
