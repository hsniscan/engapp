// In-memory ImageStore for tests. The budget ledger follows the SQL functions of migration
// 20261025000200_images.sql (image_budget_reserve / _settle): a reservation is refused when
// spent + reserved + amount > cap, each call is atomic.

import type { ImageRequestInput, LexiconImageRow } from '../image-contract.ts';
import type { BudgetPurpose, NewImage } from '../image-pipeline.ts';
import type { InstantStore } from '../image-instant.ts';

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

export class BudgetLedger {
  spent = 0;
  reserved = 0;
  cap = 0;
  readonly holds = new Map<string, number>();
  private n = 0;

  reserve(amount: number, cap: number): string | null {
    if (!(amount > 0) || cap < 0) throw new Error('invalid arguments');
    if (amount > cap) return null;
    if (r6(this.spent + this.reserved + amount) > cap) return null;
    this.cap = cap;
    this.reserved = r6(this.reserved + amount);
    const id = `hold-${++this.n}`;
    this.holds.set(id, amount);
    return id;
  }

  settle(id: string, actual: number): void {
    const amount = this.holds.get(id) ?? 0;
    this.holds.delete(id);
    this.reserved = r6(Math.max(0, this.reserved - amount));
    this.spent = r6(this.spent + actual);
  }
}

export class MemoryImageStore implements InstantStore {
  readonly ledger = new BudgetLedger();
  readonly images: (LexiconImageRow & {
    cost_usd: number;
    checks: Record<string, unknown>;
    model: string | null;
  })[] = [];
  readonly requests = new Map<string, { state: string; source?: string }>();
  readonly purposes: BudgetPurpose[] = [];
  readonly daily = new Map<string, number>();
  senses = new Map<string, ImageRequestInput>();
  /** user id → lexicon sense ids in their cards */
  cards = new Map<string, Set<string>>();

  async reserve(amountUsd: number, capUsd: number, purpose: BudgetPurpose) {
    this.purposes.push(purpose);
    return this.ledger.reserve(amountUsd, capUsd);
  }

  async settle(holdId: string, actualUsd: number) {
    this.ledger.settle(holdId, actualUsd);
  }

  async insertImage(row: NewImage) {
    const variant = this.images.filter((i) => i.sense_id === row.sense_id).length;
    const out = {
      id: `00000000-0000-4000-8000-${String(this.images.length + 1).padStart(12, '0')}`,
      sense_id: row.sense_id,
      variant,
      svg: row.svg,
      alt_tr: row.alt_tr,
      status: row.status,
      created_at: '2026-10-25T00:00:00.000Z',
      cost_usd: row.cost_usd,
      checks: row.checks,
      model: row.model,
    };
    this.images.push(out);
    return out;
  }

  async consumeDaily(userId: string, limit: number) {
    const used = this.daily.get(userId) ?? 0;
    if (used + 1 > limit) return { allowed: false, used, limit };
    this.daily.set(userId, used + 1);
    return { allowed: true, used: used + 1, limit };
  }

  async userHasSense(userId: string, senseId: string) {
    return this.cards.get(userId)?.has(senseId) ?? false;
  }

  async senseInputs(ids: string[]) {
    return ids.flatMap((id) => (this.senses.has(id) ? [this.senses.get(id)!] : []));
  }

  async upsertRequest(senseId: string, patch: { state: string; source?: 'auto' | 'user' }) {
    this.requests.set(senseId, { ...this.requests.get(senseId), ...patch });
  }
}
