// Whether the guest backup reminder (features/settings/BackupReminder, shown above Bugün by
// RootLayout) is on screen, so Bugün shows no other note at the same time (v0.5.1: one note at
// a time, the backup reminder first). Same rule and dismissal flag as the banner; the banner
// sends BACKUP_REMINDER_EVENT when it is closed.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db, getSettings } from '@/data';
import { shouldRemindBackup } from '@/features/settings/backupReminder';
import { fileDate } from '@/features/settings/download';
import { flags } from '@/features/settings/platform';

/** The banner's dismissal flag (BackupReminder.tsx DISMISS_KEY). */
const DISMISS_KEY = 'backupReminder.dismissed';
export const BACKUP_REMINDER_EVENT = 'engapp:backup-reminder';

export function useBackupReminderShown(): boolean {
  const [dismissed, setDismissed] = useState(() => flags.get(DISMISS_KEY));
  useEffect(() => {
    const on = () => setDismissed(flags.get(DISMISS_KEY));
    window.addEventListener(BACKUP_REMINDER_EVENT, on);
    return () => window.removeEventListener(BACKUP_REMINDER_EVENT, on);
  }, []);
  const info = useLiveQuery(async () => {
    const [settings, user, noteCount] = await Promise.all([
      getSettings(),
      db.meta.get('user_id'),
      db.notes.toArray().then((ns) => ns.filter((n) => n.deleted_at === null).length),
    ]);
    return { settings, guest: !user?.value, noteCount, now: Date.now() };
  }, []);
  if (!info) return false;
  return shouldRemindBackup({
    guest: info.guest,
    noteCount: info.noteCount,
    lastBackupAt: info.settings.last_backup_at,
    startedAt: info.settings.created_at,
    dismissedOn: dismissed,
    todayKey: fileDate(),
    now: info.now,
  });
}
