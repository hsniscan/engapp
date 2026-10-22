/**
 * Kelime Bankası generation job (decision 0038), run by .github/workflows/word-bank.yml.
 * Logic and tests: scripts/lib/word-bank-jobs.ts; prompt: scripts/lib/word-bank-prompt.ts.
 *
 *   node scripts/word-bank.ts plan [--limit 20000]
 *       How many list words still need a bank row, how many the lexicon covers (no model
 *       call), and the estimated cost. Reads only; needs no Claude key.
 *   node scripts/word-bank.ts submit [--max 10000] [--dry-run]
 *       Stores the rows the lexicon covers, then sends the rest as one Message Batch after
 *       reserving its upper-bound cost on the monthly Claude budget (80 % of
 *       CLAUDE_MONTHLY_CREDIT_USD, shared with the picture jobs).
 *   node scripts/word-bank.ts collect
 *       Reads finished batches: settles the real cost, checks the answers, stores new meanings
 *       in the lexicon and the bank rows; rejected answers are asked again next run.
 *
 * Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY (submit/collect;
 * missing: skipped with a notice), CLAUDE_WORDBANK_MODEL (else CLAUDE_CHECK_MODEL, else the
 * default Haiku from image-models.ts), CLAUDE_MONTHLY_CREDIT_USD. Secrets are read from the
 * environment only and never printed.
 */
import { parseArgs } from 'node:util';
import { haveClaudeKey, log, serviceClient } from './lib/image-env.ts';
import { runCollect, runPlan, runSubmit } from './lib/word-bank-jobs.ts';
import { wordBankDepsFromEnv, wordBankModel } from './lib/word-bank-env.ts';
import { SupabaseWordBankStore } from './lib/word-bank-store.ts';

const JOBS = ['plan', 'submit', 'collect'] as const;

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      limit: { type: 'string', default: '20000' },
      max: { type: 'string', default: '10000' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const job = positionals[0] as (typeof JOBS)[number] | undefined;
  if (!job || !JOBS.includes(job)) {
    console.error(`usage: node scripts/word-bank.ts <${JOBS.join('|')}> [options]`);
    process.exitCode = 2;
    return;
  }
  const num = (s: string, name: string) => {
    const n = Number(s);
    if (!Number.isInteger(n) || n < 1 || n > 20000) throw new Error(`--${name} must be 1..20000`);
    return n;
  };
  if (job === 'plan') {
    const store = new SupabaseWordBankStore(serviceClient());
    const model = wordBankModel((k) => process.env[k] || undefined);
    log('word bank plan', {
      model,
      ...(await runPlan({ store, model }, { limit: num(values.limit, 'limit') })),
    });
    return;
  }
  if (!haveClaudeKey()) return;
  const deps = await wordBankDepsFromEnv();
  if (job === 'submit') {
    log('word bank submit done', {
      model: deps.model,
      ...(await runSubmit(deps, { max: num(values.max, 'max'), dryRun: values['dry-run'] })),
    });
  } else {
    log('word bank collect done', { ...(await runCollect(deps)) });
  }
  log('budget', { ...(await deps.store.budgetStatus()), cap_usd_now: deps.capUsd });
}

main().catch((e: unknown) => {
  console.error(`::error::${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
