// "Eller serbest" (v0.5 İP9, ADR 0051), data side: the words of a hands-free round. Read-only:
// the same selection as a practice round (data/practice.ts getPracticeCards), then each word's
// term, meaning and a sentence to read. Nothing is written: no card, no review log, no practice
// log, no encounter (the round is listening practice, decision 0051).
import { bandFor, pickRotation, rotationSentences, selectedContexts } from '../domain/examples';
import type { HandsFreeItem } from '../domain/handsFree';
import type { PracticeFilter } from '../domain/practice';
import type { Id, Millis, Sense } from '../domain/types';
import { db } from './db';
import { senseExamplesFor } from './examples';
import { getPracticeCards } from './practice';
import { getSettings } from './settings';

const meaningOf = (s: Pick<Sense, 'meaning_tr' | 'meaning_tr_override'>) => s.meaning_tr_override?.trim() || s.meaning_tr;

/** The round's words, in play order, one per note. */
export async function getHandsFreeItems(
  filter: PracticeFilter,
  opts: { size: number; seed: string },
  now: Millis = Date.now(),
): Promise<HandsFreeItem[]> {
  const cardIds = await getPracticeCards(filter, opts, now);
  return handsFreeItemsFor(cardIds);
}

/** Term, meaning and sentence of these cards (unknown or deleted ones are left out). */
export async function handsFreeItemsFor(cardIds: readonly Id[]): Promise<HandsFreeItem[]> {
  const settings = await getSettings();
  const band = bandFor(settings);
  const selected = selectedContexts(settings);
  return db.transaction('r', [db.cards, db.notes, db.senses, db.lexicon_examples, db.content_feedback, db.user_content], async () => {
    const out: HandsFreeItem[] = [];
    const seen = new Set<Id>();
    for (const id of cardIds) {
      const card = await db.cards.get(id);
      if (!card || card.deleted_at !== null || seen.has(card.note_id)) continue;
      const note = await db.notes.get(card.note_id);
      if (!note || note.deleted_at !== null) continue;
      const senses = (await db.senses.where('note_id').equals(note.id).toArray())
        .filter((s) => s.deleted_at === null)
        .sort((a, b) => a.sense_no - b.sense_no);
      const sense = senses.find((s) => s.id === card.sense_id) ?? senses[0];
      if (!sense) continue;
      const examples = sense.lexicon_sense_id ? await senseExamplesFor(sense.lexicon_sense_id, band, selected) : null;
      const list = rotationSentences(sense, examples, selected, false);
      // A shared sentence first: its audio is pre-generated (and cached after the first play).
      const shared = list.filter((s) => s.exampleId !== null);
      const sentence = pickRotation(shared.length ? shared : list, card.reps);
      seen.add(note.id);
      out.push({
        cardId: card.id,
        noteId: note.id,
        term: note.term,
        meaning: meaningOf(sense),
        sentence: sentence ? { text: sentence.text, tr: sentence.tr } : null,
      });
    }
    return out;
  });
}
