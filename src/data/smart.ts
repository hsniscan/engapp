// Smart review, data side (v0.5 İP10, docs/decisions/0052-smart-review.md).
//
// Interference guard carry: the new cards the guard held back (domain/newOrder.ts
// NewSelection.postponed) are kept in one device-local meta row and passed back as
// NewOrderInput.carry, so they come first on a later day. Device-local on purpose: it only
// orders new cards, and another device that never saw the postponement simply keeps its own
// order (the guard itself still holds there, because it reads the synced logs).
import { CardState, type Id } from '../domain/types';
import { db } from './db';
import { getMeta, setMeta } from './meta';

/** Meta key of the carried card ids, oldest postponement first. */
export const CARRY_KEY = 'smart_carry';
/** Longest carry kept (a day's limit is far smaller; older entries fall off). */
export const MAX_CARRY = 100;

/** The carried card ids (empty when none). Callable inside a transaction that reads meta. */
export async function readCarry(): Promise<Id[]> {
  const v = await getMeta<unknown>(CARRY_KEY);
  return Array.isArray(v) ? v.filter((x): x is Id => typeof x === 'string') : [];
}

/** Merge newly postponed cards into the carry; cards that are no longer new fall out. */
export function carryAfter(current: readonly Id[], postponed: readonly Id[], stillNew: ReadonlySet<Id>): Id[] {
  const out: Id[] = [];
  const seen = new Set<Id>();
  for (const id of [...current, ...postponed]) {
    if (seen.has(id) || !stillNew.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.slice(-MAX_CARRY);
}

/**
 * Keep the cards the guard postponed in this queue (StudyQueue.postponed). Call it outside a
 * live query (the review session does, after building its queue). Writes only on a change.
 */
export async function rememberPostponed(postponed: readonly Id[]): Promise<void> {
  await db.transaction('rw', db.meta, db.cards, async () => {
    const current = await readCarry();
    if (postponed.length === 0 && current.length === 0) return;
    const ids = [...new Set([...current, ...postponed])];
    const rows = await db.cards.bulkGet(ids);
    const stillNew = new Set(
      rows.filter((c) => !!c && c.deleted_at === null && c.state === CardState.New).map((c) => c!.id),
    );
    const next = carryAfter(current, postponed, stillNew);
    if (next.length === current.length && next.every((id, i) => id === current[i])) return;
    await setMeta(CARRY_KEY, next);
  });
}
