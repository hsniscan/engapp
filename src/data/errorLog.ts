import type { ErrorLogRow, Millis } from '../domain/types';
import { db } from './db';

export const ERROR_LOG_LIMIT = 200;

/** Record an uncaught error; keeps only the newest ERROR_LOG_LIMIT rows. Never throws. */
export async function logError(error: unknown, context: string | null = null, now: Millis = Date.now()): Promise<void> {
  try {
    const e = error instanceof Error ? error : new Error(String(error));
    await db.transaction('rw', db.error_log, async () => {
      await db.error_log.add({ at: now, message: e.message, stack: e.stack ?? null, context });
      const count = await db.error_log.count();
      if (count > ERROR_LOG_LIMIT) {
        const old = await db.error_log.orderBy('id').limit(count - ERROR_LOG_LIMIT).primaryKeys();
        await db.error_log.bulkDelete(old);
      }
    });
  } catch {
    // Logging must never break the app.
  }
}

export function listErrors(): Promise<ErrorLogRow[]> {
  return db.error_log.orderBy('id').reverse().toArray();
}

export async function clearErrors(): Promise<void> {
  await db.error_log.clear();
}
