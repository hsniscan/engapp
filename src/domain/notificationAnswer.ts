// Answering a card from the daily reminder (docs/decisions/0048-widget-notification-answers.md).
// Pure.
//
// The reminder notification can ask one due recognition card: "Cevabı gör" shows the meaning,
// then "Bildim" (Good) or "Bilemedim" (Again). The Android side only appends
// {id, card_id, rating, at} to a queue; the web app replays each item once, through the same
// answer action as the study screen, with the original time. So review_logs stay append-only
// and the scheduler stays the only place that changes a card.
import {
  CardState,
  Rating,
  type CardStateValue,
  type Id,
  type Millis,
  type RatingValue,
} from './types';

export type QueuedRating = 'Good' | 'Again';

export interface QueuedAnswer {
  /** UUID v7 made on the phone at answer time; becomes the review log's id (idempotence). */
  id: Id;
  card_id: Id;
  rating: QueuedRating;
  /** When the button was pressed (epoch ms). */
  at: Millis;
}

/** At most this many items are kept on the phone (a week of daily reminders is 7). */
export const MAX_QUEUED_ANSWERS = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ratingValue(r: QueuedRating): RatingValue {
  return r === 'Good' ? Rating.Good : Rating.Again;
}

function isQueuedAnswer(x: unknown): x is QueuedAnswer {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    UUID.test(o.id) &&
    typeof o.card_id === 'string' &&
    o.card_id.length > 0 &&
    (o.rating === 'Good' || o.rating === 'Again') &&
    typeof o.at === 'number' &&
    Number.isFinite(o.at) &&
    o.at > 0
  );
}

/**
 * The queue as the native side returned it: invalid items dropped, each id once, oldest first
 * (so several answers to one card replay in the order they were given).
 */
export function parseAnswerQueue(raw: unknown): QueuedAnswer[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<Id>();
  const out: QueuedAnswer[] = [];
  for (const x of list) {
    if (!isQueuedAnswer(x) || seen.has(x.id)) continue;
    seen.add(x.id);
    out.push({
      id: x.id.toLowerCase(),
      card_id: x.card_id,
      rating: x.rating,
      at: Math.floor(x.at),
    });
  }
  return out.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Items that are invalid in the raw queue (so they can be removed without being replayed). */
export function invalidQueueIds(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((x) => !isQueuedAnswer(x))
    .map((x) => (x && typeof x === 'object' ? (x as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === 'string');
}

/**
 * The answer time used for the log: the time of the button press, but never in the future (a
 * phone clock that was ahead of the clock the app reads now).
 */
export function replayTime(at: Millis, now: Millis): Millis {
  return Math.min(at, now);
}

export interface ReminderCardCandidate {
  card_id: Id;
  due: Millis;
  state: CardStateValue;
  term: string;
  meaning: string;
}

/**
 * One card per planned reminder: a recognition card in Review that is due by then, most overdue
 * first, each card at most once. Cards in learning steps are left to the study screen (their
 * next step is minutes away, which a once-a-day notification cannot follow).
 */
export function pickReminderCards<T extends ReminderCardCandidate>(
  candidates: readonly T[],
  ats: readonly Millis[],
): (T | null)[] {
  const pool = candidates
    .filter((c) => c.state === CardState.Review && c.term.trim() !== '' && c.meaning.trim() !== '')
    .sort((a, b) => a.due - b.due || (a.card_id < b.card_id ? -1 : 1));
  const used = new Set<Id>();
  return ats.map((at) => {
    const pick = pool.find((c) => c.due <= at && !used.has(c.card_id)) ?? null;
    if (pick) used.add(pick.card_id);
    return pick;
  });
}
