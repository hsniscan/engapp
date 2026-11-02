// Pure filtering for the library list (no React, no Dexie): easy to test, fast on 1,000+ notes.
import { CEFR, levelSortKey, type WordLevel } from '@/domain/level';
import { noteStage } from '@/domain/deckFilter';
import { hasTag } from '@/domain/tags';
import { WORD_STAGES, type WordStage } from '@/domain/stages';
import type { Card, CardType, CefrLevel, Note, Sense } from '@/domain/types';

export interface LibraryRow {
  note: Note;
  /** Live senses in display order. */
  senses: Sense[];
  /** Live cards. */
  cards: Card[];
  /** Folded "term ipa meanings glosses" for search. */
  haystack: string;
  suspendedCards: number;
  /** The note's level (src/domain/level.ts); null when unknown. */
  level: WordLevel | null;
}

export type SuspendedFilter = 'all' | 'active' | 'suspended';
export type SortOrder = 'new' | 'az' | 'level' | 'level_desc';
/** A level, or 'none': notes whose level is unknown. */
export type LevelFilter = CefrLevel | 'none' | 'all';

export interface LibraryFilters {
  q: string;
  type: CardType | 'all';
  /** The word stage shown on the rows (Yeni … Kalıcı); not the raw FSRS state. */
  state: WordStage | 'all';
  suspended: SuspendedFilter;
  tag: string; // '' = any
  dup: boolean;
  level: LevelFilter;
  sort: SortOrder;
}

export const EMPTY_FILTERS: LibraryFilters = {
  q: '',
  type: 'all',
  state: 'all',
  suspended: 'all',
  tag: '',
  dup: false,
  level: 'all',
  sort: 'new',
};

const TR_FOLD: Record<string, string> = {
  ı: 'i',
  ğ: 'g',
  ü: 'u',
  ş: 's',
  ö: 'o',
  ç: 'c',
  â: 'a',
  î: 'i',
  û: 'u',
};

