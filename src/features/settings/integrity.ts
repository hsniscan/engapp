import { useSyncExternalStore } from 'react';
import { compactGuestOutbox, logError, repairIntegrity, runIntegrityCheck } from '@/data';
import type { IntegrityReport } from '@/domain/integrity';
import { flags } from './platform';

/** Problems worth a "Veri onarımı" button (logs without a card may still arrive by sync). */
export function integrityProblems(r: IntegrityReport): number {
  return (
    r.orphanCards.length +
    r.orphanSenses.length +
    r.cardsWithoutSense.length +
    r.notesWithoutRecognition.length +
    r.stuckOutbox.length
  );
}

let report: IntegrityReport | null = null;
let checkedAt: number | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let snapshot: { report: IntegrityReport | null; checkedAt: number | null } = { report, checkedAt };

export async function checkIntegrityNow(): Promise<IntegrityReport | null> {
  try {
    report = await runIntegrityCheck();
    checkedAt = Date.now();
    snapshot = { report, checkedAt };
    emit();
    return report;
  } catch (e) {
    void logError(e, 'integrity.check');
    return null;
  }
}

const LAST_CHECK_FLAG = 'integrityCheckedAt';
const CHECK_EVERY_MS = 24 * 3600_000;

/**
 * The startup check (with guest outbox compaction) reads every note, card and review log, which costs seconds of main-thread
 * work on a large collection (10,000 cards: ~3 s). It runs at most once a day, when the
 * browser is idle, and never while a review session is open (it would stall card switches).
 */
export function scheduleStartupIntegrityCheck(isBusy: () => boolean, delayMs = 8000): void {
  const last = Number(flags.get(LAST_CHECK_FLAG) ?? 0);
  if (Date.now() - last < CHECK_EVERY_MS) return;
  const idle = (cb: () => void) =>
    typeof requestIdleCallback === 'function'
      ? requestIdleCallback(cb, { timeout: 30_000 })
      : setTimeout(cb, 0);
  const attempt = () =>
    idle(() => {
      if (isBusy()) {
        setTimeout(attempt, 60_000);
        return;
      }
      flags.set(LAST_CHECK_FLAG, String(Date.now()));
      // A guest's outbox keeps every write until the first sign-in; keep one entry per row.
      void compactGuestOutbox()
        .catch((e: unknown) => logError(e, 'outbox.compact'))
        .then(() => checkIntegrityNow());
    });
  setTimeout(attempt, delayMs);
}

export async function repairNow(): Promise<IntegrityReport | null> {
  const res = await repairIntegrity();
  report = res.after;
  checkedAt = Date.now();
  snapshot = { report, checkedAt };
  emit();
  return res.after;
}

export function useIntegrity(): { report: IntegrityReport | null; checkedAt: number | null } {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
    () => snapshot,
  );
}
