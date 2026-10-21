import { useSyncExternalStore } from 'react';
import { logError, repairIntegrity, runIntegrityCheck } from '@/data';
import type { IntegrityReport } from '@/domain/integrity';

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
