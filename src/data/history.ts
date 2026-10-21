// Read helpers over review_logs shared by the actions and queries.
import Dexie from 'dexie';
import { type DayBounds, type DayConfig, dayBounds } from '../domain/day';
import { effectiveLogs } from '../domain/recompute';
import { type Card, CardState, type Id, type Millis, type ReviewLog } from '../domain/types';
import { db } from './db';

/** All logs (including undo rows) of the given cards, grouped by card id. */
export async function logsByCard(cardIds: Iterable<Id>): Promise<Map<Id, ReviewLog[]>> {
  const ids = [...new Set(cardIds)];
  const map = new Map<Id, ReviewLog[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return map;
  const rows = await db.review_logs.where('card_id').anyOf(ids).toArray();
  for (const r of rows) map.get(r.card_id)?.push(r);
  return map;
}

export function groupLogs(rows: Iterable<ReviewLog>): Map<Id, ReviewLog[]> {
  const map = new Map<Id, ReviewLog[]>();
  for (const r of rows) {
    const list = map.get(r.card_id);
    if (list) list.push(r);
    else map.set(r.card_id, [r]);
  }
  return map;
}

export interface TodayFacts {
  bounds: DayBounds;
  /** Today's non-undone answers, oldest first. */
  answers: ReviewLog[];
  reviewedCardIds: Set<Id>;
  reviewedNoteIds: Set<Id>;
  /** Cards whose first non-undone answer is today. */
  newIntroducedToday: number;
  timeMs: number;
}

export async function loadTodayFacts(cfg: DayConfig, now: Millis): Promise<TodayFacts> {
  const bounds = dayBounds(now, cfg);
  const todays = await db.review_logs.where('reviewed_at').between(bounds.start, bounds.end, true, false).toArray();
  const cardIds = new Set(todays.map((l) => l.card_id));
  const all = await logsByCard(cardIds);
  const answers: ReviewLog[] = [];
  let newIntroducedToday = 0;
  for (const logs of all.values()) {
    const eff = effectiveLogs(logs);
    if (eff.length && eff[0]!.reviewed_at >= bounds.start && eff[0]!.reviewed_at < bounds.end) newIntroducedToday++;
    for (const l of eff) if (l.reviewed_at >= bounds.start && l.reviewed_at < bounds.end) answers.push(l);
  }
  answers.sort((a, b) => a.reviewed_at - b.reviewed_at);
  const reviewedCardIds = new Set(answers.map((l) => l.card_id));
  const cards = await db.cards.bulkGet([...reviewedCardIds]);
  const reviewedNoteIds = new Set(cards.filter((c): c is Card => !!c).map((c) => c.note_id));
  return {
    bounds,
    answers,
    reviewedCardIds,
    reviewedNoteIds,
    newIntroducedToday,
    timeMs: answers.reduce((a, l) => a + l.duration_ms, 0),
  };
}

/** Studied cards (learning, review, relearning) due before `until`, via the [state+due] index. */
export async function dueStudiedCards(until: Millis): Promise<Card[]> {
  const states = [CardState.Learning, CardState.Review, CardState.Relearning];
  const parts = await Promise.all(
    states.map((s) => db.cards.where('[state+due]').between([s, Dexie.minKey], [s, until], true, false).toArray()),
  );
  return parts.flat();
}

export function newCards(): Promise<Card[]> {
  return db.cards.where('[state+due]').between([CardState.New, Dexie.minKey], [CardState.New, Dexie.maxKey]).toArray();
}
