// Test helpers shared by domain and data tests (not imported by app code).
import type { Card, ReviewLog, RatingValue, Sense } from '../domain/types';
import { emptyFsrs } from '../domain/fsrs';

let n = 0;
const nextId = (p: string): string => `${p}-${String(++n).padStart(6, '0')}`;

export function makeLog(p: Partial<ReviewLog> & { card_id: string; reviewed_at: number; rating?: RatingValue }): ReviewLog {
  return {
    id: p.id ?? nextId('log'),
    user_id: null,
    rating: 3,
    duration_ms: 5000,
    device_id: 'test',
    undo_of: null,
    shown_sense_id: null,
    created_at: p.reviewed_at,
    hlc: 'h',
    ...p,
  };
}

export function makeCard(p: Partial<Card> & { note_id: string }): Card {
  const created = p.created_at ?? 0;
  return {
    id: p.id ?? nextId('card'),
    user_id: null,
    created_at: created,
    updated_at: created,
    deleted_at: null,
    hlc: 'h',
    sense_id: null,
    card_type: 'recognition',
    suspended: false,
    unlocked: true,
    ...emptyFsrs(created),
    ...p,
  };
}

export function makeSense(p: Partial<Sense> & { note_id: string }): Sense {
  return {
    id: p.id ?? nextId('sense'),
    user_id: null,
    created_at: 0,
    updated_at: 0,
    deleted_at: null,
    hlc: 'h',
    sense_no: 1,
    lexicon_sense_id: null,
    pos: null,
    gloss_en: null,
    meaning_tr: 'anlam',
    meaning_tr_override: null,
    source_sentence: null,
    source_sentence_tr: null,
    span: null,
    source_id: null,
    ...p,
  };
}
