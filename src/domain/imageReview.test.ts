import { describe, expect, it } from 'vitest';
import {
  addReviewItems,
  decideReviewItem,
  emptyReviewQueue,
  flushReviewDecision,
  needsRefill,
  requeueReviewItem,
  REVIEW_PAGE,
  reviewFetchLimit,
  undoReviewDecision,
  type ReviewItem,
} from './imageReview';

const item = (n: number): ReviewItem => ({
  id: `img-${n}`,
  lemma: `word${n}`,
  pos: 'noun',
  gloss_tr: `anlam ${n}`,
  svg: '<svg/>',
  alt_tr: `görsel ${n}`,
});
const items = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => item(from + i));

describe('image review queue', () => {
  it('starts empty and wants a page', () => {
    const s = emptyReviewQueue();
    expect(needsRefill(s)).toBe(true);
    expect(reviewFetchLimit(s)).toBe(REVIEW_PAGE);
  });

  it('a refill never brings back a picture already queued or decided', () => {
    let s = addReviewItems(emptyReviewQueue(), items(0, 20), true);
    expect(s.items).toHaveLength(20);
    s = decideReviewItem(s, 'approve').state;
    s = decideReviewItem(s, 'redraw').state;
    // The server has not seen the decisions yet and answers with the same rows again.
    const limit = reviewFetchLimit(s);
    expect(limit).toBe(REVIEW_PAGE + 18 + 1);
    s = addReviewItems(s, items(0, 25), false);
    expect(s.items.map((i) => i.id)).toEqual([...items(2, 20), ...items(20, 25)].map((i) => i.id));
    expect(s.more).toBe(false);
    expect(needsRefill(s)).toBe(false);
  });

  it('a full page with nothing new stops asking', () => {
    let s = addReviewItems(emptyReviewQueue(), items(0, 3), true);
    s = addReviewItems(s, items(0, 3), true);
    expect(s.more).toBe(false);
  });

  it('the last decision waits; the next one sends it', () => {
    let s = addReviewItems(emptyReviewQueue(), items(0, 3), false);
    const a = decideReviewItem(s, 'reject', 'ugly');
    expect(a.send).toBeNull();
    expect(a.state.pending).toEqual({ item: item(0), decision: 'reject', reason: 'ugly' });
    const b = decideReviewItem(a.state, 'approve', 'ugly');
    expect(b.send).toEqual({ item: item(0), decision: 'reject', reason: 'ugly' });
    expect(b.state.pending).toEqual({ item: item(1), decision: 'approve', reason: null });
    expect(b.state.decided).toBe(2);
    s = b.state;
    const f = flushReviewDecision(s);
    expect(f.send?.item.id).toBe('img-1');
    expect(f.state.pending).toBeNull();
  });

  it('a reject without a reason is "other"', () => {
    const s = addReviewItems(emptyReviewQueue(), items(0, 1), false);
    expect(decideReviewItem(s, 'reject').state.pending?.reason).toBe('other');
  });

  it('"Geri al" puts the picture back on screen', () => {
    let s = addReviewItems(emptyReviewQueue(), items(0, 3), false);
    s = decideReviewItem(s, 'approve').state;
    const u = undoReviewDecision(s);
    expect(u.undone?.item.id).toBe('img-0');
    expect(u.state.items[0]?.id).toBe('img-0');
    expect(u.state.pending).toBeNull();
    expect(u.state.decided).toBe(0);
    expect(undoReviewDecision(u.state).undone).toBeNull();
  });

  it('a decision the server refused goes to the end of the queue, once', () => {
    let s = addReviewItems(emptyReviewQueue(), items(0, 3), false);
    s = decideReviewItem(s, 'approve').state;
    s = decideReviewItem(s, 'approve').state;
    s = requeueReviewItem(s, item(0));
    expect(s.items.map((i) => i.id)).toEqual(['img-2', 'img-0']);
    expect(requeueReviewItem(s, item(0))).toBe(s);
    expect(requeueReviewItem(s, item(1))).toBe(s); // still pending
  });

  it('decides nothing on an empty queue', () => {
    const s = emptyReviewQueue();
    expect(decideReviewItem(s, 'approve')).toEqual({ state: s, send: null });
  });
});
