// The user's answer pace per card type (v0.5.3 B6, ADR 0071): recent answers read once at the
// start of a session, turned into "slow" thresholds by domain/pace.ts. Device data only.
import { type PaceSample, type SlowThresholds, slowThresholds } from '../domain/pace';
import { effectiveLogs } from '../domain/recompute';
import { db } from './db';

/** How many recent answers the pace is taken from. */
const RECENT = 1500;

export async function getSlowThresholds(): Promise<SlowThresholds> {
  const recent = await db.review_logs.orderBy('reviewed_at').reverse().limit(RECENT).toArray();
  const logs = effectiveLogs(recent).filter((l) => l.origin !== 'anki' && l.answer_mode !== 'choice');
  const cards = await db.cards.bulkGet([...new Set(logs.map((l) => l.card_id))]);
  const typeOf = new Map(cards.flatMap((c) => (c ? [[c.id, c.card_type] as const] : [])));
  const samples: PaceSample[] = [];
  for (const l of logs) {
    const type = typeOf.get(l.card_id);
    if (type) samples.push({ card_type: type, rating: l.rating, duration_ms: l.duration_ms });
  }
  return slowThresholds(samples);
}
