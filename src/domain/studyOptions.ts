// settings.study_options (v0.5.2, ADR 0062): per-mode new-card limits, the session length and
// leech auto-suspend. Absent/null fields mean the defaults. Pure.
import type { Settings, StudyOptions } from './types';
import type { StudyMode } from './studyMode';

/** "Oturum uzunluğu": the choices offered; null = the whole mode. */
export const SESSION_CARD_CHOICES = [10, 20, 30] as const;
export const SESSION_CARDS_MIN = 5;
export const SESSION_CARDS_MAX = 200;

export function studyOptionsOf(s: Pick<Settings, 'study_options'> | undefined | null): StudyOptions {
  return s?.study_options ?? {};
}

/** Per-mode limit of first-time cards (null = shares the day's budget without its own limit). */
export function modeNewLimit(s: Pick<Settings, 'study_options'> | undefined | null, mode: StudyMode): number | null {
  if (mode === 'word') return null;
  const v = studyOptionsOf(s).mode_new_limits?.[mode];
  return typeof v === 'number' && v >= 0 ? Math.floor(v) : null;
}

/** Most cards in one session (null = the whole mode). */
export function sessionCards(s: Pick<Settings, 'study_options'> | undefined | null): number | null {
  const v = studyOptionsOf(s).session_cards;
  return typeof v === 'number' && v >= SESSION_CARDS_MIN ? Math.min(SESSION_CARDS_MAX, Math.floor(v)) : null;
}

export function leechAutoSuspend(s: Pick<Settings, 'study_options'> | undefined | null): boolean {
  return studyOptionsOf(s).leech_auto_suspend === true;
}
