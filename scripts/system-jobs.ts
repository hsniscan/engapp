/**
 * Server-side system jobs (v0.2 İP2), run by .github/workflows/level-jobs.yml every night
 * and on demand. Uses the service role and the system AI budget (public.ai_system_consume,
 * AI_SYSTEM_DAILY_LIMIT calls per UTC day), never a user's budget. Prompts and pure steps:
 * supabase/functions/_shared/level-job.ts; docs: docs/ai-pipeline.md ("Level job").
 *
 *   node scripts/system-jobs.ts levels [--dry-run] [--no-ai] [--max-calls N] [--max-minutes 40]
 *       1. resolve: bring every lexicon sense's stored level and every term's zipf in line
 *                   with the reference data (no AI; always runs)
 *       2. guess:   level-guess-v1 for senses outside the lists that never had a guess
 *       3. tr:      level-tr-v1, the Turkish-learner check of the word lists
 *       4. resolve again, so corrections reach the lexicon (and every device) at once
 *       Steps 2-3 need GEMINI_API_KEY: without it (or with --no-ai) they are skipped with a
 *       warning and the run still succeeds. They stop when the budget, the provider quota or
 *       --max-minutes is used up; the next run continues where this one stopped. An error in
 *       them still runs step 4, then fails the run. Logic and tests: scripts/lib/level-run.ts.
 *       Every run ends with a heartbeat (public.job_runs, scripts/lib/heartbeat.ts).
 *       --dry-run reads and reports, writes nothing and calls no model.
 *
 *   node scripts/system-jobs.ts export-tr [--out data/levels/level-tr.tsv]
 *       Writes the stored corrections for scripts/build-levels.ts (client level file).
 *
 *   node --env-file=<file with GEMINI_API_KEY> scripts/system-jobs.ts try-tr [--limit 100] [--offset 0]
 *   node --env-file=<...> scripts/system-jobs.ts try-guess
 *       Local prompt check: one model call on the committed list (try-tr) or on built-in
 *       sample senses (try-guess). No database, nothing is stored.
 *
 * Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (levels, export-tr); GEMINI_API_KEY,
 * GEMINI_MODEL, GEMINI_FALLBACK_MODEL (levels, try-*); AI_SYSTEM_DAILY_LIMIT (default 100).
 * Secrets are read from the environment only and never printed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AiError, createAiProvider, type AiProvider } from '../supabase/functions/_shared/ai-provider.ts';
import { parseCefr } from '../supabase/functions/_shared/cefr.ts';
import { lemmasNeeded, type RefEntry, type RefLookup, type WordRefs } from '../supabase/functions/_shared/level.ts';
import {
  buildLevelGuessUserPrompt,
  buildLevelTrUserPrompt,
  DEFAULT_AI_SYSTEM_DAILY_LIMIT,
  LEVEL_GUESS_RESPONSE_SCHEMA,
  LEVEL_GUESS_SYSTEM_PROMPT,
  LEVEL_JOB_BATCH,
  LEVEL_TR_RESPONSE_SCHEMA,
  LEVEL_TR_SYSTEM_PROMPT,
  levelGuessOutput,
  levelGuessResults,
  levelTrOutput,
  levelTrResults,
  planLevels,
  type GuessTarget,
  type LevelSenseRow,
  type TrPendingItem,
} from '../supabase/functions/_shared/level-job.ts';
import { heartbeat, summary } from './lib/heartbeat.ts';
import {
  runLevels,
  type LevelAi,
  type LevelDb,
  type LevelRunReport,
  type ModelRequest,
} from './lib/level-run.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = (k: string) => process.env[k];
const log = (msg: string, data: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ job: 'levels', msg, ...data }));

function need(k: string): string {
  const v = env(k);
  if (!v) {
    console.error(`${k} is not set`);
    process.exit(1);
  }
  return v;
}

function db(): SupabaseClient {
  return createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function rpc<T>(c: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await c.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

// ---------------------------------------------------------------------------
// Database reads
// ---------------------------------------------------------------------------

async function allSenses(c: SupabaseClient): Promise<LevelSenseRow[]> {
  const out: LevelSenseRow[] = [];
  let after: string | null = null;
  for (;;) {
    const page: LevelSenseRow[] = await rpc(c, 'level_senses', { p_after: after, p_limit: 5000 });
    out.push(...page);
    if (page.length < 5000) return out;
    after = page[page.length - 1]!.id;
  }
}

interface Refs {
  lookup: RefLookup;
  minZipf: number | null;
}

async function loadRefs(c: SupabaseClient, rows: LevelSenseRow[]): Promise<Refs> {
  const lemmas = [...new Set(rows.flatMap((r) => lemmasNeeded(r.lemma_norm)))];
  const map = new Map<string, WordRefs>();
  let minZipf: number | null = null;
  for (let i = 0; i < lemmas.length; i += 2000) {
    const res: { min_zipf: number | null; rows: (WordRefs & { lemma_norm: string })[] } = await rpc(
      c,
      'level_refs',
      { p_lemmas: lemmas.slice(i, i + 2000) },
    );
    minZipf = res.min_zipf;
    for (const r of res.rows) map.set(r.lemma_norm, { refs: r.refs, zipf: r.zipf });
  }
  return { lookup: (l) => map.get(l), minZipf };
}

async function writeLevels(
  c: SupabaseClient,
  plan: ReturnType<typeof planLevels>,
  dryRun: boolean,
): Promise<{ senses: number; terms: number }> {
  if (dryRun) return { senses: plan.senses.length, terms: plan.terms.length };
  let senses = 0;
  let terms = 0;
  const n = Math.max(plan.senses.length, plan.terms.length);
  for (let i = 0; i < n; i += 2000) {
    const r: { senses: number; terms: number } = await rpc(c, 'lexicon_set_levels', {
      p_senses: plan.senses.slice(i, i + 2000),
      p_terms: plan.terms.slice(i, i + 2000),
    });
    senses += r.senses;
    terms += r.terms;
  }
  return { senses, terms };
}

// ---------------------------------------------------------------------------
// Model calls on the system budget
// ---------------------------------------------------------------------------

class Budget {
  calls = 0;
  stopped: string | null = null;
  private readonly c: SupabaseClient | null;
  private readonly dailyLimit: number;
  private readonly maxCalls: number;
  private readonly deadline: number;
  constructor(c: SupabaseClient | null, dailyLimit: number, maxCalls: number, deadline = Infinity) {
    this.c = c;
    this.dailyLimit = dailyLimit;
    this.maxCalls = maxCalls;
    this.deadline = deadline;
  }

  /** Takes one call from the system budget; false (and stopped) when none is left. */
  async take(): Promise<boolean> {
    if (this.stopped) return false;
    if (this.calls >= this.maxCalls) {
      this.stopped = 'max_calls';
      return false;
    }
    // Leave time for the last resolve inside the workflow's timeout.
    if (Date.now() > this.deadline) {
      this.stopped = 'time';
      return false;
    }
    if (this.c) {
      const r: { allowed: boolean; used: number; limit: number } = await rpc(
        this.c,
        'ai_system_consume',
        { p_limit: this.dailyLimit, p_cost: 1 },
      );
      if (!r.allowed) {
        this.stopped = 'system_daily_limit';
        return false;
      }
    }
    this.calls++;
    return true;
  }
}

