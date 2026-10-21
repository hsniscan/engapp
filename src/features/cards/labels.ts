import type { TFunction } from 'i18next';
import type { CardStateValue, CardType, TermType } from '@/domain/types';

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

export function posLabel(t: TFunction, pos: string): string {
  return (POS_VALUES as readonly string[]).includes(pos)
    ? t(`cards.pos.${pos as (typeof POS_VALUES)[number]}`)
    : pos;
}

export function termTypeLabel(t: TFunction, type: TermType): string {
  return t(`cards.termType.${type}`);
}

export const STATE_KEYS = ['new', 'learning', 'review', 'relearning'] as const;
export type StateKey = (typeof STATE_KEYS)[number];

export function stateKey(state: CardStateValue): StateKey {
  return STATE_KEYS[state];
}

export function cardTypeLabel(t: TFunction, type: CardType): string {
  return t(`cards.cardType.${type}`);
}
