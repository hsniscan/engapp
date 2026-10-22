// Job health (v0.4 İP10, decision 0037): every nightly job writes one heartbeat row at the end
// of a run (public.job_runs through job_heartbeat), and reads the others' rows, so a job that
// silently stopped running (a schedule GitHub disabled or dropped, a missing secret) shows up as
// a warning in the next run of any job and in the run summary. Never fails a run: a database
// without the function (migration not deployed yet) only logs a line.

import { appendFileSync } from 'node:fs';

/** The jobs that report, and after how many hours without a good run they count as late. */
export const NIGHTLY_JOBS: Record<string, number> = { levels: 36, images: 36 };

export type JobStatus = 'ok' | 'partial' | 'failed' | 'skipped';

export interface JobRunRow {
  job: string;
  status: JobStatus;
  last_run_at: string;
  last_ok_at: string | null;
}

/** Minimal RPC surface (SupabaseClient satisfies it). */
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

type Log = (msg: string, data?: Record<string, unknown>) => void;

/** Jobs whose last good run is older than their limit (or that never had one), oldest first. */
export function lateJobs(
  rows: JobRunRow[],
  now: Date,
  limits: Record<string, number> = NIGHTLY_JOBS,
): { job: string; hours: number | null }[] {
  const out: { job: string; hours: number | null }[] = [];
  for (const [job, maxHours] of Object.entries(limits)) {
    const row = rows.find((r) => r.job === job);
    const ok = row?.last_ok_at ? Date.parse(row.last_ok_at) : NaN;
    if (Number.isNaN(ok)) {
      // Never reported: late only once it has run at all (a new job is not an alarm).
      if (row) out.push({ job, hours: null });
      continue;
    }
    const hours = (now.getTime() - ok) / 3_600_000;
    if (hours > maxHours) out.push({ job, hours: Math.round(hours) });
  }
  return out.sort((a, b) => (b.hours ?? Infinity) - (a.hours ?? Infinity));
}

/** One line for $GITHUB_STEP_SUMMARY (when set) — the run page shows it. */
export function summary(line: string): void {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (!f) return;
  try {
    appendFileSync(f, `${line}\n`);
  } catch {
    // The summary is a convenience; never fail a job over it.
  }
}

/**
 * Stores this run's heartbeat and warns about late jobs. details: small counters only
 * (never user text).
 */
export async function heartbeat(
  c: RpcClient,
  job: string,
  status: JobStatus,
  details: Record<string, unknown>,
  log: Log,
  now = new Date(),
): Promise<void> {
  try {
    const w = await c.rpc('job_heartbeat', { p_job: job, p_status: status, p_details: details });
    if (w.error) throw new Error(w.error.message);
    const r = await c.rpc('job_health');
    if (r.error) throw new Error(r.error.message);
    const late = lateJobs((r.data ?? []) as JobRunRow[], now);
    for (const l of late) {
      const msg =
        l.hours === null
          ? `Job '${l.job}' has run but never finished well`
          : `Job '${l.job}' has not finished well for ${l.hours} hours`;
      console.log(`::warning::${msg} (docs/setup-backend.md, "Job health")`);
      summary(`- **Late:** ${msg}`);
    }
    summary(`- ${job}: ${status} at ${now.toISOString()}`);
  } catch (e) {
    log('heartbeat not stored', { error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
    summary(`- ${job}: ${status} at ${now.toISOString()} (heartbeat not stored)`);
  }
}
