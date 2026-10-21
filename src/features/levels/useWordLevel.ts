import { useMemo } from 'react';
import type { CardView, NoteDetail } from '@/data';
import { noteLevel, senseLevel, withOverride, type WordLevel } from '@/domain/level';
import { useLevelData } from './useLevelData';

/** The level shown on a card: its sense's level for production and cloze, else the note's. */
export function useCardLevel(view: CardView): WordLevel | null {
  const data = useLevelData();
  return useMemo(() => {
    const lexOf = (id: string) => view.lexicon?.get(id);
    const { note, sense, card } = view;
    if (card.card_type !== 'recognition' && sense) {
      const lex = sense.lexicon_sense_id ? lexOf(sense.lexicon_sense_id) : undefined;
      return withOverride(senseLevel(note, sense, lex, data), note.level_override ?? null);
    }
    return noteLevel(note, view.senses, lexOf, data);
  }, [view, data]);
}

/** The level of a note in the detail sheet. */
export function useNoteLevel(detail: NoteDetail): WordLevel | null {
  const data = useLevelData();
  return useMemo(
    () => noteLevel(detail.note, detail.senses, (id) => detail.lexicon?.get(id), data),
    [detail, data],
  );
}
