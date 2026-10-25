// Distractor candidates for cloze choices (redesign): the user's own words, one row per note
// (its first live sense). Read once per session and cached; a cloze card's choices are then
// picked by domain/clozeChoices.ts.
import type { ChoiceCandidate } from '../domain/clozeChoices';
import type { Sense } from '../domain/types';
import { db } from './db';

/** Words only: affixes and "karıştırılanlar" pairs make poor distractors. */
export async function getChoiceCandidates(): Promise<ChoiceCandidate[]> {
  return db.transaction('r', [db.notes, db.senses], async () => {
    const notes = await db.notes
      .filter((n) => n.deleted_at === null && n.term_type !== 'affix' && n.term_type !== 'contrast')
      .toArray();
    const first = new Map<string, Sense>();
    await db.senses.each((s) => {
      if (s.deleted_at !== null) return;
      const prev = first.get(s.note_id);
      if (!prev || s.sense_no < prev.sense_no) first.set(s.note_id, s);
    });
    return notes.map((n) => {
      const s = first.get(n.id);
      return {
        term: n.term,
        pos: s?.pos ?? null,
        meaning: s ? (s.meaning_tr_override ?? s.meaning_tr) : null,
      };
    });
  });
}
