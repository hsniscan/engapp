// The part-of-speech chip on study cards. Same labels as everywhere (cards/labels.ts posLabel),
// except a phrasal verb reads "deyimsel fiil" alone: the "(phrasal verb)" gloss put English into
// the Turkish chip right above the English term (2026-11-26 #12).
import type { TFunction } from 'i18next';
import { posLabel } from '@/features/cards/labels';

export function studyPosLabel(t: TFunction, pos: string): string {
  const key = pos.toLowerCase().replace(/[._-]/g, ' ').replace(/\s+/g, ' ').trim();
  return key === 'phrasal verb' ? t('study.posPhrasalVerb') : posLabel(t, pos);
}
