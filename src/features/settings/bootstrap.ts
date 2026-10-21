// App startup: settings row, theme, error log, storage persistence, install prompt, integrity.
import { liveQuery } from 'dexie';
import { db, ensureSettings, getCurrentUserId, logError } from '@/data';
import i18n from '@/i18n';
import { toast } from '@/ui';
import { downloadBackup } from './backupActions';
import { scheduleStartupIntegrityCheck } from './integrity';
import { captureInstallPrompt, flags, refreshStorageInfo, requestPersistence } from './platform';
import { startThemeSync } from './themeSync';

let started = false;

/** Uncaught errors and rejections go to the local error log (Ayarlar → Gelişmiş → hata kaydı). */
export function installErrorHandlers(): void {
  window.addEventListener('error', (e) => {
    void logError(e.error ?? e.message, `window.onerror ${e.filename ?? ''}:${e.lineno ?? ''}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    void logError(e.reason, 'unhandledrejection');
  });
}

const PERSIST_FLAG = 'persistAsked';

/**
 * The first time the device holds a note, ask for persistent storage. If the browser says no
 * and the user is a guest, warn once: the browser may evict the data under storage pressure.
 */
export function watchFirstCard(): () => void {
  if (flags.get(PERSIST_FLAG)) return () => {};
  const sub = liveQuery(() => db.notes.limit(1).count()).subscribe({
    next: async (n) => {
      if (n === 0 || flags.get(PERSIST_FLAG)) return;
      flags.set(PERSIST_FLAG, '1');
      sub.unsubscribe();
      const granted = await requestPersistence();
      if (granted === false && !(await getCurrentUserId())) {
        toast({
          title: i18n.t('storage.deniedTitle'),
          description: i18n.t('storage.deniedGuest'),
          tone: 'warn',
          duration: 15_000,
          action: {
            label: i18n.t('backup.download'),
            onClick: () => void downloadBackup(),
          },
        });
      }
    },
    error: (e: unknown) => void logError(e, 'persist.watch'),
  });
  return () => sub.unsubscribe();
}

export function bootstrap(): void {
  if (started) return;
  started = true;
  installErrorHandlers();
  captureInstallPrompt();
  void (async () => {
    try {
      const firstRun = !(await db.settings.get('settings'));
      await ensureSettings();
      startThemeSync(firstRun);
    } catch (e) {
      void logError(e, 'bootstrap.settings');
    }
    watchFirstCard();
    void refreshStorageInfo();
    scheduleStartupIntegrityCheck(() => /^\/review(\/|$)/.test(window.location.pathname));
  })();
}
