// The graded library job's database access (service role): tables and functions from
// 20261101000510_graded_texts.sql. The text budget is separate (_shared/text-budget.ts).

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BatchRow,
  CellCounts,
  GradedJob,
  GradedStore,
  NewGradedText,
  TextForCheck,
} from './graded-jobs.ts';

function check<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

const JOB_COLUMNS =
  'plan_key, level, topic, slot, stage, state, attempt, batch_id, custom_id, input, graded_id, last_error, cost_usd';

const asJob = (r: GradedJob & { cost_usd: number | string }): GradedJob => ({ ...r, cost_usd: Number(r.cost_usd) });

export class SupabaseGradedStore implements GradedStore {
  readonly db: SupabaseClient;
  constructor(db: SupabaseClient) {
    this.db = db;
  }

  async jobs(): Promise<GradedJob[]> {
    const out: GradedJob[] = [];
    for (let from = 0; ; from += 1000) {
      const page = check(
        await this.db.from('graded_jobs').select(JOB_COLUMNS).order('plan_key').range(from, from + 999),
        'graded_jobs read',
      ) as (GradedJob & { cost_usd: number | string })[];
      out.push(...page.map(asJob));
      if (page.length < 1000) return out;
    }
  }

  async upsertJobs(rows: GradedJob[]): Promise<void> {
    if (rows.length === 0) return;
    check(
      await this.db.from('graded_jobs').upsert(
        rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })),
        { onConflict: 'plan_key' },
      ),
      'graded_jobs upsert',
    );
  }

  async jobsOfBatch(batchId: string): Promise<GradedJob[]> {
    const out: GradedJob[] = [];
    for (let from = 0; ; from += 1000) {
      const page = check(
        await this.db
          .from('graded_jobs')
          .select(JOB_COLUMNS)
          .eq('batch_id', batchId)
          .order('plan_key')
          .range(from, from + 999),
        'graded_jobs read',
      ) as (GradedJob & { cost_usd: number | string })[];
      out.push(...page.map(asJob));
      if (page.length < 1000) return out;
    }
  }

  async insertBatch(row: BatchRow): Promise<void> {
    check(await this.db.from('graded_batches').insert(row), 'graded_batches insert');
  }

  async openBatches(): Promise<BatchRow[]> {
    const rows = check(
      await this.db
        .from('graded_batches')
        .select('id, stage, hold_id, reserved_usd, requests, model, prompt_version, state, cost_usd')
        .eq('state', 'submitted')
        .order('created_at'),
      'graded_batches read',
    ) as (BatchRow & { reserved_usd: number | string; cost_usd: number | string | null })[];
    return rows.map((r) => ({
      ...r,
      reserved_usd: Number(r.reserved_usd),
      cost_usd: r.cost_usd === null ? null : Number(r.cost_usd),
    }));
  }

  async closeBatch(id: string, costUsd: number): Promise<void> {
    check(
      await this.db
        .from('graded_batches')
        .update({ state: 'collected', cost_usd: costUsd, collected_at: new Date().toISOString() })
        .eq('id', id),
      'graded_batches update',
    );
  }

  async insertText(row: NewGradedText): Promise<string> {
    const r = check(
      await this.db.from('graded_texts').insert(row).select('id').single(),
      'graded_texts insert',
    ) as { id: string };
    return r.id;
  }

  /** Ends the check: status, the checker's answer merged into checks, its cost added. */
  async finishCheck(
    id: string,
    patch: { status: 'approved' | 'rejected'; check_model: string; checks: Record<string, unknown>; cost_usd: number },
  ): Promise<void> {
    const cur = check(
      await this.db.from('graded_texts').select('checks, cost_usd').eq('id', id).single(),
      'graded_texts read',
    ) as { checks: Record<string, unknown>; cost_usd: number | string };
    check(
      await this.db
        .from('graded_texts')
        .update({
          status: patch.status,
          check_version: 'gradedcheck-v1',
          check_model: patch.check_model,
          checks: { ...cur.checks, ...patch.checks },
          cost_usd: Math.round((Number(cur.cost_usd) + patch.cost_usd) * 1e6) / 1e6,
        })
        .eq('id', id),
      'graded_texts update',
    );
  }

  async textsForCheck(ids: string[]): Promise<TextForCheck[]> {
    const out: TextForCheck[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const rows = check(
        await this.db
          .from('graded_texts')
          .select('id, level, topic, title, sentences, checks, cost_usd')
          .in('id', ids.slice(i, i + 200))
          .eq('status', 'checking'),
        'graded_texts read',
      ) as (TextForCheck & { cost_usd: number | string })[];
      out.push(...rows.map((r) => ({ ...r, cost_usd: Number(r.cost_usd) })));
    }
    return out;
  }

  async cells(): Promise<CellCounts> {
    return check(await this.db.rpc('graded_cells'), 'graded_cells') as CellCounts;
  }

  async recentApproved(limit: number): Promise<{ level: string; topic: string; title: string }[]> {
    return check(
      await this.db
        .from('graded_texts')
        .select('level, topic, title')
        .eq('status', 'approved')
        .order('approved_at', { ascending: false })
        .limit(limit),
      'graded_texts read',
    ) as { level: string; topic: string; title: string }[];
  }

  /** English sentences of every approved text (for the audio pre-generation). */
  async approvedSentences(): Promise<string[]> {
    const out: string[] = [];
    for (let from = 0; ; from += 1000) {
      const page = check(
        await this.db
          .from('graded_texts')
          .select('id, sentences')
          .eq('status', 'approved')
          .order('id')
          .range(from, from + 999),
        'graded_texts read',
      ) as { id: string; sentences: { en: string }[] }[];
      for (const r of page) for (const s of r.sentences) out.push(s.en);
      if (page.length < 1000) return out;
    }
  }
}
