// Interval labels through i18n (v0.5.2, review I-5): "10 dk" / "10 min", "yarın" / "tomorrow",
// "1,5 ay" / "1.5 months". The unit and the rounding come from domain/fsrs.ts.
import type { TFunction } from 'i18next';
import { type IntervalLabel, intervalParts } from '@/domain/fsrs';

export function intervalText(t: TFunction, l: IntervalLabel): string {
  const n = l.value.toLocaleString(t('interval.locale'), { maximumFractionDigits: 1 });
  if (l.unit === 'tomorrow') return t('interval.tomorrow');
  if (l.short && l.unit === 'day') return t('interval.dayShort', { count: l.value, n });
  return t(`interval.${l.unit}`, { count: l.value, n });
}

/** Compact "in how long" text ("9 dk", "3 sa", "2 g"). */
export function durationText(t: TFunction, ms: number): string {
  return intervalText(t, intervalParts(ms));
}
