// STUB (agent B): the study-session owner replaces this file with the real per-mode queues
// (docs/plan "Öğrenme modeli" 4). Same signature; this version splits today's single queue by
// card type so the home screen has numbers meanwhile.
import { useLiveQuery } from 'dexie-react-hooks';
import { getStudyQueue } from '@/data';
import type { CardType } from '@/domain/types';

export type StudyMode = 'word' | 'production' | 'cloze';

export interface StudyModeCount {
  due: number;
  newCount: number;
  estMinutes: number;
}

const MODE_OF: Record<CardType, StudyMode> = {
  recognition: 'word',
  production: 'production',
  image: 'production',
  cloze: 'cloze',
};
const SECONDS_PER_CARD = 10;

async function loadCounts(): Promise<Record<StudyMode, StudyModeCount>> {
  const q = await getStudyQueue({ learnAheadMs: 0 });
  const out: Record<StudyMode, StudyModeCount> = {
    word: { due: 0, newCount: 0, estMinutes: 0 },
    production: { due: 0, newCount: 0, estMinutes: 0 },
    cloze: { due: 0, newCount: 0, estMinutes: 0 },
  };
  for (const item of q.items) {
    const m = out[MODE_OF[item.card.card_type]];
    if (item.kind === 'new') m.newCount++;
    else m.due++;
  }
  for (const m of Object.values(out))
    m.estMinutes = Math.ceil(((m.due + m.newCount) * SECONDS_PER_CARD) / 60);
  return out;
}

export function useStudyModeCounts(): Record<StudyMode, StudyModeCount> | undefined {
  return useLiveQuery(loadCounts, []);
}
