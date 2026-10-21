import { exportBackup, logError } from '@/data';
import { backupFileName, downloadText } from './download';

/** Download the full JSON backup ("engapp-yedek-2026-10-21.json"). Records last_backup_at. */
export async function downloadBackup(): Promise<boolean> {
  try {
    const backup = await exportBackup();
    downloadText(backupFileName(), JSON.stringify(backup), 'application/json');
    return true;
  } catch (e) {
    void logError(e, 'backup.export');
    return false;
  }
}
