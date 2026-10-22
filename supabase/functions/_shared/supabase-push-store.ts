// Real PushStore for push-send: the service-role client calls the SQL functions of
// 20261023000600_push.sql (service_role only).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CandidateRow, DueRow, PushStore, StoredSubscription } from './push-send.ts';

function check<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

export class SupabasePushStore implements PushStore {
  private readonly db: SupabaseClient;
  constructor(db: SupabaseClient) {
    this.db = db;
  }

  async candidates(): Promise<CandidateRow[]> {
    const rows = check(await this.db.rpc('push_candidates'), 'push_candidates') as (Omit<
      CandidateRow,
      'subscriptions' | 'last_review_at'
    > & {
      last_review_at: number | string | null;
      subscriptions: StoredSubscription[] | null;
    })[];
    return (rows ?? []).map((r) => ({
      ...r,
      last_review_at: r.last_review_at === null ? null : Number(r.last_review_at),
      subscriptions: r.subscriptions ?? [],
    }));
  }

  async dueCounts(items: { user_id: string; until: number }[]): Promise<DueRow[]> {
    const rows = check(
      await this.db.rpc('push_due_counts', { p_items: items }),
      'push_due_counts',
    ) as DueRow[];
    return (rows ?? []).map((r) => ({
      user_id: r.user_id,
      due: Number(r.due) || 0,
      sec_per_card: r.sec_per_card === null ? null : Number(r.sec_per_card),
    }));
  }

  async claim(userId: string, day: string, due: number): Promise<boolean> {
    return (
      check(
        await this.db.rpc('push_claim', { p_user: userId, p_day: day, p_due: due }),
        'push_claim',
      ) === true
    );
  }

  async finish(userId: string, day: string, delivered: number, failed: number): Promise<void> {
    check(
      await this.db.rpc('push_finish', {
        p_user: userId,
        p_day: day,
        p_delivered: delivered,
        p_failed: failed,
      }),
      'push_finish',
    );
  }

  async removeSubscriptions(ids: string[]): Promise<void> {
    check(
      await this.db.rpc('push_remove_subscriptions', { p_ids: ids }),
      'push_remove_subscriptions',
    );
  }

  async markDelivery(okIds: string[], failedIds: string[]): Promise<void> {
    check(
      await this.db.rpc('push_mark_delivery', { p_ok: okIds, p_failed: failedIds }),
      'push_mark_delivery',
    );
  }

  async subscriptionOf(userId: string, endpoint: string): Promise<StoredSubscription | null> {
    const r = await this.db
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', userId)
      .eq('endpoint', endpoint)
      .maybeSingle();
    return check(r, 'push_subscriptions') as StoredSubscription | null;
  }

  async checkCronToken(token: string): Promise<boolean> {
    return (
      check(
        await this.db.rpc('push_check_cron_token', { p_token: token }),
        'push_check_cron_token',
      ) === true
    );
  }
}
