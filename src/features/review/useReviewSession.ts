// Review session state. Card switches are optimistic: the next card's view is prefetched
// and shown at once, while the answer is written and the queue is rebuilt in the background
// (serialised through one promise chain). The rebuild is how learning cards that fall due
// again during the session re-enter the queue.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionError,
  answerCard,
  getCardView,
  getStreakSummary,
  getStudyQueue,
  logError,
  setSuspended,
  undoAnswer,
  type CardView,
} from '@/data';
import type { QueueItem, QueueKind, QueueMode } from '@/domain/queue';
import type { Id, RatingValue } from '@/domain/types';

export const MAX_ANSWER_MS = 60_000;

export interface CurrentCard {
  view: CardView;
  kind: QueueKind;
}

export interface SessionAnswer {
  cardId: Id;
  kind: QueueKind;
  rating: RatingValue;
  durationMs: number;
  /** Set once the write has finished. */
  logId: Id | null;
  view: CardView;
}

export type SessionPhase = 'loading' | 'card' | 'waiting' | 'done';

export interface SessionState {
  phase: SessionPhase;
  current: CurrentCard | null;
  flipped: boolean;
  /** Answers in this session (undone ones removed). */
  answered: number;
  /** Cards left, including the one on screen. */
  remaining: number;
  canUndo: boolean;
}

export interface SessionStart {
  todayActive: boolean;
  streak: number;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function useReviewSession(mode: QueueMode = 'normal') {
  const [state, setState] = useState<SessionState>({
    phase: 'loading',
    current: null,
    flipped: false,
    answered: 0,
    remaining: 0,
    canUndo: false,
  });
  const [start, setStart] = useState<SessionStart | null>(null);

  // Source of truth for event handlers; `state` mirrors it for rendering.
  const stateRef = useRef(state);
  const upcoming = useRef<QueueItem[]>([]);
  const views = useRef(new Map<Id, CardView | null>());
  const pendingViews = useRef(new Map<Id, Promise<CardView | null>>());
  const chain = useRef<Promise<void>>(Promise.resolve());
  const seq = useRef(0);
  const counts = useRef({ reviews: 0, new: 0 });
  const answers = useRef<SessionAnswer[]>([]);
  const shownAt = useRef(now());
  const alive = useRef(true);

  const patch = useCallback((p: Partial<SessionState>) => {
    if (!alive.current) return;
    const next = { ...stateRef.current, ...p };
    stateRef.current = next;
    setState(next);
  }, []);

  const loadView = useCallback((id: Id): Promise<CardView | null> => {
    if (views.current.has(id)) return Promise.resolve(views.current.get(id)!);
    let p = pendingViews.current.get(id);
    if (!p) {
      p = getCardView(id)
        .catch((e: unknown) => {
          void logError(e, 'review:getCardView');
          return null;
        })
        .then((v) => {
          pendingViews.current.delete(id);
          views.current.set(id, v);
          return v;
        });
      pendingViews.current.set(id, p);
    }
    return p;
  }, []);

  const forget = useCallback((id: Id) => {
    views.current.delete(id);
    pendingViews.current.delete(id);
  }, []);

  const prefetch = useCallback(() => {
    const next = upcoming.current[0];
    if (next) void loadView(next.card_id);
  }, [loadView]);

  const remainingCount = (current: CurrentCard | null) =>
    upcoming.current.length + (current ? 1 : 0);

  const show = useCallback(
    (current: CurrentCard) => {
      shownAt.current = now();
      patch({
        phase: 'card',
        current,
        flipped: false,
        remaining: remainingCount(current),
      });
      prefetch();
    },
    [patch, prefetch],
  );

  /** Show the next usable card from `upcoming`; returns false when none is left. */
  const advance = useCallback(async (): Promise<boolean> => {
    while (upcoming.current.length) {
      const item = upcoming.current.shift()!;
      const cached = views.current.get(item.card_id);
      const view = cached !== undefined ? cached : await loadView(item.card_id);
      if (!view || view.card.deleted_at !== null || view.card.suspended) continue;
      show({ view, kind: item.kind });
      return true;
    }
    return false;
  }, [loadView, show]);

  const finish = useCallback(() => {
    patch({ phase: 'done', current: null, flipped: false, remaining: 0 });
  }, [patch]);

  /** Rebuild the queue; applied only if nothing newer happened in the meantime. */
  const rebuild = useCallback(
    async (mySeq: number) => {
      const q = await getStudyQueue({ session: { ...counts.current }, mode });
      if (mySeq !== seq.current || !alive.current) return;
      const currentId = stateRef.current.current?.view.card.id;
      upcoming.current = q.items
        .filter((i) => i.card_id !== currentId)
        .map(({ card_id, note_id, kind }) => ({ card_id, note_id, kind }));
      const s = stateRef.current;
      if (s.phase === 'waiting') {
        if (!(await advance())) finish();
      } else {
        patch({ remaining: remainingCount(s.current) });
        prefetch();
      }
    },
    [advance, finish, patch, prefetch, mode],
  );

  const enqueue = useCallback((job: () => Promise<void>) => {
    chain.current = chain.current.then(job).catch((e: unknown) => {
      void logError(e, 'review:session');
    });
    return chain.current;
  }, []);

  // Initial load.
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    void (async () => {
      const [q, streak] = await Promise.all([getStudyQueue({ mode }), getStreakSummary()]);
      if (cancelled) return;
      setStart({ todayActive: streak.todayActive, streak: streak.currentStreak });
      upcoming.current = q.items.map(({ card_id, note_id, kind }) => ({ card_id, note_id, kind }));
      if (!(await advance()) && !cancelled) finish();
    })();
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [advance, finish, mode]);

