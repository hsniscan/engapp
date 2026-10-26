// App startup: settings row, theme, error log, storage persistence, install prompt, integrity.
import { liveQuery } from 'dexie';
import {
  backfillLearningModel,
  ensureStreakFreezes,
  db,
  ensureSettings,
  getCurrentUserId,
  logError,
  repairDuplicateSenses,
  repairListEntrySentences,
} from '@/data';
import i18n from '@/i18n';
import { toast } from '@/ui';
import { scheduleWeeklyLevelUpdate } from '@/features/leveltest/schedule';
import { startReports } from '@/features/report/queue';
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

/** One-off data repairs (src/data/repairs.ts), once the app is idle and not in a review. */
function scheduleRepairs(isBusy: () => boolean, delayMs = 5000): void {
  const attempt = () => {
    if (isBusy()) {
      setTimeout(attempt, 60_000);
      return;
    }
    // In order: cutting list prefixes can make two senses' sentences equal.
    void (async () => {
      await repairListEntrySentences().catch((e: unknown) => void logError(e, 'repair.listEntry'));
      await repairDuplicateSenses().catch((e: unknown) => void logError(e, 'repair.duplicateSenses'));
    })();
  };
  setTimeout(attempt, delayMs);
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
    // Learning model (ADR 0041): fill ramp_step / learned_at from the logs once, before the
    // first answer, so the ramp and the stages start from the real history.
    await backfillLearningModel().catch((e: unknown) => void logError(e, 'bootstrap.learningModel'));
    // v0.5 İP10: a missed day since the last visit is covered by a streak protection.
    void ensureStreakFreezes().catch((e: unknown) => void logError(e, 'bootstrap.streakFreezes'));
    watchFirstCard();
    void refreshStorageInfo();
    const inReview = () => /^\/review(\/|$)/.test(window.location.pathname);
    scheduleStartupIntegrityCheck(inReview);
    scheduleRepairs(inReview);
    scheduleWeeklyLevelUpdate(inReview);
    startReports(inReview);
  })();
}
