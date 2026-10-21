import type { TFunction } from 'i18next';
import type { HeatmapCell } from '@/domain/streak';
import { formatDayMonth } from './format';

/** Screen-reader label for a calendar day: "12 Ekim: 45 tekrar, tamamlandı". */
export function heatLabel(t: TFunction, cell: HeatmapCell): string {
  const date = formatDayMonth(cell.date);
  if (cell.future) return t('stats.cellFuture', { date });
  if (cell.level === 2) return t('stats.cellCompleted', { date, count: cell.reviews });
  if (cell.level === 1) return t('stats.cellActive', { date, count: cell.reviews });
  return t('stats.cellEmpty', { date });
}
