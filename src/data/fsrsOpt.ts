// Personal FSRS parameters (v0.3 İP4, docs/decisions/0022): the data side. The optimizer
// itself is pure (domain/fsrsOptimizer.ts) and runs in a worker; this file reads the review
// history for it and stores its outcome. Nothing here talks to the network: the history never
// leaves the device, only the resulting settings row syncs like any other setting.
import { createScheduler } from '../domain/fsrs';
import type { DatasetLog } from '../domain/fsrsOptimizer';
import { effectiveLogs } from '../domain/recompute';
import type { Millis, Settings } from '../domain/types';
import { db } from './db';
import { recomputeCardsIn } from './maintenance';
import { defaultSettings, SETTINGS_ID } from './settings';
import { writeTx } from './writer';

/** Answers that count (undo rows and the answers they cancel removed), oldest first. */
export async function loadOptimizerLogs(): Promise<DatasetLog[]> {
  return effectiveLogs(await db.review_logs.toArray()).map((l) => ({
    card_id: l.card_id,
    rating: l.rating,
    reviewed_at: l.reviewed_at,
  }));
}

export interface ReviewCounts {
  /** Non-undone answers in total (Anki imports included). */
  total: number;
  /** …of which answered after the last optimizer run (all when it never ran). */
  sinceLastRun: number;
}

export async function countOptimizerReviews(lastRunAt: Millis | null | undefined): Promise<ReviewCounts> {
  const logs = effectiveLogs(await db.review_logs.toArray());
  const since = lastRunAt ?? -Infinity;
  return { total: logs.length, sinceLastRun: logs.filter((l) => l.reviewed_at > since).length };
}

/**
 * Store a settings change to the FSRS parameters and replay every card from its logs with
 * them, in one transaction (invariant: a card's FSRS state is the replay of its logs).
 */
async function writeParams(
  patch: Pick<Settings, 'fsrs_params' | 'fsrs_params_prev' | 'fsrs_opt_at'>,
  now: Millis,
): Promise<number> {
  return writeTx([db.settings, db.cards, db.review_logs], now, async (w) => {
    const current = (await db.settings.get(SETTINGS_ID)) ?? defaultSettings(now, w.userId);
    const next: Settings = { ...current, ...patch };
    createScheduler(next); // throws on params ts-fsrs would not accept
    await w.put('settings', next);
    return recomputeCardsIn(w, 'all');
  });
}

/** Use these personal parameters; the ones in use now become the "Eski ayar". */
export async function adoptFsrsParams(params: number[], now: Millis = Date.now()): Promise<number> {
  const current = await db.settings.get(SETTINGS_ID);
  return writeParams(
    { fsrs_params: params, fsrs_params_prev: current?.fsrs_params ?? null, fsrs_opt_at: now },
    now,
  );
}

/** "Eski ayara dön": back to the previous parameters (the defaults when there were none). */
export async function revertFsrsParams(now: Millis = Date.now()): Promise<number> {
  const current = await db.settings.get(SETTINGS_ID);
  return writeParams(
    {
      fsrs_params: current?.fsrs_params_prev ?? null,
      fsrs_params_prev: null,
      fsrs_opt_at: current?.fsrs_opt_at ?? null,
    },
    now,
  );
}

/** A run that kept the current parameters: only remember when it ran (for the monthly offer). */
export async function markFsrsOptRun(now: Millis = Date.now()): Promise<void> {
  await writeTx([db.settings], now, async (w) => {
    const current = (await db.settings.get(SETTINGS_ID)) ?? defaultSettings(now, w.userId);
    await w.put('settings', { ...current, fsrs_opt_at: now });
  });
}
