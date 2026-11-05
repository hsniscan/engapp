import { useTranslation } from 'react-i18next';
import type { ResolvedLevel, WordLevel } from '@/domain/level';

/** Spoken name of a level badge: "Seviye B1, CEFR-J listesi". */
export function useLevelLabel(level: WordLevel): string {
  const { t } = useTranslation();
  return t('wordLevel.badgeLabel', { level: level.cefr, source: t(`wordLevel.source.${level.source}`) });
}

const LIST_NAME = { cefrj: 'CEFR-J', octanove: 'Octanove' } as const;

/** The Turkish word of a familiar-word correction ("tanidik:mikrofon" → "mikrofon"), else null. */
export function familiarWord(reason: string | null | undefined): string | null {
  const m = /^tanidik:(.+)$/.exec(reason?.trim() ?? '');
  return m ? m[1]!.trim() : null;
}

/**
 * "CEFR-J: B1 → Türk öğrenci için A2 (yapay zekâ: Türkçede 'televizyon')" for a corrected list level;
 * null otherwise.
 */
export function useCorrectionLine(
  level: Pick<ResolvedLevel, 'cefr' | 'list_cefr' | 'reason_tr'> & { source: string } | null,
): string | null {
  const { t } = useTranslation();
  if (!level || (level.source !== 'cefrj' && level.source !== 'octanove')) return null;
  if (!level.list_cefr || level.list_cefr === level.cefr) return null;
  // A familiar international word (decision 0073): "Türkçede de var: mikrofon".
  const familiar = familiarWord(level.reason_tr);
  if (familiar)
    return t('wordLevel.correction_familiar', {
      list: LIST_NAME[level.source],
      from: level.list_cefr,
      to: level.cefr,
      word: familiar,
    });
  return t('wordLevel.correction', {
    list: LIST_NAME[level.source],
    from: level.list_cefr,
    to: level.cefr,
    reason: level.reason_tr ?? '',
    context: level.reason_tr ? 'reason' : undefined,
  });
}

