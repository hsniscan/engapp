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
  /**
   * The day it was last shown on (v0.5.3 A7, ADR 0072): it shows on one day, then rests for a
   * week, so it never becomes a daily amber banner that people learn to ignore.
   */
  seen?: { day: string; at: number } | null;
  todayKey: string;
  now: number;
}): boolean {
  if (!input.guest || input.noteCount === 0) return false;
  if (input.dismissedOn === input.todayKey) return false;
  const seen = input.seen ?? null;
  if (seen && seen.day !== input.todayKey && input.now - seen.at < BACKUP_REMINDER_DAYS * DAY)
    return false;
  const since = input.lastBackupAt ?? input.startedAt;
  return input.now - since >= BACKUP_REMINDER_DAYS * DAY;
}
