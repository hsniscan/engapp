// Practice round state ("Pratik turu"). Pure round logic lives in domain/practice.ts; this
// hook loads card views, times answers and stores each answer with recordPractice, which
// writes practice_logs only. The schedule of a card never changes here.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getCardView, getPracticeCards, logError, recordPractice, type CardView } from '@/data';
import { uuidv7 } from '@/domain/ids';
import {
  answerRound,
  currentCard,
  isRoundDone,
  type PracticeResult,
  type PracticeRound,
  startRound,
} from '@/domain/practice';
import type { Id } from '@/domain/types';
import type { PracticeParams } from '@/features/extra/links';

export const MAX_PRACTICE_ANSWER_MS = 60_000;

export type PracticePhase = 'loading' | 'card' | 'empty' | 'done';

export interface PracticeState {
  phase: PracticePhase;
  view: CardView | null;
  /** Second showing of a card missed earlier in the round. */
  repeat: boolean;
  flipped: boolean;
  round: PracticeRound;
}

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function usePracticeSession(params: PracticeParams) {
  const [state, setState] = useState<PracticeState>({
    phase: 'loading',
    view: null,
    repeat: false,
    flipped: false,
    round: startRound([]),
  });
  const stateRef = useRef(state);
  const views = useRef(new Map<Id, Promise<CardView | null>>());
  /** Views of every card shown, for the summary (terms of the hardest words). */
  const [shown] = useState(() => new Map<Id, CardView>());
  const sessionId = useRef(uuidv7());
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const shownAt = useRef(clock());
  const timeMs = useRef(0);
  const alive = useRef(true);
  /** The next card is being loaded: ignore answers until it is on screen. */
  const switching = useRef(false);

  const patch = useCallback((p: Partial<PracticeState>) => {
    if (!alive.current) return;
    stateRef.current = { ...stateRef.current, ...p };
    setState(stateRef.current);
  }, []);

  const loadView = useCallback((id: Id) => {
    let p = views.current.get(id);
    if (!p) {
      p = getCardView(id).catch((e: unknown) => {
        void logError(e, 'practice:getCardView');
        return null;
      });
      views.current.set(id, p);
    }
    return p;
  }, []);

  /** Show the round's current card, dropping cards that were deleted or suspended meanwhile. */
  const showCurrent = useCallback(
    async (round: PracticeRound) => {
      let r = round;
      for (;;) {
        const cur = currentCard(r);
        if (!cur) {
          patch({
            phase: r.answers.length ? 'done' : 'empty',
            view: null,
            flipped: false,
            round: r,
          });
          return;
        }
        const view = await loadView(cur.card_id);
        if (view && view.card.deleted_at === null && !view.card.suspended) {
          shown.set(cur.card_id, view);
          shownAt.current = clock();
          patch({ phase: 'card', view, repeat: cur.repeat, flipped: false, round: r });
          const next = r.queue[1];
          if (next) void loadView(next.card_id);
          return;
        }
        r = { ...r, queue: r.queue.slice(1), cards: r.cards.filter((id) => id !== cur.card_id) };
      }
    },
    [loadView, patch, shown],
  );

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const ids = await getPracticeCards(
          { source: params.source, tag: params.tag, deckId: params.deck ?? null },
          { size: params.size, seed: sessionId.current },
        );
        if (!cancelled) await showCurrent(startRound(ids));
      } catch (e) {
        void logError(e, 'practice:start');
        if (!cancelled) patch({ phase: 'empty' });
      }
    })();
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [params.source, params.tag, params.deck, params.size, patch, showCurrent]);

  const flip = useCallback(() => {
    const s = stateRef.current;
    if (s.phase === 'card' && !s.flipped) patch({ flipped: true });
  }, [patch]);

  const answer = useCallback(
    (result: PracticeResult) => {
      const s = stateRef.current;
      if (s.phase !== 'card' || !s.flipped || !s.view || switching.current) return;
      const duration = Math.min(
        MAX_PRACTICE_ANSWER_MS,
        Math.max(0, Math.round(clock() - shownAt.current)),
      );
      timeMs.current += duration;
      const cardId = s.view.card.id;
      writes.current = writes.current
        .then(() =>
          recordPractice({
            card_id: cardId,
            result,
            mode: params.source,
            session_id: sessionId.current,
            duration_ms: duration,
          }),
        )
        .catch((e: unknown) => logError(e, 'practice:record'));
      const next = answerRound(s.round, result);
      if (isRoundDone(next)) {
        patch({ phase: 'done', view: null, flipped: false, round: next });
        return;
      }
      switching.current = true;
      void showCurrent(next).finally(() => {
        switching.current = false;
      });
    },
    [params.source, patch, showCurrent],
  );

  /** Resolves when every answer is stored. */
  const settled = useCallback(() => writes.current.then(() => undefined), []);

  return {
    state,
    flip,
    answer,
    settled,
    views: shown as ReadonlyMap<Id, CardView>,
    timeMs: () => timeMs.current,
  };
}
