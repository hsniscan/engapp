// Study modes (redesign, plan/ogrenme-modeli.md §4): three separate sessions, each with its own
// cards and schedule. A card's type decides its mode.
import type { CardType } from './types';

export type StudyMode = 'word' | 'production' | 'cloze';

export const STUDY_MODES: readonly StudyMode[] = ['word', 'production', 'cloze'];

/** "Kelime çalışma" = EN→TR recognition; "Üretim" = TR→EN (and picture cards); "Boşluk doldurma" = cloze. */
export const STUDY_MODE_CARD_TYPES: Record<StudyMode, readonly CardType[]> = {
  word: ['recognition'],
  production: ['production', 'image'],
  cloze: ['cloze'],
};

export function studyModeOf(type: CardType): StudyMode {
  return type === 'recognition' ? 'word' : type === 'cloze' ? 'cloze' : 'production';
}

export function isStudyMode(v: unknown): v is StudyMode {
  return v === 'word' || v === 'production' || v === 'cloze';
}