  const flip = useCallback(() => {
    const s = stateRef.current;
    if (s.phase === 'card' && !s.flipped) patch({ flipped: true });
  }, [patch]);

  const answer = useCallback(
    (rating: RatingValue) => {
      const s = stateRef.current;
      if (s.phase !== 'card' || !s.flipped || !s.current) return;
      const { view, kind } = s.current;
      const entry: SessionAnswer = {
        cardId: view.card.id,
        kind,
        rating,
        durationMs: Math.min(MAX_ANSWER_MS, Math.max(0, Math.round(now() - shownAt.current))),
        logId: null,
        view,
      };
      answers.current.push(entry);
      if (kind === 'review') counts.current.reviews++;
      else if (kind === 'new') counts.current.new++;
      const mySeq = ++seq.current;
      forget(entry.cardId);

      void enqueue(async () => {
        try {
          const res = await answerCard({
            card_id: entry.cardId,
            rating,
            duration_ms: entry.durationMs,
            shown_sense_id: view.card.card_type === 'recognition' ? (view.sense?.id ?? null) : null,
          });
          entry.logId = res.log.id;
        } catch (e) {
          // Deleted elsewhere (another tab, sync): drop the answer and move on.
          answers.current = answers.current.filter((a) => a !== entry);
          if (!(e instanceof ActionError && (e.code === 'deleted' || e.code === 'not_found'))) {
            void logError(e, 'review:answerCard');
          }
        }
        forget(entry.cardId);
        if (alive.current)
          patch({ answered: answers.current.length, canUndo: !!answers.current.at(-1)?.logId });
        await rebuild(mySeq);
      });

      // Optimistic switch to the prefetched next card.
      const next = upcoming.current[0];
      const cached = next ? views.current.get(next.card_id) : undefined;
      if (next && cached && cached.card.deleted_at === null && !cached.card.suspended) {
        upcoming.current.shift();
        shownAt.current = now();
        patch({
          current: { view: cached, kind: next.kind },
          flipped: false,
          answered: answers.current.length,
          remaining: upcoming.current.length + 1,
          canUndo: false,
        });
        prefetch();
      } else {
        patch({
          phase: 'waiting',
          current: null,
          flipped: false,
          answered: answers.current.length,
          canUndo: false,
        });
        void enqueue(async () => {
          if (stateRef.current.phase !== 'waiting') return;
          if (!(await advance())) finish();
        });
      }
    },
    [advance, enqueue, finish, forget, patch, prefetch, rebuild],
  );

