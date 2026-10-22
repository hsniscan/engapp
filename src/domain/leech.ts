// Cards the learner keeps forgetting ("zorlandığın kart", v0.3 İP6, docs/decisions/0026).
// Pure: the threshold, the lapse count from the review logs, and the plans of the user's
// "Bu karta başka yoldan bakalım" actions (split senses, reset). Nothing here suspends or
// deletes a card on its own: every change is a plan the user chose, carried out by the data
// layer, and review logs are only read.
import { nextStudyState, NEW_STUDY_STATE } from './retention';
import { effectiveLogs } from './recompute';
import { type Card, CardState, type Id, Rating, type ReviewLog, type Sense } from './types';

/** A card forgotten this many times (Again while in Review) is a leech. Anki uses 8 (plan: 6). */
export const LEECH_LAPSES = 6;

/**
 * Lapses of a card from its logs: Again answers given while the card was in Review, counted
 * over the answers that still count (undo rows and the answers they cancel removed). This is
 * the FSRS definition, so it equals `card.lapses` after a replay (invariant 3).
 */
export function lapsesFromLogs(logs: Iterable<ReviewLog>): number {
  let state = NEW_STUDY_STATE;
  let lapses = 0;
  for (const log of effectiveLogs(logs)) {
    if (state.state === CardState.Review && log.rating === Rating.Again) lapses++;
    state = nextStudyState(state, log.rating);
  }
  return lapses;
}

export const isLeech = (lapses: number): boolean => lapses >= LEECH_LAPSES;

/**
 * The answer `logId` made the card a leech: without it the card had fewer than LEECH_LAPSES
 * lapses, with it LEECH_LAPSES or more. Only the answer that crosses the line flags the card
 * in the session; later Again answers do not repeat the notice.
 */
export function becameLeech(logs: readonly ReviewLog[], logId: Id): boolean {
  if (!logs.some((l) => l.id === logId)) return false;
  const after = lapsesFromLogs(logs);
  const before = lapsesFromLogs(logs.filter((l) => l.id !== logId));
  return !isLeech(before) && isLeech(after);
}

// ------------------------------------------------------------------ the list

export interface LeechEntry {
  card_id: Id;
  note_id: Id;
  lapses: number;
  /** Time of the latest lapse (ms), for "most recent first". */
  last_lapse_at: number;
}

/**
 * Leech cards among `cards` (live and not suspended: a suspended card is the user's decision
 * already), most lapses first, then the most recent lapse.
 */
export function listLeeches(
  cards: readonly Pick<Card, 'id' | 'note_id' | 'deleted_at' | 'suspended'>[],
  logsByCard: ReadonlyMap<Id, readonly ReviewLog[]>,
): LeechEntry[] {
  const out: LeechEntry[] = [];
  for (const c of cards) {
    if (c.deleted_at !== null || c.suspended) continue;
    const logs = logsByCard.get(c.id) ?? [];
    let state = NEW_STUDY_STATE;
    let lapses = 0;
    let last = 0;
    for (const log of effectiveLogs(logs)) {
      if (state.state === CardState.Review && log.rating === Rating.Again) {
        lapses++;
        last = log.reviewed_at;
      }
      state = nextStudyState(state, log.rating);
    }
    if (isLeech(lapses)) out.push({ card_id: c.id, note_id: c.note_id, lapses, last_lapse_at: last });
  }
  return out.sort((a, b) => b.lapses - a.lapses || b.last_lapse_at - a.last_lapse_at || (a.card_id < b.card_id ? -1 : 1));
}

// ------------------------------------------------------------------ actions

type CardLike = Pick<Card, 'id' | 'note_id' | 'sense_id' | 'card_type' | 'deleted_at' | 'suspended'>;

/**
 * Can a recognition card be split into one recognition card per sense? Only the note's own
 * recognition card (sense_id null) of a note with two or more live senses whose senses do not
 * all have a live per-sense recognition card yet. Production and cloze cards are per sense
 * already, and contrast/affix notes have nothing to split.
 */
export function canSplitSenses(
  card: CardLike,
  senses: readonly Pick<Sense, 'id' | 'deleted_at'>[],
  noteCards: readonly CardLike[],
  termType: string,
): boolean {
  if (card.card_type !== 'recognition' || card.sense_id !== null || card.deleted_at !== null) return false;
  if (termType === 'contrast' || termType === 'affix') return false;
  return splitTargets(senses, noteCards).length > 0 && senses.filter((s) => s.deleted_at === null).length >= 2;
}

/** Live senses that still lack a live per-sense recognition card, in input order. */
export function splitTargets(
  senses: readonly Pick<Sense, 'id' | 'deleted_at'>[],
  noteCards: readonly CardLike[],
): Id[] {
  const has = new Set(
    noteCards
      .filter((c) => c.card_type === 'recognition' && c.sense_id !== null && c.deleted_at === null)
      .map((c) => c.sense_id!),
  );
  return senses.filter((s) => s.deleted_at === null && !has.has(s.id)).map((s) => s.id);
}

/**
 * The recognition card that speaks for the note (unlock rule, status): the live note-level
 * card that is not suspended, else the live note-level card (kept after a split or a reset of
 * an older copy), else any live recognition card, else any. A split adds per-sense
 * recognition cards (sense_id set) and a reset adds a fresh copy; neither may change which
 * card unlocks production cards by accident.
 */
export function primaryRecognition<T extends CardLike>(cards: readonly T[]): T | undefined {
  const rec = cards.filter((c) => c.card_type === 'recognition');
  return (
    rec.find((c) => c.deleted_at === null && c.sense_id === null && !c.suspended) ??
    rec.find((c) => c.deleted_at === null && c.sense_id === null) ??
    rec.find((c) => c.deleted_at === null) ??
    rec[0]
  );
}
