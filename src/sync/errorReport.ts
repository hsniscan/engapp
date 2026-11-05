// Sends the device's error log to the server (decision 0076, D4), so errors users hit do not
// stay unseen. Loaded with import() after a successful sync, so it costs the start-up bundle
// nothing and runs only for a signed-in, linked account that is online (the same consent as
// sync; guests send nothing). At most once an hour, at most BATCH entries a time, one row per
// kind of error, scrubbed by src/domain/errorReport.ts. The server keeps 20 rows per user and
// day (client_errors). Never throws.

import { version } from '../../package.json';
import { db, getMeta, setMeta } from '@/data';
import { toReportRows, type ClientErrorRow } from '@/domain/errorReport';
import { loadSupabase } from '@/lib/supabase';
import { isNativeApp } from '@/native/platform';

/** Meta keys: the id of the last error-log row sent, and when the last report went out. */
export const REPORT_CURSOR = 'error_report_cursor';
export const REPORT_AT = 'error_report_at';
export const REPORT_EVERY_MS = 60 * 60 * 1000;
export const BATCH = 10;

export interface ReportSink {
  insert(rows: ClientErrorRow[]): Promise<{ error: { message: string } | null }>;
}

async function supabaseSink(): Promise<ReportSink | null> {
  const c = await loadSupabase();
  if (!c) return null;
  return { insert: async (rows) => await c.from('client_errors').insert(rows) };
}

function platform(): ClientErrorRow['platform'] {
  if (isNativeApp()) return 'android';
  try {
    return typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches ? 'pwa' : 'web';
  } catch {
    return 'web';
  }
}

/** Sends the next batch of new error-log entries; returns how many rows went out. */
export async function reportErrors(now = Date.now(), sink?: ReportSink | null): Promise<number> {
  try {
    const last = (await getMeta<number>(REPORT_AT)) ?? 0;
    if (now - last < REPORT_EVERY_MS) return 0;
    let cursor = await getMeta<number>(REPORT_CURSOR);
    if (cursor === undefined) {
      // First run on this device: only the newest entries, not a backlog from old versions.
      const newest = (await db.error_log.orderBy('id').last())?.id ?? 0;
      cursor = Math.max(0, newest - BATCH);
    }
    const entries = await db.error_log.where('id').above(cursor).limit(BATCH).toArray();
    if (entries.length === 0) return 0;
    const lastId = entries[entries.length - 1]!.id!;
    const rows = toReportRows(entries, version, platform());
    const s = sink === undefined ? await supabaseSink() : sink;
    if (!s) return 0;
    // Mark the attempt first: a failing server is tried again in an hour, not on every sync.
    await setMeta(REPORT_AT, now);
    if (rows.length > 0) {
      const { error } = await s.insert(rows);
      if (error) return 0; // kept for the next try (also before the migration is deployed)
    }
    await setMeta(REPORT_CURSOR, lastId);
    return rows.length;
  } catch {
    return 0;
  }
}
