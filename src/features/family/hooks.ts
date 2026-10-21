import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { getDismissedMorphemes, getHiddenPairNotes, getUserWordSets } from '@/data';
import type { MorphologyIndex } from '@/domain/morphology';
import type { FalseFriendNote } from '@/domain/pairNotes';
import { loadFalseFriends, loadMorphology } from './loaders';

function useLoaded<T>(load: () => Promise<T>, enabled: boolean): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    load().then(
      (v) => {
        if (alive) setValue(v);
      },
      // No family row or warning when the data cannot be loaded (offline before the first
      // load): the rest of the screen is unaffected.
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [load, enabled]);
  return value;
}

/** The morphology index once loaded (null while loading or when it cannot be loaded). */
export const useMorphology = (enabled = true): MorphologyIndex | null => useLoaded(loadMorphology, enabled);

export const useFalseFriendIndex = (enabled = true): Map<string, FalseFriendNote[]> | null =>
  useLoaded(loadFalseFriends, enabled);

export const useUserWords = () => useLiveQuery(getUserWordSets, []);
export const useHiddenPairNotes = () => useLiveQuery(getHiddenPairNotes, []);
export const useDismissedMorphemes = () => useLiveQuery(getDismissedMorphemes, []);
