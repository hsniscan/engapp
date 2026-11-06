// The bulk example job's database access (service role): the tables and functions of
// 20261106000400_example_bulk.sql, lexicon_examples_insert, and the shared monthly Claude
// budget (image_budget_*, purpose 'wordbank', like the word-bank job).

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BulkBatch,
  BulkRow,
  ExampleBulkStore,
  ExampleInsert,
  ItemRow,
  ItemState,
  NewItem,
  SenseCounts,
  TargetRow,
} from './example-bulk-jobs.ts';

function check<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

const ITEM_COLUMNS =
  'id, lemma_norm, pos, sense_id, state, source, context, level_band, text_en, text_tr, attribution, score, model, prompt_version, review_batch_id, review_custom_id, review_attempts, review_note, example_id';
const ROW_COLUMNS =
  'lemma_norm, pos, tag_batch_id, tag_custom_id, tag_attempts, gen_batch_id, gen_custom_id, gen_attempts, gen_input, last_error';
const PAGE = 1000;

export class SupabaseExampleBulkStore implements ExampleBulkStore {
  readonly db: SupabaseClient;
  constructor(db: SupabaseClient) {
    this.db = db;
  }

  async targets(): Promise<TargetRow[]> {
    const out: TargetRow[] = [];
    let after = { lemma: '', pos: '' };
    for (;;) {
      const page = check(
        await this.db.rpc('example_bulk_targets', {
          p_after_lemma: after.lemma,
          p_after_pos: after.pos,
          p_limit: 2000,
        }),
        'example_bulk_targets',
      ) as TargetRow[];
      out.push(...page);
      if (page.length < 2000) return out;
      const last = page.at(-1)!;
      after = { lemma: last.lemma_norm, pos: last.pos };
    }
  }

  async senseCounts(): Promise<SenseCounts> {
    const raw = check(
      await this.db.rpc('example_bulk_sense_counts'),
      'example_bulk_sense_counts',
    ) as Record<string, Partial<Record<ItemState, number>>>;
    return new Map(Object.entries(raw ?? {}));
  }

  async rows(): Promise<BulkRow[]> {
    const out: BulkRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const page = check(
        await this.db
          .from('example_bulk_rows')
          .select(ROW_COLUMNS)
          .order('lemma_norm')
          .order('pos')
          .range(from, from + PAGE - 1),
        'example_bulk_rows read',
      ) as BulkRow[];
      out.push(...page);
      if (page.length < PAGE) return out;
    }
  }

  async upsertRows(rows: BulkRow[]): Promise<void> {
    for (let i = 0; i < rows.length; i += 500) {
      const part = rows.slice(i, i + 500);
      check(
        await this.db.from('example_bulk_rows').upsert(
          part.map((r) => ({ ...r, updated_at: new Date().toISOString() })),
          { onConflict: 'lemma_norm,pos' },
        ),
        'example_bulk_rows upsert',
      );
    }
  }

  async items(states: readonly ItemState[], opts: { reviewBatch?: string } = {}): Promise<ItemRow[]> {
    const out: ItemRow[] = [];
    // Keyset pages by id: rows change state while a run reads them.
    for (let after = ''; ;) {
      let q = this.db
        .from('example_bulk_items')
        .select(ITEM_COLUMNS)
        .in('state', [...states])
        .order('id')
        .limit(PAGE);
      if (opts.reviewBatch) q = q.eq('review_batch_id', opts.reviewBatch);
      if (after) q = q.gt('id', after);
      const page = check(await q, 'example_bulk_items read') as (ItemRow & { score: number | string })[];
      out.push(...page.map((r) => ({ ...r, score: Number(r.score) })));
      if (page.length < PAGE) return out;
      after = page.at(-1)!.id;
    }
  }

  async insertItems(items: NewItem[]): Promise<number> {
    if (items.length === 0) return 0;
    const rows = check(
      await this.db
        .from('example_bulk_items')
        .upsert(items, { onConflict: 'lemma_norm,pos,text_key', ignoreDuplicates: true })
        .select('id'),
      'example_bulk_items insert',
    ) as { id: string }[];
    return rows.length;
  }

  async saveItems(items: ItemRow[]): Promise<string[]> {
    if (items.length === 0) return [];
    const stamp = new Date().toISOString();
    const rows = items.map((r) => ({ ...r, updated_at: stamp }));
    const all = await this.db.from('example_bulk_items').upsert(rows, { onConflict: 'id' });
    if (!all.error) return [];
    // One of them repeats another sentence of its row: save one by one, report the failures.
    const failed: string[] = [];
    for (const r of rows) {
      const one = await this.db.from('example_bulk_items').upsert(r, { onConflict: 'id' });
      if (one.error) {
        if (one.error.code === '23505') failed.push(r.id);
        else throw new Error(`example_bulk_items save: ${one.error.message}`);
      }
    }
    return failed;
  }

  async insertBatch(b: BulkBatch): Promise<void> {
    check(await this.db.from('example_bulk_batches').insert(b), 'example_bulk_batches insert');
  }

  async openBatches(): Promise<BulkBatch[]> {
    const rows = check(
      await this.db
        .from('example_bulk_batches')
        .select('*')
        .eq('state', 'submitted')
        .order('created_at'),
      'example_bulk_batches read',
    ) as (BulkBatch & { reserved_usd: number | string; cost_usd: number | string | null })[];
    return rows.map((r) => ({
      ...r,
      reserved_usd: Number(r.reserved_usd),
      cost_usd: r.cost_usd == null ? null : Number(r.cost_usd),
    }));
  }

  async closeBatch(id: string, costUsd: number): Promise<void> {
    check(
      await this.db
        .from('example_bulk_batches')
        .update({ state: 'collected', cost_usd: costUsd, collected_at: new Date().toISOString() })
        .eq('id', id),
      'example_bulk_batches update',
    );
  }

  async publish(items: ExampleInsert[]): Promise<{ id: string; sense_id: string; text_en: string }[]> {
    if (items.length === 0) return [];
    return check(
      await this.db.rpc('lexicon_examples_insert', { p_items: items }),
      'lexicon_examples_insert',
    ) as { id: string; sense_id: string; text_en: string }[];
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

  async spent(): Promise<number> {
    return Number(check(await this.db.rpc('example_bulk_spent'), 'example_bulk_spent') ?? 0);
  }

  async budgetStatus(): Promise<Record<string, unknown>> {
    return check(await this.db.rpc('image_budget_status'), 'image_budget_status');
  }
}
