// STUB (agent E). The learning-model agent (A) owns this file; its version replaces this one
// at merge. The signature is the agreed one from the redesign brief. Until A's stage rule
// (ramp_step + stability, docs: plan/ogrenme-modeli.md §2) lands, this approximates the
// stages from stability alone so the Progress screen has honest-looking numbers to show.
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data';
import { CardState, recognitionOnly } from '@/domain/types';

export interface WordStageCounts {
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

const LEARNED_S = 14;
const MASTERED_S = 90;

export function useWordStages(): WordStageCounts | undefined {
  return useLiveQuery(async () => {
    const [notes, cards, known] = await Promise.all([
      db.notes.filter((n) => n.deleted_at === null && !recognitionOnly(n.term_type)).toArray(),
      db.cards.filter((c) => c.deleted_at === null).toArray(),
      db.known_terms.filter((k) => k.deleted_at === null).toArray(),
    ]);
    const live = new Set(notes.map((n) => n.id));
    const out: WordStageCounts = {
      learning: 0,
      consolidating: 0,
      learned: 0,
      mastered: 0,
      learnedTotal: 0,
      weekDelta: 0,
      active: 0,
      alreadyKnown: new Set(known.map((k) => k.term_norm)).size,
    };
    for (const c of cards) {
      if (!live.has(c.note_id) || c.state === CardState.New) continue;
      const learnedPlus = c.state === CardState.Review && c.stability >= LEARNED_S;
      if (c.card_type === 'production') {
        if (learnedPlus) out.active++;
        continue;
      }
      if (c.card_type !== 'recognition') continue;
      if (c.state !== CardState.Review) out.learning++;
      else if (c.stability >= MASTERED_S) out.mastered++;
      else if (c.stability >= LEARNED_S) out.learned++;
      else out.consolidating++;
    }
    out.learnedTotal = out.learned + out.mastered;
    return out;
  }, []);
}
