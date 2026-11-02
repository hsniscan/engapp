// Test helper: the Turkish interval labels the spec tables use ("10 dk", "yarın", "1,5 ay"),
// rendered from the domain's parts the same way tr.json does (interval.* keys).
import type { IntervalLabel } from '../domain/fsrs';

const num = (n: number) => String(n).replace('.', ',');

export function trInterval(l: IntervalLabel): string {
  switch (l.unit) {
    case 'minute':
      return `${num(l.value)} dk`;
    case 'hour':
      return `${num(l.value)} sa`;
    case 'tomorrow':
      return 'yarın';
    case 'day':
      return l.short ? `${num(l.value)} g` : `${num(l.value)} gün`;
    case 'week':
      return `${num(l.value)} hafta`;
    case 'month':
      return `${num(l.value)} ay`;
    case 'year':
      return `${num(l.value)} yıl`;
  }
}
