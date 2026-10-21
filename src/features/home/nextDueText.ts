import type { TFunction } from 'i18next';
import { formatInterval } from '@/domain/fsrs';
import { formatClock, formatDayLong } from '@/features/stats/format';
import type { NextDue } from './queries';

/** "Sıradaki kart 25 dk sonra (14:30)", "Yarın 18 kart seni bekliyor", … */
export function nextDueText(t: TFunction, next: NextDue, now: number, timeZone?: string): string {
  switch (next.kind) {
    case 'later':
      return t('home.nextLater', {
        time: formatInterval(Math.max(60_000, next.at - now)),
        clock: formatClock(next.at, timeZone),
      });
    case 'tomorrow':
      return t('home.nextTomorrow', { count: next.count });
    case 'date':
      return t('home.nextDate', { date: formatDayLong(next.day) });
    default:
      return t('home.nextNone');
  }
}
