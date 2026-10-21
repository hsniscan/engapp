// Pure rule for the guest backup reminder (plan: "misafir kullanıcıda 7 günü geçince ana ekranda hatırlatma").
export const BACKUP_REMINDER_DAYS = 7;
const DAY = 86_400_000;

export function shouldRemindBackup(input: {
  guest: boolean;
  noteCount: number;
  lastBackupAt: number | null;
  /** When the user started (settings.created_at): the clock starts here before the first backup. */
  startedAt: number;
  /** Day key the user dismissed the banner on, if any. */
  dismissedOn: string | null;
  todayKey: string;
  now: number;
}): boolean {
  if (!input.guest || input.noteCount === 0) return false;
  if (input.dismissedOn === input.todayKey) return false;
  const since = input.lastBackupAt ?? input.startedAt;
  return input.now - since >= BACKUP_REMINDER_DAYS * DAY;
}