async function callModel(
  provider: AiProvider,
  budget: Budget,
  req: ModelRequest,
): Promise<{ data: unknown; model: string } | null> {
  if (!(await budget.take())) return null;
  try {
    const r = await provider.generateJson({
      system: req.system,
      user: req.user,
      schema: req.schema,
      validate: (d) => (req.ok(d) ? null : 'unexpected response shape'),
      maxOutputTokens: 8192,
      timeoutMs: 90_000,
    });
    return { data: r.data, model: r.model };
  } catch (e) {
    if (e instanceof AiError) {
      budget.stopped = e.code; // quota_exceeded or ai_failed: try again in the next run
      log('model call failed', { code: e.code, message: e.message.slice(0, 200) });
      return null;
    }
    throw e;
  }
}

function dailyLimit(): number {
  const n = Number(env('AI_SYSTEM_DAILY_LIMIT'));
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_AI_SYSTEM_DAILY_LIMIT;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function levels(opts: { dryRun: boolean; maxCalls: number; noAi: boolean; maxMinutes: number }) {
  const { dryRun } = opts;
  const c = db();
  // The deterministic part needs no AI: without a key it still runs, and only the AI steps are
  // skipped (decision 0037).
  const haveKey = !!env('GEMINI_API_KEY');
  if (!haveKey && !opts.noAi && !dryRun)
    console.log('::warning::GEMINI_API_KEY is not set: levels and zipf are resolved, AI steps skipped');
  const useAi = haveKey && !opts.noAi && !dryRun;
  const budget = new Budget(
    useAi ? c : null,
    dailyLimit(),
    useAi ? opts.maxCalls : 0,
    Date.now() + opts.maxMinutes * 60_000,
  );
  let provider: AiProvider | null = null;
  const getProvider = () => (provider ??= createAiProvider(env));
  const levelDb: LevelDb = {
    senses: () => allSenses(c),
    refs: (rows) => loadRefs(c, rows),
    write: (plan, dry) => writeLevels(c, plan, dry),
    trPending: (limit) => rpc(c, 'ref_level_tr_pending', { p_limit: limit }),
    trStore: (items) => rpc(c, 'ref_set_level_tr', { p_items: items }),
  };
  const ai: LevelAi | null = useAi
    ? {
        call: (req) => callModel(getProvider(), budget, req),
        stopped: () => budget.stopped,
        calls: () => budget.calls,
      }
    : null;
  let report: LevelRunReport;
  try {
    report = await runLevels(levelDb, ai, { dryRun, log });
  } catch (e) {
    // The deterministic part failed: record it, then fail the run.
    if (!dryRun)
      await heartbeat(c, 'levels', 'failed', { error: String(e instanceof Error ? e.message : e).slice(0, 200) }, log);
    throw e;
  }
  log('done', { ...report });
  if (!dryRun) {
    const status = report.ai === 'error' ? 'partial' : 'ok';
    await heartbeat(
      c,
      'levels',
      status,
      {
        senses: report.senses_total,
        terms_zipf: report.resolved_first.terms + (report.resolved_last?.terms ?? 0),
        ai: report.ai,
        guessed: report.guessed,
        checked: report.checked,
        model_calls: report.model_calls,
        stopped: report.stopped,
      },
      log,
    );
  }
  summary(
    `Level job: ${report.senses_total} senses; resolved ${report.resolved_first.senses} senses / ` +
      `${report.resolved_first.terms} term frequencies; AI ${report.ai}` +
      (report.ai === 'ran' ? ` (${report.model_calls} calls, stopped: ${report.stopped ?? 'done'})` : '') +
      (dryRun ? ' (dry run)' : ''),
  );
  // An AI failure fails the run (visible in Actions) after the deterministic part was stored.
  if (report.ai === 'error') {
    console.error(`::error::AI steps failed: ${report.ai_error}`);
    process.exitCode = 1;
  }
}

async function exportTr(out: string) {
  const c = db();
  const rows: { lemma_norm: string; pos: string; source: string; cefr: string; tr_cefr: string; tr_reason: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await c
      .from('ref_word_levels')
      .select('lemma_norm,pos,source,cefr,tr_base_cefr,tr_cefr,tr_reason')
      .not('tr_cefr', 'is', null)
      .order('lemma_norm')
      .order('pos')
      .order('source')
      .range(from, from + 999);
    if (error) throw new Error(`ref_word_levels: ${error.message}`);
    // Only corrections made for the current list level.
    for (const r of data ?? []) if (r.tr_base_cefr === r.cefr) rows.push(r);
    if (!data || data.length < 1000) break;
  }
  const clean = (s: string) => s.replace(/[\t\n\r]/g, ' ');
  const lines = [
    '# Turkish-learner corrections of the word lists (level-tr-v1), exported from',
    '# public.ref_word_levels by `node scripts/system-jobs.ts export-tr`. CC BY-SA 4.0 (derived',
    '# from the lists; see docs/licenses.md). Read by scripts/build-levels.ts.',
    '# Columns: lemma_norm, pos, source, list cefr, corrected cefr, reason_tr',
    ...rows.map((r) => [r.lemma_norm, r.pos, r.source, r.cefr, r.tr_cefr, clean(r.tr_reason)].join('\t')),
  ];
  writeFileSync(out, `${lines.join('\n')}\n`);
  console.log(`${rows.length} corrections written to ${out}`);
}

/** The committed list as TrPendingItems, most frequent first (local prompt checks). */
function localList(): TrPendingItem[] {
  const read = (f: string) =>
    readFileSync(join(ROOT, 'data/levels', f), 'utf8')
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.split('\t'));
  const zipf = new Map(read('ref-word-freq.tsv').map(([w, z]) => [w!, Number(z)]));
  return read('ref-word-levels.tsv')
    .map(([lemma_norm, pos, cefr, source]) => ({
      lemma_norm: lemma_norm!,
      pos: pos!,
      cefr: parseCefr(cefr)!,
      source: source as RefEntry['source'],
    }))
    .filter((r) => r.cefr)
    .sort((a, b) => (zipf.get(b.lemma_norm) ?? 0) - (zipf.get(a.lemma_norm) ?? 0));
}