/** Case-, accent- and Turkish-letter-insensitive form: "Kıyı" and "kiyi" match. */
export function foldForSearch(s: string): string {
  return s
    .normalize('NFC')
    .toLocaleLowerCase('tr')
    .replace(/[ığüşöçâîû]/g, (c) => TR_FOLD[c] ?? c)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[‘’`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function senseText(s: Pick<Sense, 'meaning_tr' | 'meaning_tr_override'>): string {
  return s.meaning_tr_override?.trim() || s.meaning_tr;
}

/** Group live senses and cards under their live notes; `levelOf` rates each note. */
export function buildRows(
  notes: Note[],
  senses: Sense[],
  cards: Card[],
  levelOf: (note: Note, senses: Sense[]) => WordLevel | null = () => null,
): LibraryRow[] {
  const sByNote = new Map<string, Sense[]>();
  for (const s of senses) {
    if (s.deleted_at !== null) continue;
    const list = sByNote.get(s.note_id);
    if (list) list.push(s);
    else sByNote.set(s.note_id, [s]);
  }
  const cByNote = new Map<string, Card[]>();
  for (const c of cards) {
    if (c.deleted_at !== null) continue;
    const list = cByNote.get(c.note_id);
    if (list) list.push(c);
    else cByNote.set(c.note_id, [c]);
  }
  const rows: LibraryRow[] = [];
  for (const note of notes) {
    if (note.deleted_at !== null) continue;
    const ss = (sByNote.get(note.id) ?? []).sort((a, b) => a.sense_no - b.sense_no);
    const cs = cByNote.get(note.id) ?? [];
    rows.push({
      note,
      senses: ss,
      cards: cs,
      haystack: foldForSearch(
        [note.term, ...ss.flatMap((s) => [senseText(s), s.meaning_tr, s.gloss_en ?? ''])].join(
          ' \u0000 ',
        ),
      ),
      suspendedCards: cs.filter((c) => c.suspended).length,
      level: levelOf(note, ss),
    });
  }
  return rows;
}

export function activeFilterCount(f: LibraryFilters): number {
  return (
    (f.type !== 'all' ? 1 : 0) +
    (f.state !== 'all' ? 1 : 0) +
    (f.suspended !== 'all' ? 1 : 0) +
    (f.tag ? 1 : 0) +
    (f.dup ? 1 : 0) +
    (f.level !== 'all' ? 1 : 0)
  );
}

/** Notes matching the search and filters. Card-level filters match when any one card meets all of them. */
/** The word stage of a row, the same as its pill and the smart decks (null: no active card). */
export function rowStage(r: Pick<LibraryRow, 'cards'>): WordStage | null {
  return noteStage(r);
}

export function filterRows(rows: LibraryRow[], f: LibraryFilters): LibraryRow[] {
  const q = foldForSearch(f.q);
  const cardLevel = f.type !== 'all' || f.suspended !== 'all';
  const out = rows.filter((r) => {
    if (q && !r.haystack.includes(q)) return false;
    // Tags compare case-insensitively everywhere ("İş" = "iş").
    if (f.tag && !hasTag(r.note.tags, f.tag)) return false;
    if (f.state !== 'all' && rowStage(r) !== f.state) return false;
    if (f.dup && !r.note.possible_duplicate) return false;
    if (f.level !== 'all' && (r.level?.cefr ?? 'none') !== f.level) return false;
    if (!cardLevel) return true;
    return r.cards.some(
      (c) =>
        (f.type === 'all' || c.card_type === f.type) &&
        (f.suspended === 'all' || c.suspended === (f.suspended === 'suspended')),
    );
  });
  const az = (a: LibraryRow, b: LibraryRow) =>
    a.note.term.localeCompare(b.note.term, 'en', { sensitivity: 'base' });
  if (f.sort === 'az') out.sort(az);
  else if (f.sort === 'level' || f.sort === 'level_desc') {
    // Unknown levels last either way; the same level A to Z.
    const dir = f.sort === 'level' ? 1 : -1;
    const unknown = CEFR.length;
    out.sort((a, b) => {
      const ka = levelSortKey(a.level);
      const kb = levelSortKey(b.level);
      if (ka !== kb) return ka === unknown ? 1 : kb === unknown ? -1 : dir * (ka - kb);
      return az(a, b);
    });
  } else
    out.sort((a, b) => b.note.created_at - a.note.created_at || (a.note.id < b.note.id ? 1 : -1));
  // A term match ranks above a meaning-only match while searching.
  if (q) {
    const termHit = (r: LibraryRow) =>
      foldForSearch(r.note.term).startsWith(q) ? 0 : foldForSearch(r.note.term).includes(q) ? 1 : 2;
    out.sort((a, b) => termHit(a) - termHit(b));
  }
  return out;
}

const TYPES: (CardType | 'all')[] = ['all', 'recognition', 'production', 'cloze', 'image'];
const SUSP: SuspendedFilter[] = ['all', 'active', 'suspended'];
const LEVEL_FILTERS: string[] = [...CEFR, 'none'];
const SORTS: SortOrder[] = ['new', 'az', 'level', 'level_desc'];

/** A stage key, or an old raw-FSRS value from a v0.5.1 link (relearning → learning). */
function stateFromParam(v: string | null): WordStage | 'all' {
  if ((WORD_STAGES as readonly string[]).includes(v ?? '')) return v as WordStage;
  if (v === 'relearning') return 'learning';
  return 'all';
}

/** Filters <-> URL search params, so a filtered view survives reloads and can be linked. */
export function filtersFromParams(p: URLSearchParams): LibraryFilters {
  const type = p.get('type');
  const state = p.get('state');
  const susp = p.get('suspended');
  return {
    q: p.get('q') ?? '',
    type: TYPES.includes(type as CardType) ? (type as CardType) : 'all',
    state: stateFromParam(state),
    suspended: SUSP.includes(susp as SuspendedFilter) ? (susp as SuspendedFilter) : 'all',
    tag: p.get('tag') ?? '',
    dup: p.get('dup') === '1',
    level: LEVEL_FILTERS.includes(p.get('level') ?? '') ? (p.get('level') as LevelFilter) : 'all',
    sort: SORTS.includes(p.get('sort') as SortOrder) ? (p.get('sort') as SortOrder) : 'new',
  };
}

export function writeFilters(p: URLSearchParams, f: LibraryFilters): URLSearchParams {
  const set = (k: string, v: string, empty: string) => (v === empty ? p.delete(k) : p.set(k, v));
  set('q', f.q, '');
  set('type', f.type, 'all');
  set('state', f.state, 'all');
  set('suspended', f.suspended, 'all');
  set('tag', f.tag, '');
  set('dup', f.dup ? '1' : '', '');
  set('level', f.level, 'all');
  set('sort', f.sort, 'new');
  return p;
}
