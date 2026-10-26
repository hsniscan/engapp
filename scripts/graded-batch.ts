/**
 * Graded reading library job (v0.5 İP5, decision 0047), run by .github/workflows/graded.yml.
 * Logic and tests: scripts/lib/graded-jobs.ts; prompts: scripts/lib/graded-prompt.ts;
 * planner: scripts/lib/graded-plan.ts; coverage: supabase/functions/_shared/graded-coverage.ts.
 *
 *   node scripts/graded-batch.ts plan [--per-cell 9] [--extended-per-cell 0]
 *       How many texts the grid still needs (first plan: A2–C1 × 10 core topics × 9 = 360),
 *       per level, and the estimated and upper-bound cost. Reads only; needs no Claude key.
 *   node scripts/graded-batch.ts submit [--max 120] [--per-cell 9] [--extended-per-cell 0] [--dry-run]
 *       Plans the missing slots, then sends the queued writer requests (graded-v1) and the
 *       queued checks (gradedcheck-v1) as Message Batches after reserving each batch's
 *       upper-bound cost on the monthly text budget (CLAUDE_TEXT_MONTHLY_USD, default 10).
 *       The workflow runs it only when the repository variable GRADED_BULK is 'true'.
 *   node scripts/graded-batch.ts collect
 *       Reads finished batches: settles the real cost, runs the coverage check on written
 *       texts (one rewrite after a failure), stores checked texts as approved or rejected.
 *   node scripts/graded-batch.ts report
 *       Counts per level and status, topics, the budget and the newest approved titles.
 *
 * Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY (submit/collect;
 * missing: skipped with a notice), CLAUDE_GRADED_MODEL (writer; default Sonnet),
 * CLAUDE_CHECK_MODEL (checker; default Haiku), CLAUDE_TEXT_MONTHLY_USD. Secrets are read from
 * the environment only and never printed.
 */
import { parseArgs } from 'node:util';
import { heartbeat, summary } from './lib/heartbeat.ts';
import { log } from './lib/image-env.ts';
import { gradedDepsFromEnv } from './lib/graded-env.ts';
import { runCollect, runPlan, runReport, runSubmit } from './lib/graded-jobs.ts';
import { FIRST_PLAN, type PlanTargets } from './lib/graded-plan.ts';

const JOBS = ['plan', 'submit', 'collect', 'report'] as const;

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      max: { type: 'string', default: '120' },
      'per-cell': { type: 'string', default: String(FIRST_PLAN.perCell) },
      'extended-per-cell': { type: 'string', default: String(FIRST_PLAN.extendedPerCell) },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const job = positionals[0] as (typeof JOBS)[number] | undefined;
  if (!job || !JOBS.includes(job)) {
    console.error(`usage: node scripts/graded-batch.ts <${JOBS.join('|')}> [options]`);
    process.exitCode = 2;
    return;
  }
  const num = (s: string, name: string, min: number, max: number) => {
    const n = Number(s);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`--${name} must be ${min}..${max}`);
    return n;
  };
  const targets: PlanTargets = {
    ...FIRST_PLAN,
    perCell: num(values['per-cell'], 'per-cell', 0, 100),
    extendedPerCell: num(values['extended-per-cell'], 'extended-per-cell', 0, 100),
  };

  if (job === 'plan' || job === 'report' || (job === 'submit' && values['dry-run'])) {
    const deps = gradedDepsFromEnv(false);
    if (job === 'plan') {
      const r = await runPlan(deps, targets);
      log('graded plan (nothing sent)', { models: deps.models, ...r });
      summary(`- graded plan: ${r.missing} texts missing, about $${r.estimatedUsd} (upper bound $${r.upperBoundUsd})`);
    } else if (job === 'report') {
      const r = await runReport(deps);
      log('graded report', { ...r });
      summary(`- graded library: ${r.approved} approved texts in ${r.topics} topics`);
      for (const [level, c] of Object.entries(r.byLevel))
        summary(`  - ${level}: ${c.approved} approved, ${c.checking} checking, ${c.rejected} rejected`);
      for (const t of r.newest) console.log(`  ${t.level} ${t.topic}: ${t.title}`);
    } else {
      log('graded submit (dry run, nothing sent)', {
        ...(await runSubmit(deps, { targets, max: num(values.max, 'max', 1, 2000), dryRun: true })),
      });
    }
    log('text budget', { ...(await deps.budgetStore.status()), cap_usd_now: deps.budget.capUsd });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('::notice::ANTHROPIC_API_KEY is not set: graded library job skipped (docs/setup-backend.md)');
    return;
  }
  const deps = gradedDepsFromEnv(true);
  let details: Record<string, unknown>;
  if (job === 'submit') {
    const r = await runSubmit(deps, { targets, max: num(values.max, 'max', 1, 2000) });
    log('graded submit done', { models: deps.models, ...r });
    details = { step: 'submit', planned: r.planned, write: r.write.submitted, check: r.check.submitted };
  } else {
    const r = await runCollect(deps);
    log('graded collect done', { ...r });
    details = { step: 'collect', written: r.written, approved: r.approved, rejected: r.rejected };
  }
  log('text budget', { ...(await deps.budgetStore.status()), cap_usd_now: deps.budget.capUsd });
  await heartbeat(deps.store.db, 'graded', 'ok', details, log);
}

main().catch((e: unknown) => {
  // Error messages only: the SDK never puts the API key in them.
  console.error(`::error::${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
