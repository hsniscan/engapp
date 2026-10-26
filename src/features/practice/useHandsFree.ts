// The hands-free round's player (v0.5 İP9, ADR 0051): walks the steps of each word (English
// word, pause, Turkish meaning, sentence) and answers Duraklat / Devam / Sonraki / Bitir.
// Every finished step checks a run token, so a voice that reports "done" late (after a pause
// or a skip) never moves the round. It writes nothing anywhere.
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { handsFreeSteps, type HandsFreeItem, type HandsFreeStep } from '@/domain/handsFree';
import type { VoicePref } from '@/features/review/useSpeech';
import type { HandsFreeVoice } from './handsFreeVoice';

export type HandsFreeStatus = 'ready' | 'playing' | 'paused' | 'done';

export interface HandsFreeState {
  status: HandsFreeStatus;
  index: number;
  step: number;
}

type Action =
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'advance'; count: number; stepsOf: (i: number) => number }
  | { type: 'next'; count: number }
  | { type: 'stop' };

function reducer(s: HandsFreeState, a: Action): HandsFreeState {
  switch (a.type) {
    case 'start':
      return { status: 'playing', index: 0, step: 0 };
    case 'pause':
      return s.status === 'playing' ? { ...s, status: 'paused' } : s;
    case 'resume':
      return s.status === 'paused' ? { ...s, status: 'playing' } : s;
    case 'advance': {
      if (s.status !== 'playing') return s;
      if (s.step + 1 < a.stepsOf(s.index)) return { ...s, step: s.step + 1 };
      return s.index + 1 < a.count ? { ...s, index: s.index + 1, step: 0 } : { ...s, status: 'done' };
    }
    case 'next':
      if (s.status === 'done' || s.status === 'ready') return s;
      return s.index + 1 < a.count ? { status: 'playing', index: s.index + 1, step: 0 } : { ...s, status: 'done' };
    case 'stop':
      return { ...s, status: 'done' };
  }
}

export interface HandsFreeTimers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

const windowTimers: HandsFreeTimers = {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id as number),
};

export function useHandsFree(
  items: readonly HandsFreeItem[],
  voice: HandsFreeVoice,
  englishVoice: VoicePref,
  timers: HandsFreeTimers = windowTimers,
) {
  const [state, dispatch] = useReducer(reducer, { status: 'ready', index: 0, step: 0 });
  const token = useRef(0);
  const allSteps = useMemo(() => items.map(handsFreeSteps), [items]);
  const stepsOf = useCallback((i: number): HandsFreeStep[] => allSteps[i] ?? [], [allSteps]);

  useEffect(() => {
    if (state.status !== 'playing') return;
    const step = stepsOf(state.index)[state.step];
    const my = ++token.current;
    const done = () => {
      if (token.current === my) dispatch({ type: 'advance', count: items.length, stepsOf: (i) => stepsOf(i).length });
    };
    if (!step) {
      done();
      return;
    }
    let timer: unknown = null;
    if (step.kind === 'pause') timer = timers.setTimeout(done, step.ms);
    else if (step.kind === 'tr') voice.turkish(step.text, done);
    else voice.english(step.text, englishVoice, done);
    return () => {
      if (timer !== null) timers.clearTimeout(timer);
    };
  }, [state.status, state.index, state.step, items.length, stepsOf, voice, englishVoice, timers]);

  const halt = useCallback(() => {
    token.current++;
    voice.stop();
  }, [voice]);

  const actions = {
    start: useCallback(() => dispatch({ type: 'start' }), []),
    pause: useCallback(() => {
      halt();
      dispatch({ type: 'pause' });
    }, [halt]),
    resume: useCallback(() => dispatch({ type: 'resume' }), []),
    next: useCallback(() => {
      halt();
      dispatch({ type: 'next', count: items.length });
    }, [halt, items.length]),
    stop: useCallback(() => {
      halt();
      dispatch({ type: 'stop' });
    }, [halt]),
  };

  // Leaving the screen stops the voice.
  useEffect(() => () => halt(), [halt]);

  return { state, steps: stepsOf(state.index), actions };
}
