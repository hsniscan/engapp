import { describe, expect, it } from 'vitest';
import { shouldRemindBackup } from './backupReminder';

const DAY = 86_400_000;
const base = {
  guest: true,
  noteCount: 3,
  lastBackupAt: null,
  startedAt: 0,
  dismissedOn: null,
  todayKey: '2026-10-21',
  now: 8 * DAY,
};

describe('shouldRemindBackup', () => {
  it('reminds guests after 7 days without a backup', () => {
    expect(shouldRemindBackup(base)).toBe(true);
    expect(shouldRemindBackup({ ...base, lastBackupAt: 2 * DAY })).toBe(false);
    expect(shouldRemindBackup({ ...base, lastBackupAt: 0.5 * DAY })).toBe(true);
  });
  it('stays quiet for accounts, empty decks and after dismissing today', () => {
    expect(shouldRemindBackup({ ...base, guest: false })).toBe(false);
    expect(shouldRemindBackup({ ...base, noteCount: 0 })).toBe(false);
    expect(shouldRemindBackup({ ...base, dismissedOn: '2026-10-21' })).toBe(false);
  });
});
