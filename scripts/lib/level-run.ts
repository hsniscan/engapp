// The nightly level job's steps (v0.2 İP2, hardened in v0.4 İP10, decision 0037), with the
// database and the model passed in so tests run them against fakes. CLI: scripts/system-jobs.ts.
//
//   1. resolve  bring every lexicon sense's level and every term's zipf in line with the
//               reference data. Deterministic, no AI: it runs on every run, also when the AI
//               key is missing or the AI steps fail.
//   2. guess    level-guess-v1 for senses outside the lists          (AI, skipped without a key)
//   3. tr       level-tr-v1, the Turkish-learner check of the lists  (AI, skipped without a key)
//   4. resolve  again when 2 or 3 changed something, also after an AI error, so whatever was
//               stored before the error reaches the lexicon at once.

import type { Cefr } from '../../supabase/functions/_shared/cefr.ts';
import type { RefLookup } from '../../supabase/functions/_shared/level.ts';
import {
  buildLevelGuessUserPrompt,
  buildLevelTrUserPrompt,
  LEVEL_GUESS_RESPONSE_SCHEMA,
  LEVEL_GUESS_SYSTEM_PROMPT,
  LEVEL_JOB_BATCH,
  LEVEL_TR_RESPONSE_SCHEMA,
  LEVEL_TR_SYSTEM_PROMPT,
  levelGuessOutput,
  levelGuessResults,
  levelTrOutput,
  levelTrResults,
  needsGuess,
  planLevels,
  type GuessTarget,
  type LevelSenseRow,
  type TrPendingItem,
  type TrResult,
} from '../../supabase/functions/_shared/level-job.ts';

export type LevelPlan = ReturnType<typeof planLevels>;

export interface LevelRefs {
  lookup: RefLookup;
  minZipf: number | null;
}

/** What the job needs from the database (service role). */
export interface LevelDb {
  senses(): Promise<LevelSenseRow[]>;
  refs(rows: LevelSenseRow[]): Promise<LevelRefs>;
  /** Stores the plan (only changed rows are written); a dry run counts without writing. */
  write(plan: LevelPlan, dryRun: boolean): Promise<{ senses: number; terms: number }>;
  trPending(limit: number): Promise<TrPendingItem[]>;
  trStore(items: TrResult[]): Promise<number>;
}

export interface ModelRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  ok: (d: unknown) => boolean;
}

/** One model call on the system budget; null when the budget, time or quota stopped it. */
export interface LevelAi {
  call(req: ModelRequest): Promise<{ data: unknown; model: string } | null>;
  /** Why calls stopped (budget, time, quota), or null. */
  stopped(): string | null;
  calls(): number;
}

export type Log = (msg: string, data?: Record<string, unknown>) => void;

export interface LevelRunReport {
  senses_total: number;
  resolved_first: { senses: number; terms: number };
  /** 'off': no AI this run (no key, --no-ai or a dry run); 'error': the AI steps failed. */
  ai: 'off' | 'ran' | 'error';
  ai_error: string | null;
  guessed: number;
  checked: number;
  corrected: number;
  model_calls: number;
  stopped: string | null;
  resolved_last: { senses: number; terms: number } | null;
  dry_run: boolean;
}

export async function runLevels(
  db: LevelDb,
  ai: LevelAi | null,
  opts: { dryRun: boolean; log: Log },
): Promise<LevelRunReport> {
  const { dryRun, log } = opts;

  // 1. Resolve (no AI).
  let rows = await db.senses();
  let refs = await db.refs(rows);
  const coverage = () => ({ minZipf: refs.minZipf });
  const first = await db.write(planLevels(rows, refs.lookup, coverage()), dryRun);
  log('resolve', { senses_total: rows.length, ...first, dry_run: dryRun });
  if (refs.minZipf === null) log('no word frequencies in the reference data: zipf stays empty');

  const report: LevelRunReport = {
    senses_total: rows.length,
    resolved_first: first,
    ai: ai && !dryRun ? 'ran' : 'off',
    ai_error: null,
    guessed: 0,
    checked: 0,
    corrected: 0,
    model_calls: 0,
    stopped: null,
    resolved_last: null,
    dry_run: dryRun,
  };

  const targets = rows.filter((r) => needsGuess(r, refs.lookup));
  log('guess pending', { senses: targets.length });
  if (dryRun) {
    const pending = await db.trPending(1000);
    log('tr pending (first 1000)', { entries: pending.length });
  }

  if (ai && !dryRun) {
    try {
      // 2. Guesses for senses outside the lists.
      for (let i = 0; i < targets.length; i += LEVEL_JOB_BATCH) {
        const batch = targets.slice(i, i + LEVEL_JOB_BATCH);
        const g: GuessTarget[] = batch.map((r) => ({
          id: r.id,
          lemma_norm: r.lemma_norm,
          pos: r.pos,
          gloss_en: r.gloss_en,
        }));
        const res = await ai.call({
          system: LEVEL_GUESS_SYSTEM_PROMPT,
          user: buildLevelGuessUserPrompt(g),
          schema: LEVEL_GUESS_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
          ok: (d) => levelGuessOutput.safeParse(d).success,
        });
        if (!res) break;
        const guesses = levelGuessResults(g, res.data);
        const map = new Map<string, Cefr | null>(batch.map((r, k) => [r.id, guesses[k] ?? null]));
        const plan = planLevels(batch, refs.lookup, coverage(), map);
        await db.write({ senses: plan.senses, terms: [] }, false);
        report.guessed += guesses.filter(Boolean).length;
      }
      log('guess', { guessed: report.guessed, model_calls: ai.calls() });

      // 3. Turkish-learner check of the lists.
      while (!ai.stopped()) {
        const pending = await db.trPending(LEVEL_JOB_BATCH);
        if (pending.length === 0) break;
        const res = await ai.call({
          system: LEVEL_TR_SYSTEM_PROMPT,
          user: buildLevelTrUserPrompt(pending),
          schema: LEVEL_TR_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
          ok: (d) => levelTrOutput.safeParse(d).success,
        });
        if (!res) break;
        const results = levelTrResults(pending, res.data, res.model);
        const stored = await db.trStore(results);
        report.checked += stored;
        report.corrected += results.filter((r) => r.cefr).length;
        if (stored === 0) break; // nothing moved (the list changed underneath): stop, never loop
      }
    } catch (e) {
      report.ai = 'error';
      report.ai_error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      log('AI steps failed; resolving what was stored', { error: report.ai_error });
    }
    report.model_calls = ai.calls();
    report.stopped = ai.stopped();
    log('tr', {
      checked: report.checked,
      corrected: report.corrected,
      model_calls: report.model_calls,
      stopped: report.stopped,
    });
  }

  // 4. Resolve again with the new corrections and guesses.
  if (!dryRun && (report.checked > 0 || report.guessed > 0 || report.ai === 'error')) {
    rows = await db.senses();
    refs = await db.refs(rows);
    report.resolved_last = await db.write(planLevels(rows, refs.lookup, coverage()), false);
    log('resolve', { senses_total: rows.length, ...report.resolved_last });
  }
  return report;
}
