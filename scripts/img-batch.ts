/**
 * Nightly picture jobs (v0.4 İP2, decision 0030), run by .github/workflows/images.yml.
 * Logic and tests: scripts/lib/image-jobs.ts; prompts: docs/ai-image.md.
 *
 *   node scripts/img-batch.ts visualize [--limit 1000]
 *       visual-v1 (Haiku) scores senses never scored: lexicon_senses.visualizability/visual_hint.
 *   node scripts/img-batch.ts submit [--max 200]
 *       Queues the senses scoring >= 2 that have no picture, then sends the queued requests as
 *       one Message Batch (half price). Each request's upper-bound cost is reserved first; the
 *       run stops at the monthly cap (80 % of CLAUDE_MONTHLY_CREDIT_USD).
 *   node scripts/img-batch.ts collect [--vision-limit 200]
 *       Reads finished batches: settles the real cost, sanitizes, renders, runs the contrast
 *       and imagecheck-v2 checks, stores passing pictures as 'review'; one redraw after a failed
 *       check. Also runs the vision check the ai-image edge function left pending.
 *
 * Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY (missing: the job
 * is skipped with a notice), CLAUDE_IMAGE_MODEL, CLAUDE_CHECK_MODEL, CLAUDE_MONTHLY_CREDIT_USD.
 * Secrets are read from the environment only and never printed.
 */
import { parseArgs } from 'node:util';
import { runCollect, runSubmit, runVisualize } from './lib/image-jobs.ts';
import { heartbeat } from './lib/heartbeat.ts';
import { haveClaudeKey, jobDepsFromEnv, log } from './lib/image-env.ts';

const JOBS = ['visualize', 'submit', 'collect'] as const;

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      limit: { type: 'string', default: '1000' },
      max: { type: 'string', default: '200' },
      'vision-limit': { type: 'string', default: '200' },
    },
  });
  const job = positionals[0] as (typeof JOBS)[number] | undefined;
  if (!job || !JOBS.includes(job)) {
    console.error(`usage: node scripts/img-batch.ts <${JOBS.join('|')}> [options]`);
    process.exitCode = 2;
    return;
  }
  if (!haveClaudeKey()) return;
  const deps = await jobDepsFromEnv();
  const num = (s: string, name: string) => {
    const n = Number(s);
    if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer`);
    return n;
  };
  let details: Record<string, unknown>;
  if (job === 'visualize') {
    const r = await runVisualize(deps, { limit: num(values.limit, 'limit') });
    log('visualize done', r);
    details = { scored: r.scored, stopped: r.stopped };
  } else if (job === 'submit') {
    const r = await runSubmit(deps, { max: num(values.max, 'max') });
    log('submit done', r);
    details = { queued: r.queued, submitted: r.submitted, stopped: r.stopped };
  } else {
    const r = await runCollect(deps, { visionLimit: num(values['vision-limit'], 'vision-limit') });
    log('collect done', r);
    details = { stored: r.stored, rejected: r.rejected, retried: r.retried };
  }
  log('budget', { ...(await deps.store.budgetStatus()), cap_usd_now: deps.capUsd });
  // Job health: the last step that ended well (a failing step leaves the heartbeat old).
  await heartbeat(deps.db, 'images', 'ok', { step: job, ...details }, log);
}

main().catch((e: unknown) => {
  // Error messages only: the SDK never puts the API key in them.
  console.error(`::error::${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
