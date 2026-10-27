import { useTranslation } from 'react-i18next';
import type { ResolvedLevel, WordLevel } from '@/domain/level';

/** Spoken name of a level badge: "Seviye B1, CEFR-J listesi". */
export function useLevelLabel(level: WordLevel): string {
  const { t } = useTranslation();
  return t('wordLevel.badgeLabel', { level: level.cefr, source: t(`wordLevel.source.${level.source}`) });
}

const LIST_NAME = { cefrj: 'CEFR-J', octanove: 'Octanove' } as const;

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
  return t('wordLevel.correction', {
    list: LIST_NAME[level.source],
    from: level.list_cefr,
    to: level.cefr,
    reason: level.reason_tr ?? '',
    context: level.reason_tr ? 'reason' : undefined,
  });
}

