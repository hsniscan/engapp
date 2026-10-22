// The word-bank job's database access (service role): SQL functions and tables from
// 20261026001100_word_bank.sql, the shared lexicon (lexicon_find, lexicon_upsert,
// lexicon_examples) and the shared monthly Claude budget (image_budget_*, purpose 'wordbank').

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BankRowOut,
  BatchRow,
  JobRow,
  LexiconExampleHit,
  LexiconItem,
  LexiconTermHit,
  PendingWord,
  WordBankStore,
} from './word-bank-jobs.ts';

function check<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

export class SupabaseWordBankStore implements WordBankStore {
  readonly db: SupabaseClient;
  constructor(db: SupabaseClient) {
    this.db = db;
  }

  async pending(limit: number): Promise<PendingWord[]> {
    return check(
      await this.db.rpc('word_bank_pending', { p_limit: limit }),
      'word_bank_pending',
    ) as PendingWord[];
  }

  async lexiconFind(norms: string[]): Promise<LexiconTermHit[]> {
    if (norms.length === 0) return [];
    return check(
      await this.db.rpc('lexicon_find', { p_norms: norms, p_max_senses: 12 }),
      'lexicon_find',
    ) as LexiconTermHit[];
  }

  async lexiconExamples(senseIds: string[]): Promise<LexiconExampleHit[]> {
    if (senseIds.length === 0) return [];
    const rows = check(
      await this.db
        .from('lexicon_examples')
        .select('sense_id, level_band, text_en, translations')
        .in('sense_id', senseIds)
        .eq('status', 'active'),
      'lexicon_examples',
    ) as {
      sense_id: string;
      level_band: string;
      text_en: string;
      translations: { tr?: unknown } | null;
    }[];
    return rows.map((r) => ({
      sense_id: r.sense_id,
      level_band: r.level_band,
      text_en: r.text_en,
      text_tr: typeof r.translations?.tr === 'string' ? r.translations.tr : null,
    }));
  }

  async lexiconUpsert(
    items: LexiconItem[],
  ): Promise<{ term_id: string; sense_id: string | null }[]> {
    if (items.length === 0) return [];
    return check(await this.db.rpc('lexicon_upsert', { p_items: items }), 'lexicon_upsert') as {
      term_id: string;
      sense_id: string | null;
    }[];
  }

  async putRows(rows: BankRowOut[]): Promise<number> {
    if (rows.length === 0) return 0;
    return check(await this.db.rpc('word_bank_put', { p_rows: rows }), 'word_bank_put') as number;
  }

  async upsertJobs(rows: JobRow[]): Promise<void> {
    if (rows.length === 0) return;
    check(
      await this.db.from('word_bank_jobs').upsert(
        rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })),
        { onConflict: 'lemma_norm,pos' },
      ),
      'word_bank_jobs upsert',
    );
  }

  async jobsOfBatch(batchId: string): Promise<JobRow[]> {
    const out: JobRow[] = [];
    for (let from = 0; ; from += 1000) {
      const page = check(
        await this.db
          .from('word_bank_jobs')
          .select('lemma_norm, pos, state, attempt, batch_id, custom_id, last_error, input')
          .eq('batch_id', batchId)
          .order('lemma_norm')
          .order('pos')
          .range(from, from + 999),
        'word_bank_jobs read',
      ) as JobRow[];
      out.push(...page);
      if (page.length < 1000) return out;
    }
  }

  async insertBatch(row: BatchRow): Promise<void> {
    check(await this.db.from('word_bank_batches').insert(row), 'word_bank_batches insert');
  }

  async openBatches(): Promise<BatchRow[]> {
    const rows = check(
      await this.db
        .from('word_bank_batches')
        .select('*')
        .eq('state', 'submitted')
        .order('created_at'),
      'word_bank_batches read',
    ) as (BatchRow & { reserved_usd: number | string; cost_usd: number | string | null })[];
    return rows.map((r) => ({
      ...r,
      reserved_usd: Number(r.reserved_usd),
      cost_usd: r.cost_usd == null ? null : Number(r.cost_usd),
    }));
  }

  async closeBatch(id: string, costUsd: number): Promise<void> {
    check(
      await this.db
        .from('word_bank_batches')
        .update({ state: 'collected', cost_usd: costUsd, collected_at: new Date().toISOString() })
        .eq('id', id),
      'word_bank_batches update',
    );
  }

  async reserve(amountUsd: number, capUsd: number): Promise<string | null> {
    const r = await this.db.rpc('image_budget_reserve', {
      p_amount: amountUsd,
      p_cap: capUsd,
      p_purpose: 'wordbank',
    });
    return (check(r, 'image_budget_reserve') as string | null) ?? null;
  }

  async settle(holdId: string, actualUsd: number): Promise<void> {
    check(
      await this.db.rpc('image_budget_settle', { p_hold: holdId, p_actual: actualUsd }),
      'image_budget_settle',
    );
  }

  async budgetStatus(): Promise<Record<string, unknown>> {
    return check(await this.db.rpc('image_budget_status'), 'image_budget_status');
  }
}