async function tryTr(limit: number, offset: number) {
  const items = localList().slice(offset, offset + limit);
  const budget = new Budget(null, Infinity, 1);
  const res = await callModel(createAiProvider(env), budget, {
    system: LEVEL_TR_SYSTEM_PROMPT,
    user: buildLevelTrUserPrompt(items),
    schema: LEVEL_TR_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    ok: (d) => levelTrOutput.safeParse(d).success,
  });
  if (!res) process.exit(1);
  const results = levelTrResults(items, res.data, res.model);
  const changed = results.filter((r) => r.cefr);
  console.log(`model ${res.model}: ${changed.length} of ${items.length} moved`);
  for (const r of changed)
    console.log(`${r.lemma_norm} (${r.pos}, ${r.source}): ${r.base_cefr} -> ${r.cefr}  ${r.reason}`);
}

const SAMPLE_SENSES: GuessTarget[] = [
  ['bank', 'noun', 'the land beside a river'],
  ['bank', 'noun', 'an organization that keeps and lends money'],
  ['give up', 'phrasal verb', 'stop trying to do something'],
  ['take advantage of sth', 'phrase', 'use a chance or a situation to get something'],
  ['subsidy', 'noun', 'money a government pays to keep prices low'],
  ['actually', 'adverb', 'used to say what is really true'],
  ['television', 'noun', 'a device that shows programmes'],
  ['cut corners', 'idiom', 'do something badly to save time or money'],
  ['reluctant', 'adjective', 'not wanting to do something'],
  ['by and large', 'phrase', 'in general'],
].map(([lemma_norm, pos, gloss_en], i) => ({ id: `x${i}`, lemma_norm: lemma_norm!, pos: pos!, gloss_en: gloss_en! }));

