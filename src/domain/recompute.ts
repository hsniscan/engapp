// Rebuild FSRS state from the immutable review log. Used after undo, after sync pulls
// new logs, after a backup restore and by the integrity repair.
import { applyRating, emptyFsrs, type Scheduler } from './fsrs';
import { type Card, type CardStateValue, CardState, type FsrsFields, type Id, type Millis, type ReviewLog } from './types';

export function compareLogs(a: ReviewLog, b: ReviewLog): number {
  if (a.reviewed_at !== b.reviewed_at) return a.reviewed_at - b.reviewed_at;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Answers that still count: duplicates (same id) collapsed, undo rows and the rows they
 * cancel removed, sorted by reviewed_at then id. Input order does not matter.
 */
export function effectiveLogs(logs: Iterable<ReviewLog>): ReviewLog[] {
  const byId = new Map<Id, ReviewLog>();
  for (const l of logs) if (!byId.has(l.id)) byId.set(l.id, l);
  const cancelled = new Set<Id>();
  for (const l of byId.values()) if (l.undo_of !== null) cancelled.add(l.undo_of);
  const out: ReviewLog[] = [];
  for (const l of byId.values()) {
    if (l.undo_of === null && !cancelled.has(l.id)) out.push(l);
  }
  return out.sort(compareLogs);
}

export interface ReplayStep {
  log: ReviewLog;
  before: FsrsFields;
  after: FsrsFields;
}

export interface ReplayResult {
  fsrs: FsrsFields;
  steps: ReplayStep[];
}

/**
 * Replay a card's logs from an empty card. `logs` may contain undo rows, duplicates and
 * logs of other cards (ignored); the result depends only on the set of rows.
 */
export function replayCard(
  scheduler: Scheduler,
  card: { id: Id; created_at: Millis },
  logs: Iterable<ReviewLog>,
): ReplayResult {
  const own: ReviewLog[] = [];
  for (const l of logs) if (l.card_id === card.id) own.push(l);
  let fsrs = emptyFsrs(card.created_at);
  const steps: ReplayStep[] = [];
  for (const log of effectiveLogs(own)) {
    const after = applyRating(scheduler, { id: card.id, ...fsrs }, log.rating, log.reviewed_at);
    steps.push({ log, before: fsrs, after });
    fsrs = after;
  }
  return { fsrs, steps };
}

/** Recognition has reached Review at least once (Relearning only follows Review). */
export function recognitionUnlocks(state: CardStateValue): boolean {
  return state === CardState.Review || state === CardState.Relearning;
}

/**
 * Whether a card may be shown. Recognition cards always; production/cloze cards once the
 * note's recognition card has reached Review, or once they have history of their own
 * (so an undo on the recognition card never hides a card that was already studied).
 */
export function deriveUnlocked(
  card: Pick<Card, 'card_type'> & Pick<FsrsFields, 'state' | 'reps'>,
  recognitionState: CardStateValue | null,
): boolean {
  if (card.card_type === 'recognition') return true;
  if (card.reps > 0 || card.state !== CardState.New) return true;
  return recognitionState !== null && recognitionUnlocks(recognitionState);
}
