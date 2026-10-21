import {
  PRACTICE_SIZES,
  PRACTICE_SOURCES,
  type PracticeSize,
  type PracticeSource,
} from '@/domain/practice';

export interface PracticeParams {
  source: PracticeSource;
  size: PracticeSize;
  tag: string | null;
}

/** URL of a practice round: /practice?source=hard&size=10[&tag=iş]. */
export function practiceHref(p: PracticeParams): string {
  const q = new URLSearchParams({ source: p.source, size: String(p.size) });
  if (p.source === 'tag' && p.tag) q.set('tag', p.tag);
  return `/practice?${q.toString()}`;
}

/** Read a round from the URL; unknown values fall back to "Zorlandıklarım", 10 cards. */
export function parsePracticeParams(search: URLSearchParams): PracticeParams {
  const rawSource = search.get('source');
  const source = (PRACTICE_SOURCES as readonly string[]).includes(rawSource ?? '')
    ? (rawSource as PracticeSource)
    : 'hard';
  const rawSize = Number(search.get('size'));
  const size = (PRACTICE_SIZES as readonly number[]).includes(rawSize)
    ? (rawSize as PracticeSize)
    : 10;
  const tag = source === 'tag' ? search.get('tag') || null : null;
  return { source, size, tag };
}

/** The +N choices: 5 and 10 when that many are waiting, otherwise what is left. */
export function extraNewSteps(waiting: number): number[] {
  if (waiting >= 10) return [5, 10];
  if (waiting > 5) return [5, waiting];
  return waiting > 0 ? [waiting] : [];
}
