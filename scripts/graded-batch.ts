/**
 * Graded reading library job (v0.5 İP5, decision 0047; v0.5.3 decision 0073), run by
 * .github/workflows/graded.yml. Logic and tests: scripts/lib/graded-jobs.ts; prompts:
 * scripts/lib/graded-prompt.ts; planner: scripts/lib/graded-plan.ts; budget:
 * scripts/lib/graded-budget.ts; coverage: supabase/functions/_shared/graded-coverage.ts.
 *
 *   node scripts/graded-batch.ts plan [--per-cell N] [--extended-per-cell 0]
 *       How many texts the grid still needs (library plan: A1–C1 × 10 core topics, 360 texts:
 *       8/8/8/7/5 per topic; --per-cell N asks N per topic on every level instead), per level,
 *       and the estimated and upper-bound cost. Reads only; needs no Claude key.
 *   node scripts/graded-batch.ts submit [--max 120] [--per-cell N] [--extended-per-cell 0] [--dry-run]
 *       Plans the missing slots, then sends the queued writer requests (graded-v2) and the
 *       queued checks (gradedcheck-v1) as Message Batches after reserving each batch's
 *       upper-bound cost on the monthly Claude budget (80 % of CLAUDE_MONTHLY_CREDIT_USD) and
 *       on the library's own monthly cap (GRADED_MONTHLY_USD, default 20 US$).
 *   node scripts/graded-batch.ts collect
 *       Reads finished batches: settles the real cost, runs the coverage check on written
 *       texts (one rewrite after a failure), stores checked texts as approved or rejected.
 *   node scripts/graded-batch.ts bulk [--hours 5.5] [--poll-minutes 5] [--max 400] [...]
 *       collect + submit in a loop until nothing is in flight and nothing more can be sent
 *       (the plan is done or the cap is reached) or the time is up: the whole library in one
 *       run, as far as the batches finish in time (the nightly run picks up the rest).
 *   node scripts/graded-batch.ts report
 *       Counts per level and status, topics, the budget and the newest approved titles.
 *
 * Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY (submit/collect/bulk;
 * missing: skipped with a notice), CLAUDE_GRADED_MODEL (writer; default Sonnet),
 * CLAUDE_CHECK_MODEL (checker; default Haiku), CLAUDE_MONTHLY_CREDIT_USD, GRADED_MONTHLY_USD.
 * Secrets are read from the environment only and never printed.
 */
import { parseArgs } from 'node:util';
import { heartbeat, summary } from './lib/heartbeat.ts';
import { log } from './lib/image-env.ts';
import { monthStartIso } from './lib/graded-budget.ts';
import { gradedDepsFromEnv } from './lib/graded-env.ts';
import { runCollect, runPlan, runReport, runSubmit } from './lib/graded-jobs.ts';
import { FIRST_PLAN, type PlanTargets } from './lib/graded-plan.ts';

