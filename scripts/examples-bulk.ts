/**
 * Bulk example sentences for the Kelime Bankası (v0.5.3 C2, decision 0074), run by
 * .github/workflows/examples-bulk.yml. Logic and tests: scripts/lib/example-bulk-jobs.ts;
 * prompts: scripts/lib/example-bulk-prompt.ts; Tatoeba matching: scripts/lib/example-match.ts.
 *
 *   node scripts/examples-bulk.ts plan
 *       Senses, how many sentences are still wanted, the job's items by state, a rough cost
 *       estimate per step and what the job has spent. Reads only; needs no Claude key.
 *   node scripts/examples-bulk.ts match (--official <dir> | --manythings <tur.txt>) [--rematch] [--dry-run]
 *       Free. Reads the Tatoeba English–Turkish pairs (official per-language exports in <dir>:
 *       eng_sentences_detailed.tsv, tur_sentences_detailed.tsv, eng-tur_links.tsv; or
 *       manythings' tur.txt) and stores the pairs that fit each bank row as candidates.
 *   node scripts/examples-bulk.ts run [--max 2000] [--dry-run] [--without-match]
 *       Collects finished batches, publishes what the review approved, then sends the next
 *       batches: tagging (Tatoeba pairs → meanings), generation (what Tatoeba could not fill)
 *       and review. Each batch's upper bound is reserved on the shared monthly Claude budget
 *       and must fit EXAMPLES_BULK_CAP_USD. --dry-run: no writes, nothing sent (no key needed).
 *   node scripts/examples-bulk.ts collect | publish
 *       One step only.
 *   node scripts/examples-bulk.ts sample [--limit 40]
 *       Prints approved or published sentences for a person to read.
 *
 * Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY (run/collect; missing:
 * skipped with a notice), CLAUDE_EXAMPLES_MODEL (else the word-bank model, a Haiku),
 * CLAUDE_EXAMPLES_REVIEW_MODEL (else the word-bank review model, a Sonnet),
 * CLAUDE_MONTHLY_CREDIT_USD, EXAMPLES_BULK_CAP_USD (default 15). Secrets are read from the
 * environment only and never printed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { monthlyCapUsd } from '../supabase/functions/_shared/image-models.ts';
import { createAnthropic } from '../supabase/functions/_shared/image-claude.ts';
import {
  jobCapUsd,
  runCollect,
  runGenerateSubmit,
  runMatch,
  runPlan,
  runPublish,
  runReviewSubmit,
  runTagSubmit,
  type ExampleBulkDeps,
} from './lib/example-bulk-jobs.ts';
import { SupabaseExampleBulkStore } from './lib/example-bulk-store.ts';
import { PairIndex, parseLevelIndex } from './lib/example-match.ts';
import { haveClaudeKey, log, serviceClient } from './lib/image-env.ts';
import type { BatchApi, BatchResult } from './lib/image-jobs.ts';
import { readManythingsPairs, readOfficialPairs } from './lib/tatoeba.ts';
import { wordBankModel, wordBankReviewModel } from './lib/word-bank-env.ts';

type Env = (key: string) => string | undefined;
const env: Env = (k) => process.env[k] || undefined;

const JOBS = ['plan', 'match', 'run', 'collect', 'publish', 'sample'] as const;

function batchApi(): BatchApi {
  const client = createAnthropic(env, { timeoutMs: 600_000 });
  return {
    create: (requests) => client.messages.batches.create({ requests }),
    retrieve: (id) => client.messages.batches.retrieve(id),
    results: async (id) =>
      (await client.messages.batches.results(id)) as unknown as AsyncIterable<BatchResult>,
  };
}

function deps(store: SupabaseExampleBulkStore, withClaude: boolean): ExampleBulkDeps {
  const none: BatchApi = {
    create: () => Promise.reject(new Error('no Claude key')),
    retrieve: () => Promise.reject(new Error('no Claude key')),
    results: () => Promise.reject(new Error('no Claude key')),
  };
  return {
    store,
    batches: withClaude ? batchApi() : none,
    model: env('CLAUDE_EXAMPLES_MODEL')?.trim() || wordBankModel(env),
    reviewModel: env('CLAUDE_EXAMPLES_REVIEW_MODEL')?.trim() || wordBankReviewModel(env),
    capUsd: monthlyCapUsd(env),
    jobCapUsd: jobCapUsd(env),
    log,
  };
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      max: { type: 'string', default: '2000' },
      limit: { type: 'string', default: '40' },
      official: { type: 'string' },
      manythings: { type: 'string' },
      levels: { type: 'string', default: 'data/levels/client-levels.tsv' },
      rematch: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'without-match': { type: 'boolean', default: false },
    },
  });
  const job = positionals[0] as (typeof JOBS)[number] | undefined;
  if (!job || !JOBS.includes(job)) {
    console.error(`usage: node scripts/examples-bulk.ts <${JOBS.join('|')}> [options]`);
    process.exitCode = 2;
    return;
  }
  const max = Number(values.max);
  if (!Number.isInteger(max) || max < 1 || max > 10000) throw new Error('--max must be 1..10000');
  const dryRun = values['dry-run'];
  const store = new SupabaseExampleBulkStore(serviceClient());

  if (job === 'plan') {
    const d = deps(store, false);
    log('examples plan', { model: d.model, review_model: d.reviewModel, ...(await runPlan(d)) });
    return;
  }
  if (job === 'match') {
    const pairs = values.official
      ? await readOfficialPairs({
          links: join(values.official, 'eng-tur_links.tsv'),
          eng: join(values.official, 'eng_sentences_detailed.tsv'),
          tur: join(values.official, 'tur_sentences_detailed.tsv'),
        })
      : values.manythings
        ? await readManythingsPairs(values.manythings)
        : null;
    if (!pairs) throw new Error('match needs --official <dir> or --manythings <file>');
    const index = new PairIndex(pairs);
    log('tatoeba pairs read', { pairs: pairs.length, usable: index.pairs.length });
    const levels = parseLevelIndex(readFileSync(values.levels, 'utf8'));
    log('examples match done', {
      ...(await runMatch({ store, log }, index, levels, { rematch: values.rematch, dryRun })),
    });
    return;
  }
  if (job === 'publish') {
    log('examples publish done', { ...(await runPublish({ store, log }, { dryRun })) });
    return;
  }
  if (job === 'sample') {
    const n = Math.min(Math.max(Number(values.limit) || 40, 1), 200);
    const items = (await store.items(['approved', 'published'])).slice(-n);
    for (const it of items)
      console.log(
        `${it.lemma_norm} (${it.pos}) [${it.source}, ${it.context}] ${it.text_en} | ${it.text_tr}${it.review_note ? `  (${it.review_note})` : ''}`,
      );
    log('examples sample', { rows: items.length });
    return;
  }
  if (dryRun) {
    const d = deps(store, false);
    for (const step of [runTagSubmit, runGenerateSubmit, runReviewSubmit])
      log('examples submit plan (dry run, nothing sent)', { ...(await step(d, { max, dryRun: true })) });
    log('examples publish plan (dry run)', { ...(await runPublish(d, { dryRun: true })) });
    return;
  }
  if (!haveClaudeKey()) return;
  const d = deps(store, true);
  const { samples, ...collected } = await runCollect(d);
  log('examples collect done', { ...collected });
  if (samples.length > 0) console.log(`Review changes (up to ${samples.length}):`);
  for (const s of samples)
    console.log(`  ${s.lemma} ${s.kind}: ${s.old}${s.new ? `  →  ${s.new}` : ''}  [${s.reason}]`);
  if (job === 'run') {
    log('examples publish done', { ...(await runPublish(d)) });
    log('examples tag submit', { model: d.model, ...(await runTagSubmit(d, { max })) });
    log('examples generate submit', {
      model: d.model,
      ...(await runGenerateSubmit(d, { max, withoutMatch: values['without-match'] })),
    });
    log('examples review submit', { model: d.reviewModel, ...(await runReviewSubmit(d, { max })) });
  }
  log('budget', {
    ...(await store.budgetStatus()),
    cap_usd_now: d.capUsd,
    job_spent_usd: await store.spent(),
    job_cap_usd: d.jobCapUsd,
  });
}

main().catch((e: unknown) => {
  console.error(`::error::${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
