// Weekly report runner (v0.3 İP7, docs/decisions/0027). On the first open after Monday's day
// start the device makes last week's report (data/weeklyReport.ts ensureWeeklyReport); the
// numbers are there at once. The comment comes from ai-report when the device is online and
// signed in; until then the report waits as a draft and the screen says the comment comes
// later. A comment that cannot come (a permanent error, too many failures, a week later) is
// given up: the report is stored without one. One tab runs it.
import { AiClientError } from '@/ai/client';
import {
  REPORT_PROMPT_VERSION,
  requestReportComment,
  type ReportRequest,
  type ReportResponse,
} from '@/ai/report';
import {
  deferReportDraft,
  draftExpired,
  dueReportDrafts,
  ensureWeeklyReport,
  finalizeReportDraft,
  listReportDrafts,
  logError,
} from '@/data';
import { toReportRequest } from '@/domain/weeklyReport';
import { getAccessToken, isBackendConfigured } from '@/lib/supabase';
import { requestSync } from '@/sync';
import { createTabRunner } from '@/sync/lock';

/** After the server's daily AI limit: try again this much later. */
export const REPORT_LIMIT_PAUSE_MS = 6 * 60 * 60_000;
const HOUR = 60 * 60_000;

export interface ReportQueueDeps {
  comment: (input: ReportRequest) => Promise<ReportResponse>;
  /** The build has a backend (a guest-only build never gets a comment). */
  hasBackend: () => boolean;
  isOnline: () => boolean;
  isSignedIn: () => Promise<boolean>;
  now: () => number;
}

export const defaultReportDeps: ReportQueueDeps = {
  comment: (input) => requestReportComment(input),
  hasBackend: () => isBackendConfigured(),
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
  isSignedIn: async () => isBackendConfigured() && (await getAccessToken()) !== null,
  now: () => Date.now(),
};

export type ReportQueueStop = 'idle' | 'offline' | 'signed_out';

const backoffMs = (attempts: number) =>
  Math.min(6 * HOUR, 5 * 60_000 * 4 ** Math.max(0, attempts - 1));

/** Make this week's report if it is due, then ask for the comments that are missing. */
export async function processReports(
  deps: ReportQueueDeps = defaultReportDeps,
): Promise<ReportQueueStop> {
  await ensureWeeklyReport(deps.now());
  for (const d of await listReportDrafts()) {
    if (!deps.hasBackend() || (await draftExpired(d, deps.now())))
      await finalizeReportDraft(d.week, null, deps.now());
  }
  const due = await dueReportDrafts(deps.now());
  if (!due.length) return 'idle';
  if (!deps.isOnline()) return 'offline';
  if (!(await deps.isSignedIn())) return 'signed_out';
  for (const d of due) {
    try {
      const res = await deps.comment(toReportRequest(d.report.summary));
      await finalizeReportDraft(
        d.week,
        {
          text: res.comment,
          model: res.model,
          promptVersion: res.prompt_version || REPORT_PROMPT_VERSION,
        },
        deps.now(),
      );
    } catch (e) {
      const code = e instanceof AiClientError ? e.code : 'unknown';
      if (code === 'unknown') void logError(e, 'report.queue');
      if (code === 'offline') return 'offline';
      if (code === 'not_signed_in' || code === 'unauthorized' || code === 'not_configured')
        return 'signed_out';
      if (code === 'daily_limit') {
        await deferReportDraft(d.week, code, deps.now() + REPORT_LIMIT_PAUSE_MS, false);
        continue;
      }
      const transient = e instanceof AiClientError ? e.transient : true;
      if (!transient) {
        // The answer will not get better by asking again: keep the numbers without a comment.
        await finalizeReportDraft(d.week, null, deps.now());
        continue;
      }
      const retryAfter = e instanceof AiClientError && e.retryAfterS ? e.retryAfterS * 1000 : 0;
      await deferReportDraft(
        d.week,
        code,
        deps.now() + Math.max(retryAfter, backoffMs(d.attempts + 1)),
      );
    }
  }
  return 'idle';
}

// ------------------------------------------------------------------ app wiring

const runner = createTabRunner('engapp-report', () => kickReports());
let running: Promise<unknown> | null = null;
let again = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
/** A review is on screen: the report waits (set by startReports). */
let isBusy: () => boolean = () => false;

/** Run the report queue now (coalesced; a minute later during a review). */
export function kickReports(deps: ReportQueueDeps = defaultReportDeps): void {
  if (isBusy()) {
    setTimeout(() => kickReports(deps), 60_000);
    return;
  }
  if (running) {
    again = true;
    return;
  }
  running = runner
    .run(() => processReports(deps))
    .then(() => requestSync(0))
    .catch((e: unknown) => void logError(e, 'report.queue'))
    .finally(async () => {
      running = null;
      if (again) {
        again = false;
        kickReports(deps);
        return;
      }
      await scheduleRetry(deps);
    });
}

/** Wake up for the earliest draft waiting on a backoff, at most an hour ahead. */
async function scheduleRetry(deps: ReportQueueDeps): Promise<void> {
  if (retryTimer) clearTimeout(retryTimer);
  const next = (await listReportDrafts())
    .map((d) => d.next_attempt_at)
    .filter((t) => t > deps.now())
    .sort((a, b) => a - b)[0];
  const wait = next === undefined ? HOUR : Math.min(HOUR, next - deps.now() + 1_000);
  retryTimer = setTimeout(() => kickReports(deps), wait);
}

let started = false;

/**
 * Start the report runner: shortly after start-up (after the first sync, so a report another
 * device made is here first), then hourly, when the device comes online and on sign-in.
 * Never during a review. Idempotent.
 */
export function startReports(busy: () => boolean = () => false, delayMs = 15_000): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  isBusy = busy;
  window.addEventListener('online', () => kickReports());
  setTimeout(() => kickReports(), delayMs);
}
