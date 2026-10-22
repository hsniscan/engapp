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
 *   node scripts/word-bank.ts sample [--limit 30]
 *       Prints the newest model-made bank rows (word, level, meanings, examples) so a person
 *       can check them by eye. Reads only; needs no Claude key.
 *   node scripts/word-bank.ts review-submit [--max 10000] [--dry-run]
 *       Review pass (decision 0040): sends every bank row not yet reviewed, 25 per request, as
 *       one Message Batch to the review model after reserving its upper bound on the budget.
 *       --dry-run prints the rows, requests, estimated and upper-bound cost (no Claude key).
 *   node scripts/word-bank.ts review-collect
 *       Reads finished review batches: settles the cost, checks and applies the corrections
 *       (devices pull changed rows again), prints counts and up to 40 example changes.
 *
 * Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY (submit/collect;
 * missing: skipped with a notice), CLAUDE_WORDBANK_MODEL (else CLAUDE_CHECK_MODEL, else the
 * default Haiku from image-models.ts), CLAUDE_WORDBANK_REVIEW_MODEL (review; else the default
 * Sonnet from image-models.ts), CLAUDE_MONTHLY_CREDIT_USD. Secrets are read from the
 * environment only and never printed.
 */
import { parseArgs } from 'node:util';
import { haveClaudeKey, log, serviceClient } from './lib/image-env.ts';
import { runCollect, runPlan, runSubmit } from './lib/word-bank-jobs.ts';
import { reviewDepsFromEnv, wordBankDepsFromEnv, wordBankModel } from './lib/word-bank-env.ts';
import { runReviewCollect, runReviewSubmit } from './lib/word-bank-review.ts';
import { SupabaseWordBankStore } from './lib/word-bank-store.ts';

const JOBS = ['plan', 'submit', 'collect', 'sample', 'review-submit', 'review-collect'] as const;

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
  if (job === 'sample') {
    const n = values.limit === '20000' ? 30 : Math.min(num(values.limit, 'limit'), 200);
    const { data, error } = await serviceClient()
      .from('word_bank')
      .select('lemma, pos, cefr, senses')
      .not('model', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(n);
    if (error) throw new Error(`word_bank read failed: ${error.message}`);
    for (const row of data ?? []) {
      const senses = row.senses as { meaning_tr: string; example_en: string; example_tr: string }[];
      console.log(`${row.lemma} (${row.pos}, ${row.cefr})`);
      for (const s of senses)
        console.log(`  - ${s.meaning_tr} | ${s.example_en} | ${s.example_tr}`);
    }
    log('word bank sample', { rows: data?.length ?? 0 });
    return;
  }
  if (job === 'review-submit' && values['dry-run']) {
    const deps = reviewDepsFromEnv(false);
    log('word bank review plan (dry run, nothing sent)', {
      model: deps.model,
      ...(await runReviewSubmit(deps, { max: num(values.max, 'max'), dryRun: true })),
    });
    return;
  }
  if (!haveClaudeKey()) return;
  if (job === 'review-submit' || job === 'review-collect') {
    const deps = reviewDepsFromEnv(true);
    if (job === 'review-submit') {
      log('word bank review submit done', {
        model: deps.model,
        ...(await runReviewSubmit(deps, { max: num(values.max, 'max') })),
      });
    } else {
      const { samples, ...report } = await runReviewCollect({ ...deps, batches: deps.batches! });
      log('word bank review collect done', { ...report });
      if (samples.length > 0) console.log(`Example changes (up to ${samples.length}):`);
      for (const s of samples)
        console.log(
          `  ${s.lemma} (${s.pos}) ${s.kind}: ${s.old}${s.new ? `  →  ${s.new}` : ''}  [${s.reason}]`,
        );
    }
    log('budget', { ...(await deps.store.budgetStatus()), cap_usd_now: deps.capUsd });
    return;
  }
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
