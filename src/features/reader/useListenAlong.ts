// "Dinleyerek oku" (v0.5 İP1, decision 0043): the text is read aloud one sentence at a time and
// the screen marks the sentence being read. A sentence plays from pre-generated audio when it
// is already in memory (library texts, İP5), otherwise with the device voice. The user's own
// text is never sent to the TTS function: nothing of it leaves the device.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deviceVoice,
  playPronunciation,
  prefetchPregenerated,
  pronunciationReady,
} from '@/features/review/pronunciation';
import type { VoicePref } from '@/features/review/useSpeech';

export interface ListenAlongDeps {
  ready: (text: string, voice: VoicePref) => boolean;
  playReady: (text: string, voice: VoicePref, onDone: () => void) => boolean;
  device: (text: string, voice: VoicePref, onDone: () => void) => boolean;
  prefetch: (texts: readonly string[], voice: VoicePref) => void;
  cancel: () => void;
}

const defaultDeps: ListenAlongDeps = {
  ready: pronunciationReady,
  playReady: (text, voice, onDone) => playPronunciation(text, voice, { onDone }),
  device: (text, voice, onDone) => deviceVoice(text, voice, onDone),
  prefetch: (texts, voice) => void prefetchPregenerated(texts, voice),
  cancel: () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window)
      window.speechSynthesis.cancel();
  },
};

export interface ListenAlong {
  /** Index of the sentence being read, or null. */
  current: number | null;
  /** Start (inside a tap) from sentence `i`. Returns false when there is no voice. */
  start: (i: number) => boolean;
  stop: () => void;
}

/**
 * `sentences`: the text of each sentence. `pregenerated`: whether the text may have
 * pre-generated audio (library and story texts), so the next sentences are fetched ahead.
 */
export function useListenAlong(
  sentences: readonly string[],
  voice: VoicePref,
  pregenerated: boolean,
  deps: ListenAlongDeps = defaultDeps,
): ListenAlong {
  const [current, setCurrent] = useState<number | null>(null);
  const run = useRef(0);
  const live = useRef({ sentences, voice, pregenerated, deps });
  useEffect(() => {
    live.current = { sentences, voice, pregenerated, deps };
  });

  const stop = useCallback(() => {
    run.current++;
    setCurrent(null);
    live.current.deps.cancel();
  }, []);

  const step = useCallback(function step(i: number, id: number): boolean {
    if (id !== run.current) return false;
    const { sentences: list, voice: v, pregenerated: pre, deps: d } = live.current;
    // Skip sentences with nothing to say (a lone number, a dash).
    let k = i;
    while (k < list.length && !/\p{L}/u.test(list[k]!)) k++;
    if (k >= list.length) {
      setCurrent(null);
      return false;
    }
    setCurrent(k);
    if (pre) d.prefetch(list.slice(k + 1, k + 3), v);
    const onDone = () => {
      if (id === run.current) step(k + 1, id);
    };
    const text = list[k]!;
    const ok = d.ready(text, v) ? d.playReady(text, v, onDone) : d.device(text, v, onDone);
    if (!ok) {
      run.current++;
      setCurrent(null);
    }
    return ok;
  }, []);

  const start = useCallback(
    (i: number) => {
      live.current.deps.cancel();
      const id = ++run.current;
      return step(Math.max(0, i), id);
    },
    [step],
  );

  // Leaving the screen stops the voice.
  useEffect(
    () => () => {
      run.current++;
      live.current.deps.cancel();
    },
    [],
  );

  return { current, start, stop };
}