async function tryGuess() {
  const budget = new Budget(null, Infinity, 1);
  const res = await callModel(createAiProvider(env), budget, {
    system: LEVEL_GUESS_SYSTEM_PROMPT,
    user: buildLevelGuessUserPrompt(SAMPLE_SENSES),
    schema: LEVEL_GUESS_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    ok: (d) => levelGuessOutput.safeParse(d).success,
  });
  if (!res) process.exit(1);
  const g = levelGuessResults(SAMPLE_SENSES, res.data);
  console.log(`model ${res.model}`);
  SAMPLE_SENSES.forEach((s, i) => console.log(`${g[i] ?? '--'}  ${s.lemma_norm} (${s.pos}): ${s.gloss_en}`));
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    'dry-run': { type: 'boolean', default: false },
    'max-calls': { type: 'string' },
    'no-ai': { type: 'boolean', default: false },
    'max-minutes': { type: 'string', default: '40' },
    out: { type: 'string', default: join(ROOT, 'data/levels/level-tr.tsv') },
    limit: { type: 'string', default: String(LEVEL_JOB_BATCH) },
    offset: { type: 'string', default: '0' },
  },
});

const cmd = positionals[0];
if (cmd === 'levels') {
  const max = values['max-calls'] ? Number(values['max-calls']) : Infinity;
  const minutes = Number(values['max-minutes']);
  await levels({
    dryRun: values['dry-run'],
    maxCalls: Number.isFinite(max) && max >= 0 ? max : Infinity,
    noAi: values['no-ai'],
    maxMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 40,
  });
} else if (cmd === 'export-tr') {
  await exportTr(values.out);
} else if (cmd === 'try-tr') {
  await tryTr(Number(values.limit), Number(values.offset));
} else if (cmd === 'try-guess') {
  await tryGuess();
} else {
  console.error('usage: node scripts/system-jobs.ts levels [--dry-run] [--no-ai] [--max-calls N] [--max-minutes N] | export-tr [--out FILE] | try-tr [--limit N] [--offset N] | try-guess');
  process.exit(2);
}
