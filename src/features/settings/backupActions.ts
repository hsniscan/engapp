import { exportBackup, logError, recordBackup } from '@/data';
import i18n from '@/i18n';
import { toast } from '@/ui';
import { backupFileName, saveTextFile, type SaveDeps, type SaveResult } from './download';

export interface BackupDeps {
  save?: SaveDeps;
  now?: () => number;
}

/**
 * Save the full JSON backup ("engapp-yedek-2026-10-21.json") where this platform can (browser
 * download, or the phone's Documents folder / share sheet in the Android app). last_backup_at
 * is recorded only after the file was really written (ADR 0058).
 */
export async function saveBackup(deps: BackupDeps = {}): Promise<SaveResult> {
  try {
    const now = deps.now?.() ?? Date.now();
    const backup = await exportBackup(now);
    const name = backupFileName(now);
    const res = await saveTextFile(
      name,
      JSON.stringify(backup),
      'application/json',
      i18n.t('backup.shareTitle'),
      deps.save,
    );
    if (res.ok) await recordBackup(now);
    return res;
  } catch (e) {
    void logError(e, 'backup.export');
    return { ok: false, cancelled: false };
  }
}

/** Save a non-backup file (CSV, error log) and show the same confirmation. */
export async function saveFileWithToast(
  fileName: string,
  text: string,
  mime: string,
  labels: { done: string; failed: string },
  deps?: SaveDeps,
): Promise<boolean> {
  try {
    const res = await saveTextFile(fileName, text, mime, fileName, deps);
    showSaveToast(res, labels);
    return res.ok;
  } catch (e) {
    void logError(e, 'file.save');
    showSaveToast({ ok: false, cancelled: false }, labels);
    return false;
  }
}

/**
 * The confirmation after a save. Web: "Yedek indirildi" as before. App: "Yedek kaydedildi:
 * Documents/engapp-yedek-….json" with a "Paylaş" action to send it to Drive or e-mail.
 */
export function showSaveToast(
  res: SaveResult,
  labels: { done: string; failed: string; hint?: string },
): void {
  if (!res.ok) {
    if (res.cancelled) return;
    toast({ title: labels.failed, tone: 'danger' });
    return;
  }
  if (!res.native) {
    toast({
      title: labels.done,
      ...(labels.hint ? { description: labels.hint } : {}),
      tone: 'success',
    });
    return;
  }
  const uri = res.uri;
  toast({
    title: i18n.t('backup.savedAt', { file: res.location }),
    description: res.how === 'documents' ? i18n.t('backup.savedHint') : undefined,
    tone: 'success',
    duration: 10_000,
    ...(res.how === 'documents'
      ? {
          action: {
            label: i18n.t('backup.share'),
            onClick: () =>
              void import('@/native/files').then((m) =>
                m.shareNativeFile(uri, i18n.t('backup.shareTitle')),
              ),
          },
        }
      : {}),
  });
}

/** "Yedek al" everywhere: save, then show the confirmation. Resolves to success. */
export async function downloadBackup(deps?: BackupDeps): Promise<boolean> {
  const res = await saveBackup(deps);
  showSaveToast(res, {
    done: i18n.t('backup.done'),
    failed: i18n.t('backup.failed'),
    hint: i18n.t('backup.doneHint'),
  });
  return res.ok;
}
