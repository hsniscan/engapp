// The picture review queue of the admin screen (v0.4 İP4, docs/decisions/0032-image-review.md).
// Pure state: an optimistic queue (the next picture shows at once), the last decision held back
// until the next one so it can be undone, and refills that never bring back a picture already
// decided in this session. Sending decisions is the screen's job.
import type { ImageRejectReason } from './images';
import type { Id } from './types';

export type ReviewDecisionKind = 'approve' | 'reject' | 'redraw';

export interface ReviewItem {
  /** lexicon_images.id */
  id: Id;
  lemma: string;
  pos: string | null;
  gloss_tr: string;
  svg: string;
  alt_tr: string;
}

export interface ReviewDecision {
  item: ReviewItem;
  decision: ReviewDecisionKind;
  reason: ImageRejectReason | null;
}

export interface ReviewQueueState {
  /** Waiting pictures; the first one is on screen. */
  items: ReviewItem[];
  /** Every id this session has seen (queued, decided or sent): refills skip them. */
  seen: Id[];
  /** The last decision, not sent yet: "Geri al" takes it back. */
  pending: ReviewDecision | null;
  /** The last refill came back full: the server may have more. */
  more: boolean;
  /** Decisions sent or pending in this session. */
  decided: number;
}

/** The screen keeps this many pictures queued (plan: an optimistic queue of 20). */
export const REVIEW_PAGE = 20;
/** Ask for more when fewer than this are left. */
export const REVIEW_REFILL_AT = 5;

export const emptyReviewQueue = (): ReviewQueueState => ({ items: [], seen: [], pending: null, more: true, decided: 0 });

/**
 * How many rows to ask for: the server answers oldest first and does not know about pictures
 * still queued here or decided but not sent, so ask for that many on top of a page.
 */
export const reviewFetchLimit = (state: ReviewQueueState): number =>
  REVIEW_PAGE + state.items.length + (state.pending ? 1 : 0);

/**
 * Add a page from the server; `full` = it had as many rows as asked for. A full page with
 * nothing new means the rest are decisions still on their way: no more for now.
 */
export function addReviewItems(state: ReviewQueueState, rows: readonly ReviewItem[], full: boolean): ReviewQueueState {
  const seen = new Set(state.seen);
  const fresh = rows.filter((r) => !seen.has(r.id) && seen.add(r.id));
  return { ...state, items: [...state.items, ...fresh], seen: [...seen], more: full && fresh.length > 0 };
}

/**
 * Decide on the picture on screen. The previous pending decision is returned in `send` (it can
 * no longer be undone); this one becomes pending.
 */
export function decideReviewItem(
  state: ReviewQueueState,
  decision: ReviewDecisionKind,
  reason: ImageRejectReason | null = null,
): { state: ReviewQueueState; send: ReviewDecision | null } {
  const [item, ...rest] = state.items;
  if (!item) return { state, send: null };
  return {
    state: {
      ...state,
      items: rest,
      pending: { item, decision, reason: decision === 'reject' ? (reason ?? 'other') : null },
      decided: state.decided + 1,
    },
    send: state.pending,
  };
}

/** "Geri al": the pending decision is dropped and its picture is on screen again. */
export function undoReviewDecision(state: ReviewQueueState): { state: ReviewQueueState; undone: ReviewDecision | null } {
  const p = state.pending;
  if (!p) return { state, undone: null };
  return { state: { ...state, items: [p.item, ...state.items], pending: null, decided: state.decided - 1 }, undone: p };
}

/** Leaving the screen: the pending decision is sent. */
export function flushReviewDecision(state: ReviewQueueState): { state: ReviewQueueState; send: ReviewDecision | null } {
  return { state: { ...state, pending: null }, send: state.pending };
}

/** A decision the server did not take: its picture goes back to the end of the queue. */
export function requeueReviewItem(state: ReviewQueueState, item: ReviewItem): ReviewQueueState {
  if (state.items.some((i) => i.id === item.id) || state.pending?.item.id === item.id) return state;
  return { ...state, items: [...state.items, item], decided: Math.max(0, state.decided - 1) };
}

export const needsRefill = (state: ReviewQueueState): boolean => state.more && state.items.length < REVIEW_REFILL_AT;
