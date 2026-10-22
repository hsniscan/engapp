// Real ImageStore and queue access for the picture pipeline: SQL functions and tables from
// migration 20261025000200_images.sql, through the service role (edge function and Node jobs).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImageRequestInput, LexiconImageRow } from './image-contract.ts';
import type { BudgetPurpose, ImageStore, NewImage } from './image-pipeline.ts';
import type { VisualInput, VisualScore } from './visual-prompt.ts';

function check<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

export interface QueuedRequest {
  sense_id: string;
  source: 'auto' | 'user';
  priority: number;
  attempt: number;
  problem: string | null;
  batch_id: string | null;
  hold_id: string | null;
}

export class SupabaseImageStore implements ImageStore {
  readonly db: SupabaseClient;
  constructor(db: SupabaseClient) {
    this.db = db;
  }

  async reserve(amountUsd: number, capUsd: number, purpose: BudgetPurpose): Promise<string | null> {
    const r = await this.db.rpc('image_budget_reserve', {
      p_amount: amountUsd,
      p_cap: capUsd,
      p_purpose: purpose,
    });
    return (check(r, 'image_budget_reserve') as string | null) ?? null;
  }

  async settle(holdId: string, actualUsd: number): Promise<void> {
    check(
      await this.db.rpc('image_budget_settle', { p_hold: holdId, p_actual: actualUsd }),
      'image_budget_settle',
    );
  }

  async releaseStale(olderThan = '1 hour'): Promise<number> {
    return check(
      await this.db.rpc('image_budget_release_stale', { p_older_than: olderThan }),
      'image_budget_release_stale',
    ) as number;
  }

  async budgetStatus(): Promise<{
    month: string;
    cap_usd: number;
    spent_usd: number;
    reserved_usd: number;
  }> {
    return check(await this.db.rpc('image_budget_status'), 'image_budget_status');
  }

  async insertImage(row: NewImage): Promise<LexiconImageRow & { cost_usd: number }> {
    const r = check(
      await this.db.rpc('image_insert', { p: row }),
      'image_insert',
    ) as LexiconImageRow & {
      cost_usd: number | string;
    };
    return { ...r, cost_usd: Number(r.cost_usd) };
  }

  async setImageStatus(
    id: string,
    status: 'review' | 'rejected',
    checks: Record<string, unknown>,
  ): Promise<void> {
    const cur = check(
      await this.db.from('lexicon_images').select('checks, cost_usd').eq('id', id).single(),
      'lexicon_images read',
    ) as { checks: Record<string, unknown>; cost_usd: number | string };
    const extra = typeof checks.vision_cost_usd === 'number' ? checks.vision_cost_usd : 0;
    check(
      await this.db
        .from('lexicon_images')
        .update({
          status,
          checks: { ...cur.checks, ...checks },
          cost_usd: Number(cur.cost_usd) + extra,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id),
      'lexicon_images update',
    );
  }

  async consumeDaily(
    userId: string,
    limit: number,
  ): Promise<{ allowed: boolean; used: number; limit: number }> {
    return check(
      await this.db.rpc('image_consume', { p_user: userId, p_limit: limit }),
      'image_consume',
    );
  }

  async userHasSense(userId: string, senseId: string): Promise<boolean> {
    return (
      check(
        await this.db.rpc('image_user_has_sense', { p_user: userId, p_sense: senseId }),
        'image_user_has_sense',
      ) === true
    );
  }

  async senseInputs(senseIds: string[]): Promise<ImageRequestInput[]> {
    if (senseIds.length === 0) return [];
    return check(
      await this.db.rpc('image_sense_inputs', { p_sense_ids: senseIds }),
      'image_sense_inputs',
    );
  }

  // ------------------------------------------------------------- queue

  async upsertRequest(
    senseId: string,
    patch: Partial<QueuedRequest> & { state: string; last_error?: string | null },
  ): Promise<void> {
    check(
      await this.db
        .from('image_requests')
        .upsert(
          { sense_id: senseId, source: 'user', ...patch, updated_at: new Date().toISOString() },
          { onConflict: 'sense_id' },
        ),
      'image_requests upsert',
    );
  }

  async updateRequest(senseId: string, patch: Record<string, unknown>): Promise<void> {
    check(
      await this.db
        .from('image_requests')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('sense_id', senseId),
      'image_requests update',
    );
  }

  async queued(limit: number): Promise<QueuedRequest[]> {
    return check(
      await this.db
        .from('image_requests')
        .select('sense_id, source, priority, attempt, problem, batch_id, hold_id')
        .eq('state', 'queued')
        .order('priority', { ascending: false })
        .order('updated_at', { ascending: true })
        .limit(limit),
      'image_requests queued',
    );
  }

  async submitted(): Promise<QueuedRequest[]> {
    return check(
      await this.db
        .from('image_requests')
        .select('sense_id, source, priority, attempt, problem, batch_id, hold_id')
        .eq('state', 'submitted')
        .limit(10000),
      'image_requests submitted',
    );
  }

  async queueAuto(min: number, limit: number): Promise<number> {
    return check(
      await this.db.rpc('image_queue_auto', { p_min: min, p_limit: limit }),
      'image_queue_auto',
    );
  }

  /** 'review' pictures whose vision check was left to the nightly job (instant path). */
  async pendingVision(
    limit: number,
  ): Promise<{ id: string; sense_id: string; svg: string; checks: Record<string, unknown> }[]> {
    return check(
      await this.db
        .from('lexicon_images')
        .select('id, sense_id, svg, checks')
        .eq('status', 'review')
        .eq('checks->>vision', 'pending')
        .order('created_at', { ascending: true })
        .limit(limit),
      'lexicon_images pending vision',
    );
  }

  // ------------------------------------------------------------- visual-v1

  async visualPending(limit: number): Promise<VisualInput[]> {
    return check(
      await this.db.rpc('image_visual_pending', { p_limit: limit }),
      'image_visual_pending',
    );
  }

  async visualSet(items: VisualScore[]): Promise<number> {
    if (items.length === 0) return 0;
    return check(await this.db.rpc('image_visual_set', { p_items: items }), 'image_visual_set');
  }
}
