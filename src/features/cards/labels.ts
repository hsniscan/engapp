import type { TFunction } from 'i18next';
import type { CardStateValue, CardType, NoteTermType } from '@/domain/types';

/** Part-of-speech values are stored in English (like the shared lexicon); labels are Turkish. */
export const POS_VALUES = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'phrasal verb',
  'idiom',
  'preposition',
  'conjunction',
  'pronoun',
  'interjection',
] as const;

/** Every value with a label: the ones above plus the rest of the lexicon's list (text.ts). */
const POS_LABELED = [...POS_VALUES, 'phrase', 'determiner', 'other', 'root', 'prefix', 'suffix'] as const;

/**
 * The part of speech in the UI language ("noun" → "isim"). Case, separators and spacing
 * are ignored ("Phrasal  Verb", "phrasal_verb"); an unknown value is shown as stored.
 */
export function posLabel(t: TFunction, pos: string): string {
  const key = pos.toLowerCase().replace(/[._-]/g, ' ').replace(/\s+/g, ' ').trim();
  return (POS_LABELED as readonly string[]).includes(key)
    ? t(`cards.pos.${key as (typeof POS_LABELED)[number]}`)
    : pos;
}

export function termTypeLabel(t: TFunction, type: NoteTermType): string {
  return t(`cards.termType.${type}`);
}

export const STATE_KEYS = ['new', 'learning', 'review', 'relearning'] as const;
export type StateKey = (typeof STATE_KEYS)[number];

export function stateKey(state: CardStateValue): StateKey {
  return STATE_KEYS[state];
}

export function cardTypeLabel(t: TFunction, type: CardType): string {
  // "Dikte" (v0.5 İP9) keeps its strings in the modes namespace.
  return type === 'dictation' ? t('modes.dictation.cardType') : t(`cards.cardType.${type}`);
}
