import { describe, expect, it } from 'vitest';
import { makeCard } from '@/test/factories';
import type { Note, Sense } from '@/domain/types';
import {
  buildRows,
  EMPTY_FILTERS,
  filterRows,
  filtersFromParams,
  foldForSearch,
  writeFilters,
} from './libraryFilter';

const note = (id: string, term: string, extra: Partial<Note> = {}): Note => ({
  id,
  user_id: null,
  created_at: Number(id.slice(1)),
  updated_at: 0,
  deleted_at: null,
  hlc: 'h',
  term,
  term_norm: term.toLowerCase(),
  term_type: 'word',
  lexicon_term_id: null,
  ipa: null,
  tags: [],
  possible_duplicate: false,
  level_override: null,
  ...extra,
});
const sense = (id: string, note_id: string, meaning: string): Sense => ({
  id,
  note_id,
  user_id: null,
  created_at: 0,
  updated_at: 0,
  deleted_at: null,
  hlc: 'h',
  sense_no: 1,
  lexicon_sense_id: null,
  pos: null,
  gloss_en: null,
  meaning_tr: meaning,
  meaning_tr_override: null,
  source_sentence: null,
  source_sentence_tr: null,
  span: null,
  source_id: null,
});

describe('libraryFilter', () => {
  it('folds Turkish letters and accents', () => {
    expect(foldForSearch('  Kıyı ŞEHİR  ')).toBe('kiyi sehir');
    expect(foldForSearch('café')).toBe('cafe');
  });

  it('filters 1,000 notes quickly and ranks term matches first', () => {
    const notes = Array.from({ length: 1000 }, (_, i) =>
      note(`n${i + 1}`, `word${i}`, { tags: i % 2 ? ['a'] : [] }),
    );
    notes.push(note('n2000', 'bank'), note('n2001', 'riverbank'));
    const senses = notes.map((n) =>
      sense(`s${n.id}`, n.id, n.term === 'riverbank' ? 'nehir kıyısı' : 'x'),
    );
    senses.push(sense('sx', 'n5', 'banka işi'));
    const cards = notes.map((n, i) =>
      makeCard({ note_id: n.id, state: (i % 4) as 0 | 1 | 2 | 3, suspended: i % 10 === 0 }),
    );
    const rows = buildRows(notes, senses, cards);
    const t0 = performance.now();
    const out = filterRows(rows, { ...EMPTY_FILTERS, q: 'bank' });
    expect(performance.now() - t0).toBeLessThan(50);
    expect(out.map((r) => r.note.term)).toEqual(['bank', 'riverbank', 'word4']);
    expect(filterRows(rows, { ...EMPTY_FILTERS, tag: 'a' })).toHaveLength(500);
    expect(
      filterRows(rows, { ...EMPTY_FILTERS, state: 'review', suspended: 'suspended' }).every((r) =>
        r.cards.some((c) => c.state === 2 && c.suspended),
      ),
    ).toBe(true);
  });

  it('round-trips filters through URL params', () => {
    const f = {
      ...EMPTY_FILTERS,
      q: 'kıyı',
      type: 'cloze' as const,
      state: 'learning' as const,
      tag: 'iş',
      dup: true,
      sort: 'az' as const,
    };
    expect(filtersFromParams(writeFilters(new URLSearchParams(), f))).toEqual(f);
    expect(writeFilters(new URLSearchParams(), EMPTY_FILTERS).toString()).toBe('');
    expect(filtersFromParams(new URLSearchParams('state=bogus&type=x'))).toEqual(EMPTY_FILTERS);
  });
});
