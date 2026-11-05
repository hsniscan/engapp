// App startup: settings row, theme, error log, storage persistence, install prompt, integrity.
import { reconcileDictationCards } from '@/data/dictation';
import { liveQuery } from 'dexie';
import {
  backfillLearningModel,
  ensureStreakFreezes,
  db,
  ensureSettings,
  logError,
  repairDuplicateSenses,
  repairListEntrySentences,
} from '@/data';
import { isNativeApp } from '@/native/platform';
import { scheduleWeeklyLevelUpdate } from '@/features/leveltest/schedule';
import { startReports } from '@/features/report/queue';
import { scheduleStartupIntegrityCheck } from './integrity';
import { captureInstallPrompt, flags, refreshStorageInfo, requestPersistence } from './platform';
import { startThemeSync } from './themeSync';
import { resumePendingDeckAdd } from '@/features/decks/deckAddRunner';
import { startWordBankPrefetch } from '@/features/wordbank/prefetch';

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
/** When persistence was last asked for (ms, as a string): asked again at most weekly. */
const PERSIST_ASKED_AT = 'persistAskedAt';
export const PERSIST_RETRY_MS = 7 * 86_400_000;

/**
 * The first time the device holds a note, ask the browser for persistent storage, and ask again
 * at most once a week while it says no (Chromium grants it later for an app used often or
 * installed). Never a toast (v0.5.3 A5, ADR 0072): the old 15-second warning covered the first
 * card of the first session. A guest whose data is not protected sees one calm notice in
 * Profil instead (StorageNotice), with "Yedek al" and "Hesap aç". The Android app has nothing
 * to ask: its WebView keeps the data until the app is uninstalled (ADR 0064).
 */
export function watchFirstCard(
  native: () => boolean = isNativeApp,
  now: () => number = Date.now,
): () => void {
  if (native()) return () => {};
  if (flags.get(PERSIST_FLAG)) {
    void askAgainIfDue(now());
    return () => {};
  }
  const sub = liveQuery(() => db.notes.limit(1).count()).subscribe({
    next: async (n) => {
      if (n === 0 || flags.get(PERSIST_FLAG)) return;
      flags.set(PERSIST_FLAG, '1');
      sub.unsubscribe();
      flags.set(PERSIST_ASKED_AT, String(now()));
      await requestPersistence();
    },
    error: (e: unknown) => void logError(e, 'persist.watch'),
  });
  return () => sub.unsubscribe();
}

async function askAgainIfDue(at: number): Promise<void> {
  const info = await refreshStorageInfo().catch(() => null);
  if (!info?.supported || info.persisted !== false) return;
  const last = Number(flags.get(PERSIST_ASKED_AT) ?? 0);
  if (at - last < PERSIST_RETRY_MS) return;
  flags.set(PERSIST_ASKED_AT, String(at));
  await requestPersistence().catch(() => null);
}

/** A study session (or its picker) is open: heavy maintenance waits, it would stall cards. */
export function inStudySession(path: string = window.location.pathname): boolean {
  return /^\/(study|review|practice)(\/|$)/.test(path);
}

/**
 * Runs `task` once the first screen has painted and the browser is idle, never during a study
 * session (v0.5.1, decision 0059: on 10,000 cards the dictation scan right after start-up made
 * the first session open in 2 s instead of 1).
 */
export function whenIdle(task: () => Promise<unknown>, isBusy: () => boolean, delayMs = 4000): void {
  const idle = (cb: () => void) =>
    typeof requestIdleCallback === 'function'
      ? requestIdleCallback(cb, { timeout: 10_000 })
      : setTimeout(cb, 0);
  const attempt = () =>
    idle(() => {
      if (isBusy()) {
        setTimeout(attempt, 60_000);
        return;
      }
      void task();
    });
  setTimeout(attempt, delayMs);
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
    const inReview = () => inStudySession();
    // Dikte (v0.5 İP9): dictation cards of senses whose shared sentences are already cached.
    // It reads every sense: after the first paint, outside a session.
    whenIdle(
      () => reconcileDictationCards().catch((e: unknown) => void logError(e, 'bootstrap.dictation')),
      inReview,
    );
    watchFirstCard();
    // v0.5.3 A2: the offline word bank, in the background (online, not metered).
    whenIdle(async () => startWordBankPrefetch(), inReview, 3000);
    // v0.5.3 A1: a ready-deck add cut short (app closed mid-add) finishes now.
    whenIdle(
      () => resumePendingDeckAdd().catch((e: unknown) => void logError(e, 'bootstrap.deckAdd')),
      inReview,
      1500,
    );
    void refreshStorageInfo();
    scheduleStartupIntegrityCheck(inReview);
    scheduleRepairs(inReview);
    scheduleWeeklyLevelUpdate(inReview);
    startReports(inReview);
  })();
}
