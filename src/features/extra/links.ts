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
  /** Source 'deck': the smart deck's id. */
  deck?: string | null;
  /** Source 'list': the notes of the round (at most MAX_LIST_NOTES). */
  notes?: string[] | null;
}

/** A 'list' round names at most this many notes (a round has at most 20 cards). */
export const MAX_LIST_NOTES = 20;
const NOTE_ID = /^[0-9A-Za-z-]{1,64}$/;

/** URL of a practice round: /practice?source=hard&size=10[&tag=iş][&deck=<id>][&notes=a,b]. */
export function practiceHref(p: PracticeParams): string {
  const q = new URLSearchParams({ source: p.source, size: String(p.size) });
  if (p.source === 'tag' && p.tag) q.set('tag', p.tag);
  if (p.source === 'deck' && p.deck) q.set('deck', p.deck);
  if (p.source === 'list' && p.notes?.length)
    q.set('notes', p.notes.slice(0, MAX_LIST_NOTES).join(','));
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
  const deck = source === 'deck' ? search.get('deck') || null : null;
  if (source !== 'list') return { source, size, tag, deck };
  const notes = [
    ...new Set((search.get('notes') ?? '').split(',').filter((id) => NOTE_ID.test(id))),
  ].slice(0, MAX_LIST_NOTES);
  return { source, size, tag, deck, notes };
}

/** The +N choices: 5 and 10 when that many are waiting, otherwise what is left. */
export function extraNewSteps(waiting: number): number[] {
  if (waiting >= 10) return [5, 10];
  if (waiting > 5) return [5, waiting];
  return waiting > 0 ? [waiting] : [];
}
