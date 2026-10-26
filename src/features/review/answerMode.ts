// How the user answers in Üretim and Boşluk doldurma (v0.5 İP9, ADR 0051), remembered on this
// device (like "Karışık çalış"). Üretim: typed (the redesign board, the default) or "aklımdan"
// (show the answer, then rate). Boşluk doldurma: four choices (the default) or typed.
// The toggles sit on the cards themselves.
import { useCallback, useState } from 'react';
import { flags } from '@/features/settings/platform';

export type ProductionAnswerMode = 'type' | 'flip';
export type ClozeAnswerMode = 'choose' | 'type';

const KEY = { production: 'modes.answer.production', cloze: 'modes.answer.cloze' } as const;

export function productionAnswerMode(): ProductionAnswerMode {
  return flags.get(KEY.production) === 'flip' ? 'flip' : 'type';
}

export function clozeAnswerMode(): ClozeAnswerMode {
  return flags.get(KEY.cloze) === 'type' ? 'type' : 'choose';
}

export function useProductionAnswerMode(): [ProductionAnswerMode, (m: ProductionAnswerMode) => void] {
  const [mode, setMode] = useState(productionAnswerMode);
  const set = useCallback((m: ProductionAnswerMode) => {
    flags.set(KEY.production, m);
    setMode(m);
  }, []);
  return [mode, set];
}

export function useClozeAnswerMode(): [ClozeAnswerMode, (m: ClozeAnswerMode) => void] {
  const [mode, setMode] = useState(clozeAnswerMode);
  const set = useCallback((m: ClozeAnswerMode) => {
    flags.set(KEY.cloze, m);
    setMode(m);
  }, []);
  return [mode, set];
}
