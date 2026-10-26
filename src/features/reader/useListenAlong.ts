// "Dinleyerek oku" (v0.5 İP1, decision 0043): the text is read aloud one sentence at a time and
// the screen marks the sentence being read. A sentence plays from pre-generated audio when it
// is already in memory (library texts, İP5), otherwise with the device voice. A library text
// plays its own recorded sentences (`clips`, v0.5.1 decision 0054; gradedAudio.ts), the device
// voice standing in for any clip that cannot be played. The user's own text is never sent to
// the TTS function: nothing of it leaves the device.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deviceVoice,
  playPronunciation,
  prefetchPregenerated,
  pronunciationReady,
} from '@/features/review/pronunciation';
import type { VoicePref } from '@/features/review/useSpeech';
import { playGradedClip, prefetchGradedClips, stopGradedClip } from './gradedAudio';

export interface ListenAlongDeps {
  ready: (text: string, voice: VoicePref) => boolean;
  playReady: (text: string, voice: VoicePref, onDone: () => void) => boolean;
  device: (text: string, voice: VoicePref, onDone: () => void) => boolean;
  prefetch: (texts: readonly string[], voice: VoicePref) => void;
  /** A recorded sentence; `fallback` (the device voice) when it cannot be played. */
  playClip: (key: string, onDone: () => void, fallback: () => boolean) => boolean;
  prefetchClips: (keys: readonly (string | null)[]) => void;
  cancel: () => void;
}

const defaultDeps: ListenAlongDeps = {
  ready: pronunciationReady,
  playReady: (text, voice, onDone) => playPronunciation(text, voice, { onDone }),
  device: (text, voice, onDone) => deviceVoice(text, voice, onDone),
  prefetch: (texts, voice) => void prefetchPregenerated(texts, voice),
  playClip: playGradedClip,
  prefetchClips: prefetchGradedClips,
  cancel: () => {
    stopGradedClip();
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
 * `clips`: a library text's recorded audio per sentence (null where there is none).
 */
export function useListenAlong(
  sentences: readonly string[],
  voice: VoicePref,
  pregenerated: boolean,
  deps: ListenAlongDeps = defaultDeps,
  clips: readonly (string | null)[] | null = null,
): ListenAlong {
  const [current, setCurrent] = useState<number | null>(null);
  const run = useRef(0);
  const live = useRef({ sentences, voice, pregenerated, deps, clips });
  useEffect(() => {
    live.current = { sentences, voice, pregenerated, deps, clips };
  });

  const stop = useCallback(() => {
    run.current++;
    setCurrent(null);
    live.current.deps.cancel();
  }, []);

  const step = useCallback(function step(i: number, id: number): boolean {
    if (id !== run.current) return false;
    const { sentences: list, voice: v, pregenerated: pre, deps: d, clips: recorded } = live.current;
    // Skip sentences with nothing to say (a lone number, a dash).
    let k = i;
    while (k < list.length && !/\p{L}/u.test(list[k]!)) k++;
    if (k >= list.length) {
      setCurrent(null);
      return false;
    }
    setCurrent(k);
    const onDone = () => {
      if (id === run.current) step(k + 1, id);
    };
    const text = list[k]!;
    const clip = recorded?.[k] ?? null;
    let ok: boolean;
    if (clip) {
      d.prefetchClips(recorded!.slice(k + 1, k + 3));
      ok = d.playClip(clip, onDone, () => id === run.current && d.device(text, v, onDone));
    } else {
      if (pre) d.prefetch(list.slice(k + 1, k + 3), v);
      ok = d.ready(text, v) ? d.playReady(text, v, onDone) : d.device(text, v, onDone);
    }
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
