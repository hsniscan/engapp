// Texts of a study mode. "Dikte" (v0.5 İP9) keeps its strings in the `modes` namespace; the
// three redesign modes keep theirs under `study.mode`.
import type { TFunction } from 'i18next';
import type { StudyMode } from '@/domain/studyMode';

export type ModeTextPart = 'name' | 'dir' | 'desc' | 'note';

export function modeText(t: TFunction, mode: StudyMode, part: ModeTextPart): string {
  if (mode === 'dictation') return t(`modes.dictation.${part}`);
  if (part === 'note') return mode === 'word' ? '' : t(`study.mode.${mode}.note`);
  return t(`study.mode.${mode}.${part}`);
}

/** "Bugünlük Dikte bitti" and the other empty-session titles. */
export function emptyTitle(t: TFunction, mode: StudyMode): string {
  return mode === 'dictation' ? t('modes.dictation.empty') : t(`study.empty.${mode}`);
}

/** The picker's start button. */
export function startLabel(t: TFunction, mode: StudyMode | 'mixed'): string {
  return mode === 'dictation' ? t('modes.dictation.start') : t(`study.start.${mode}`);
}