const JOBS = ['plan', 'submit', 'collect', 'bulk', 'report'] as const;

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      max: { type: 'string', default: '' },
      'per-cell': { type: 'string', default: '' },
      'extended-per-cell': { type: 'string', default: String(FIRST_PLAN.extendedPerCell) },
      'dry-run': { type: 'boolean', default: false },
      hours: { type: 'string', default: '5.5' },
      'poll-minutes': { type: 'string', default: '5' },
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
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`--${name} must be ${min}..${max}`);
    return n;
  };
  const int = (s: string, name: string, min: number, max: number) => {
    const n = num(s, name, min, max);
    if (!Number.isInteger(n)) throw new Error(`--${name} must be a whole number`);
    return n;
  };
  // --per-cell N: N texts per core topic on every level, instead of the library plan's counts.
  const targets: PlanTargets = values['per-cell']
    ? { ...FIRST_PLAN, perCell: int(values['per-cell'], 'per-cell', 0, 100), perLevel: undefined }
    : { ...FIRST_PLAN };
  targets.extendedPerCell = int(values['extended-per-cell'], 'extended-per-cell', 0, 100);
  const max = int(values.max || (job === 'bulk' ? '400' : '120'), 'max', 1, 2000);

  const budgetLine = async (deps: ReturnType<typeof gradedDepsFromEnv>) => {
    const library = await deps.budgetStore.spentUsd();
    log('budget', {
      claude_month: { ...(await deps.budgetStore.status()), cap_usd_now: deps.budget.capUsd },
      library_month: { spent_or_held_usd: library, cap_usd: deps.budgetStore.capUsd, since: monthStartIso() },
    });
    summary(`- library spend this month: $${library} of its $${deps.budgetStore.capUsd} cap`);
  };

  if (job === 'plan' || job === 'report' || (job === 'submit' && values['dry-run'])) {
    const deps = gradedDepsFromEnv(false);
    if (job === 'plan') {
      const r = await runPlan(deps, targets);
      log('graded plan (nothing sent)', { models: deps.models, ...r });
      summary(`- graded plan: ${r.missing} texts missing, about $${r.estimatedUsd} (upper bound $${r.upperBoundUsd})`);
      for (const [level, n] of Object.entries(r.byLevel)) summary(`  - ${level}: ${n} missing`);
    } else if (job === 'report') {
      const r = await runReport(deps);
      log('graded report', { ...r });
      summary(`- graded library: ${r.approved} approved texts in ${r.topics} topics`);
      for (const [level, c] of Object.entries(r.byLevel))
        summary(`  - ${level}: ${c.approved} approved, ${c.checking} checking, ${c.rejected} rejected`);
      for (const t of r.newest) console.log(`  ${t.level} ${t.topic}: ${t.title}`);
    } else {
      log('graded submit (dry run, nothing sent)', { ...(await runSubmit(deps, { targets, max, dryRun: true })) });
    }
    await budgetLine(deps);
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('::notice::ANTHROPIC_API_KEY is not set: graded library job skipped (docs/setup-backend.md)');
    return;
  }
  const deps = gradedDepsFromEnv(true);
  let details: Record<string, unknown>;
  if (job === 'submit') {
    const r = await runSubmit(deps, { targets, max });
    log('graded submit done', { models: deps.models, ...r });
    details = { step: 'submit', planned: r.planned, write: r.write.submitted, check: r.check.submitted };
  } else if (job === 'collect') {
    const r = await runCollect(deps);
    log('graded collect done', { ...r });
    details = { step: 'collect', written: r.written, approved: r.approved, rejected: r.rejected };
  } else {
    const deadline = Date.now() + num(values.hours, 'hours', 0.1, 6) * 3_600_000;
    const poll = num(values['poll-minutes'], 'poll-minutes', 0.5, 60) * 60_000;
    const total = { rounds: 0, approved: 0, rejected: 0, written: 0, sentWrite: 0, sentCheck: 0, costUsd: 0 };
    for (;;) {
      total.rounds++;
      const c = await runCollect(deps);
      const s = await runSubmit(deps, { targets, max });
      const open = (await deps.store.openBatches()).length;
      total.approved += c.approved;
      total.rejected += c.rejected;
      total.written += c.written;
      total.sentWrite += s.write.submitted;
      total.sentCheck += s.check.submitted;
      total.costUsd += c.costUsd;
      log('graded bulk round', {
        round: total.rounds,
        collected: { written: c.written, approved: c.approved, rejected: c.rejected, rewrites: c.rewrites, problems: c.problems },
        sent: { write: s.write.submitted, check: s.check.submitted, stopped: [s.write.stopped, s.check.stopped] },
        open_batches: open,
      });
      if (open === 0 && s.write.submitted === 0 && s.check.submitted === 0) {
        const budget = s.write.stopped === 'budget' || s.check.stopped === 'budget';
        log('graded bulk finished', { reason: budget ? 'budget' : 'nothing left to send' });
        if (budget) console.log('::notice::The monthly cap stopped the library run; the nightly run continues next month.');
        break;
      }
      if (Date.now() + poll > deadline) {
        console.log('::notice::Time is up: the nightly run collects the open batches and continues.');
        break;
      }
      await new Promise((r) => setTimeout(r, poll));
    }
    total.costUsd = Math.round(total.costUsd * 1e6) / 1e6;
    log('graded bulk done', total);
    summary(`- graded bulk: ${total.approved} approved, ${total.rejected} rejected, $${total.costUsd} in ${total.rounds} rounds`);
    details = { step: 'bulk', ...total };
  }
  await budgetLine(deps);
  await heartbeat(deps.store.db, 'graded', 'ok', details, log);
}

main().catch((e: unknown) => {
  // Error messages only: the SDK never puts the API key in them.
  console.error(`::error::${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
