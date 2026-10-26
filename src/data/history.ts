// Read helpers over review_logs shared by the actions and queries.
import Dexie from 'dexie';
import { type DayBounds, type DayConfig, dayBounds } from '../domain/day';
import { effectiveLogs } from '../domain/recompute';
import { type Card, CardState, type CardType, type Id, type Millis, type ReviewLog } from '../domain/types';
import { db } from './db';

/** Above this many cards logsByCard reads the whole log table once instead. */
const LOGS_BY_CARD_SCAN = 3000;

/** All logs (including undo rows) of the given cards, grouped by card id. */
export async function logsByCard(cardIds: Iterable<Id>): Promise<Map<Id, ReviewLog[]>> {
  const ids = [...new Set(cardIds)];
  const map = new Map<Id, ReviewLog[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return map;
  // One getAll per card, not anyOf: Dexie walks anyOf with one cursor that jumps from key to
  // key, a round trip to IndexedDB per log row, which took seconds for a few hundred cards
  // with long histories (10,000-card profile, decision 0053). Very large sets read the table.
  if (ids.length > LOGS_BY_CARD_SCAN) {
    for (const r of await db.review_logs.toArray()) map.get(r.card_id)?.push(r);
    return map;
  }
  // Dexie.Promise.all, not the native one: hundreds of native awaits in one transaction
  // outrun Dexie's zone tracking and the transaction commits early (PrematureCommitError).
  const lists = await Dexie.Promise.all(ids.map((id) => db.review_logs.where('card_id').equals(id).toArray()));
  ids.forEach((id, i) => map.set(id, lists[i]!));
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
  /** Notes of those cards, in the order they were introduced (smart new-card order). */
  introducedNoteIds: Id[];
  /** newIntroducedToday by card type (each study mode has its own first-time counter). */
  introducedByType: Record<CardType, number>;
  /** Notes whose recognition card was answered today (study-mode burying). */
  recognitionNoteIds: Set<Id>;
  timeMs: number;
}

export async function loadTodayFacts(cfg: DayConfig, now: Millis): Promise<TodayFacts> {
  const bounds = dayBounds(now, cfg);
  const todays = await db.review_logs.where('reviewed_at').between(bounds.start, bounds.end, true, false).toArray();
  const cardIds = new Set(todays.map((l) => l.card_id));
  const all = await logsByCard(cardIds);
  const answers: ReviewLog[] = [];
  let newIntroducedToday = 0;
  const introduced: ReviewLog[] = [];
  for (const logs of all.values()) {
    const eff = effectiveLogs(logs);
    if (eff.length && eff[0]!.reviewed_at >= bounds.start && eff[0]!.reviewed_at < bounds.end) {
      newIntroducedToday++;
      introduced.push(eff[0]!);
    }
    for (const l of eff) if (l.reviewed_at >= bounds.start && l.reviewed_at < bounds.end) answers.push(l);
  }
  answers.sort((a, b) => a.reviewed_at - b.reviewed_at);
  const reviewedCardIds = new Set(answers.map((l) => l.card_id));
  const cards = await db.cards.bulkGet([...reviewedCardIds]);
  const live = cards.filter((c): c is Card => !!c);
  const noteOf = new Map(live.map((c) => [c.id, c.note_id]));
  const typeOf = new Map(live.map((c) => [c.id, c.card_type]));
  const reviewedNoteIds = new Set(noteOf.values());
  const recognitionNoteIds = new Set(live.filter((c) => c.card_type === 'recognition').map((c) => c.note_id));
  const introducedByType: Record<CardType, number> = { recognition: 0, production: 0, cloze: 0, image: 0 };
  for (const l of introduced) {
    const type = typeOf.get(l.card_id);
    if (type) introducedByType[type]++;
  }
  introduced.sort((a, b) => a.reviewed_at - b.reviewed_at || (a.id < b.id ? -1 : 1));
  const introducedNoteIds = [...new Set(introduced.map((l) => noteOf.get(l.card_id)).filter((x): x is Id => !!x))];
  return {
    bounds,
    answers,
    reviewedCardIds,
    reviewedNoteIds,
    newIntroducedToday,
    introducedNoteIds,
    introducedByType,
    recognitionNoteIds,
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
