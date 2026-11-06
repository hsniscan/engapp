// Run-once gate of the scheduled workflows (decision 0076). pg_cron starts each nightly job on
// time through workflow_dispatch (trigger=cron); GitHub's own `schedule` stays as a backstop
// and usually arrives hours later. Both kinds of run are "automatic" and carry the slot in
// their run name ("… [auto:<slot>]"). An automatic run skips itself when another automatic
// run of the same slot finished well, or is still running, within the window, so a job never
// runs twice for one night. A manual run (Run workflow button) always runs.
//
//   node scripts/ci-gate.ts <slot> <window-minutes> [any]
// `any`: a finished run counts even when it failed (the health check: its failure IS the
// alarm e-mail, and a second failing run would only send the same e-mail again).
// Env (Actions): GITHUB_TOKEN (actions: read), GITHUB_REPOSITORY, GITHUB_RUN_ID,
//   GITHUB_EVENT_NAME, GITHUB_OUTPUT, GITHUB_WORKFLOW_REF, TRIGGER (the dispatch input).
// Writes run=true|false to $GITHUB_OUTPUT. Any API problem means run=true: a second backup
// is cheap, a missing one is not.

import { appendFileSync } from 'node:fs';

export interface RunInfo {
  id: number;
  display_title: string;
  event: string;
  status: string; // queued | in_progress | completed | waiting | pending | requested
  conclusion: string | null;
  created_at: string;
}

export interface GateInput {
  slot: string;
  windowMinutes: number;
  event: string;
  trigger: string;
  runId: number;
  now: Date;
  runs: RunInfo[];
  /** A failed run also counts as done (see `any` above). */
  anyConclusion?: boolean;
}

export const autoTag = (slot: string): string => `[auto:${slot}]`;

/** Is this run automatic (pg_cron dispatch or GitHub schedule)? */
export function isAutomatic(event: string, trigger: string): boolean {
  return event === 'schedule' || (event === 'workflow_dispatch' && trigger === 'cron');
}

/** null: run; otherwise the reason to skip. */
export function skipReason(i: GateInput): string | null {
  if (!isAutomatic(i.event, i.trigger)) return null;
  const since = i.now.getTime() - i.windowMinutes * 60_000;
  const tag = autoTag(i.slot);
  for (const r of i.runs) {
    if (r.id === i.runId || !r.display_title.includes(tag)) continue;
    const at = Date.parse(r.created_at);
    if (Number.isNaN(at) || at < since) continue;
    if (r.status === 'completed' && r.conclusion === 'success')
      return `run ${r.id} (${r.event}) already finished well at ${r.created_at}`;
    if (r.status === 'completed' && i.anyConclusion && r.conclusion === 'failure')
      return `run ${r.id} (${r.event}) already ran (and failed) at ${r.created_at}`;
    // An earlier automatic run is still going: it does tonight's work. (The concurrency
    // group queues this run behind it, so by now it has usually finished; this covers a run
    // GitHub started in parallel.)
    if (r.status !== 'completed' && r.id < i.runId) return `run ${r.id} (${r.event}) is still running`;
  }
  return null;
}

async function main(): Promise<void> {
  const [slot, windowArg, mode] = process.argv.slice(2);
  const windowMinutes = Number(windowArg);
  const out = (run: boolean) => {
    const f = process.env.GITHUB_OUTPUT;
    if (f) appendFileSync(f, `run=${run}\n`);
  };
  if (!slot || !/^[a-z0-9-]{1,40}$/.test(slot) || !Number.isInteger(windowMinutes) || windowMinutes < 1) {
    console.log('::error::usage: node scripts/ci-gate.ts <slot> <window-minutes>');
    process.exit(2);
  }
  const event = process.env.GITHUB_EVENT_NAME ?? '';
  const trigger = process.env.TRIGGER ?? '';
  if (!isAutomatic(event, trigger)) {
    console.log(`Manual run (${event}): runs.`);
    return out(true);
  }
  const repo = process.env.GITHUB_REPOSITORY ?? '';
  const runId = Number(process.env.GITHUB_RUN_ID);
  // owner/repo/.github/workflows/<file>@ref → <file>
  const file = /\/\.github\/workflows\/([^@]+)@/.exec(process.env.GITHUB_WORKFLOW_REF ?? '')?.[1];
  const now = new Date();
  try {
    if (!repo || !file || !runId) throw new Error('GITHUB_REPOSITORY / GITHUB_WORKFLOW_REF / GITHUB_RUN_ID missing');
    const created = new Date(now.getTime() - windowMinutes * 60_000).toISOString();
    const url =
      `https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(file)}/runs` +
      `?per_page=50&created=${encodeURIComponent(`>=${created}`)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN ?? ''}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const body = (await res.json()) as { workflow_runs?: RunInfo[] };
    const reason = skipReason({ slot, windowMinutes, event, trigger, runId, now, runs: body.workflow_runs ?? [],
      anyConclusion: mode === 'any',
    });
    if (reason) {
      console.log(`::notice::Skipped: ${reason} (decision 0076, run once per slot).`);
      return out(false);
    }
    console.log(`No other automatic '${slot}' run in the last ${windowMinutes} minutes: runs.`);
    out(true);
  } catch (e) {
    console.log(`::warning::Could not check earlier runs (${e instanceof Error ? e.message : String(e)}): runs anyway.`);
    out(true);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
