import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { getLeechSheet, type LeechSheetData } from '@/data';
import { wordInfo, type MorphologyIndex } from '@/domain/morphology';
import type { Id } from '@/domain/types';
import { useMorphology } from '@/features/family/hooks';

/** The leech sheet's data (live): undefined while loading, null when the card is gone. */
export function useLeechSheet(cardId: Id | null): LeechSheetData | null | undefined {
  return useLiveQuery(async () => (cardId ? getLeechSheet(cardId) : null), [cardId]);
}

/** Word-family id of a term from the morphology file (members of a family are not confusables). */
export function familyIdOf(index: MorphologyIndex | null): ((termNorm: string) => number | null) | undefined {
  if (!index) return undefined;
  return (termNorm) => {
    const info = wordInfo(index, termNorm);
    return info && info.family >= 0 ? info.family : null;
  };
}

/** `familyIdOf` for the loaded morphology file; undefined until it has loaded. */
export function useFamilyOf(enabled = true): ((termNorm: string) => number | null) | undefined {
  const index = useMorphology(enabled);
  return useMemo(() => familyIdOf(index), [index]);
}
