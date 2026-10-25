// STUB (agent B): the learning-model owner replaces this file with the real hook (stages from
// ramp_step + stability, docs/plan "Öğrenme modeli" 2.2–2.4). Same signature; this version
// only approximates the stage from FSRS stability so the home screen has numbers meanwhile.
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data';
import { type Card, CardState } from '@/domain/types';

export interface WordStages {
  learning: number;
  consolidating: number;
  learned: number;
  mastered: number;
  /** learned + mastered (recognition cards, words only). */
  learnedTotal: number;
  /** learnedTotal gained in the last 7 days. */
  weekDelta: number;
  /** Words whose production card is learned+. */
  active: number;
  /** Marked "Biliyorum", never part of learnedTotal. */
  alreadyKnown: number;
}

type Stage = 'new' | 'learning' | 'consolidating' | 'learned' | 'mastered';

function approxStage(c: Card): Stage {
  if (c.state === CardState.New) return 'new';
  if (c.state !== CardState.Review) return 'learning';
  if (c.stability >= 90 && c.reps >= 5) return 'mastered';
  if (c.stability >= 14 && c.reps >= 4) return 'learned';
  return 'consolidating';
}

async function loadWordStages(): Promise<WordStages> {
  const [notes, cards, known] = await Promise.all([
    db.notes.filter((n) => n.deleted_at === null).toArray(),
    db.cards
      .filter(
        (c) =>
          c.deleted_at === null && (c.card_type === 'recognition' || c.card_type === 'production'),
      )
      .toArray(),
    db.known_terms.filter((k) => k.deleted_at === null).count(),
  ]);
  const words = new Set(
    notes.filter((n) => n.term_type !== 'affix' && n.term_type !== 'contrast').map((n) => n.id),
  );
  const out: WordStages = {
    learning: 0,
    consolidating: 0,
    learned: 0,
    mastered: 0,
    learnedTotal: 0,
    weekDelta: 0,
    active: 0,
    alreadyKnown: known,
  };
  for (const c of cards) {
    if (!words.has(c.note_id)) continue;
    const s = approxStage(c);
    if (c.card_type === 'production') {
      if (s === 'learned' || s === 'mastered') out.active++;
      continue;
    }
    if (s === 'new') continue;
    out[s]++;
  }
  out.learnedTotal = out.learned + out.mastered;
  return out;
}

export function useWordStages(): WordStages | undefined {
  return useLiveQuery(loadWordStages, []);
}