  /** Undo the session's last answer and show that card again. */
  const undo = useCallback(async () => {
    const mySeq = ++seq.current;
    await chain.current;
    const last = answers.current.at(-1);
    if (!last?.logId) return false;
    try {
      await undoAnswer(last.logId);
    } catch (e) {
      void logError(e, 'review:undo');
      return false;
    }
    answers.current.pop();
    if (last.kind === 'review') counts.current.reviews--;
    else if (last.kind === 'new') counts.current.new--;
    forget(last.cardId);
    const view = (await loadView(last.cardId)) ?? last.view;
    const prev = stateRef.current.current;
    if (prev && prev.view.card.id !== last.cardId) {
      upcoming.current.unshift({
        card_id: prev.view.card.id,
        note_id: prev.view.note.id,
        kind: prev.kind,
      });
    }
    upcoming.current = upcoming.current.filter((i) => i.card_id !== last.cardId);
    shownAt.current = now();
    patch({ answered: answers.current.length, canUndo: false });
    show({ view, kind: last.kind });
    void enqueue(() => rebuild(mySeq));
    return true;
  }, [enqueue, forget, loadView, patch, rebuild, show]);

  /** Suspend the card on screen and move on. */
  const suspendCurrent = useCallback(async () => {
    const cur = stateRef.current.current;
    if (!cur) return null;
    const mySeq = ++seq.current;
    await chain.current;
    await setSuspended({ card_ids: [cur.view.card.id] }, true);
    forget(cur.view.card.id);
    if (!(await advance())) {
      patch({ phase: 'waiting', current: null });
      await rebuild(mySeq);
      if (stateRef.current.phase === 'waiting') finish();
    } else {
      void enqueue(() => rebuild(mySeq));
    }
    return cur.view.card.id;
  }, [advance, enqueue, finish, forget, patch, rebuild]);

  /** Bring a suspended card back into the queue (toast action). */
  const unsuspend = useCallback(
    async (cardId: Id) => {
      await setSuspended({ card_ids: [cardId] }, false);
      const mySeq = ++seq.current;
      const wasDone = stateRef.current.phase === 'done';
      if (wasDone) patch({ phase: 'waiting' });
      await enqueue(() => rebuild(mySeq));
      if (wasDone && stateRef.current.phase === 'waiting') finish();
    },
    [enqueue, finish, patch, rebuild],
  );

  /** The card on screen disappeared (deleted or suspended elsewhere): skip it. */
  const skipCurrent = useCallback(async () => {
    const cur = stateRef.current.current;
    if (!cur) return;
    forget(cur.view.card.id);
    const mySeq = ++seq.current;
    if (!(await advance())) {
      patch({ phase: 'waiting', current: null });
      await enqueue(() => rebuild(mySeq));
      if (stateRef.current.phase === 'waiting') finish();
    }
  }, [advance, enqueue, finish, forget, patch, rebuild]);

  /** Reload the view of the card on screen (after an edit), keeping the flip state. */
  const refreshCurrent = useCallback(async () => {
    const cur = stateRef.current.current;
    if (!cur) return;
    forget(cur.view.card.id);
    const view = await loadView(cur.view.card.id);
    if (view && stateRef.current.current?.view.card.id === cur.view.card.id) {
      patch({ current: { view, kind: cur.kind } });
    }
  }, [forget, loadView, patch]);

  /** Resolves when every answer has been written. */
  const settled = useCallback(() => chain.current, []);
  const getAnswers = useCallback((): readonly SessionAnswer[] => answers.current, []);

  const actions = useMemo(
    () => ({
      flip,
      answer,
      undo,
      suspendCurrent,
      unsuspend,
      skipCurrent,
      refreshCurrent,
      settled,
      getAnswers,
    }),
    [
      flip,
      answer,
      undo,
      suspendCurrent,
      unsuspend,
      skipCurrent,
      refreshCurrent,
      settled,
      getAnswers,
    ],
  );
  return { state, start, ...actions, actions };
}
