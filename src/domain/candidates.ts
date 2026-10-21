// Smart extraction (v0.2 İP4): which preview candidates are pre-selected, and in which
// section of the preview each one is shown. Pure: the caller passes the learner's level, the
// candidates' levels and what the learner already knows (decided on the device; the list of
// known words never leaves it).
//
// The rule (owner's acceptance criterion 5, docs/decisions/0018):
//   - known: the learner has a note for the term or marked it known → never pre-selected;
//   - too_hard: more than one level above the learner → never pre-selected (prose: only
//     counted; vocabulary lists: shown, since a list must yield every entry);
//   - the pre-selected set holds at least 55 % of the learner's level L, at most 10 % of
//     L+1 and the rest from lower levels; nothing above L+1. An item of unknown level
//     counts as L+1. With no item at level L nothing is pre-selected: the quota is never
//     filled with harder (or only easier) words.
//   - "for_you": the pre-selected items, then L+1 items that did not fit (unselected);
//     "easy": lower-level items that did not fit (unselected).
// Inside each section: more occurrences in the text first, then the more frequent word;
// candidates of a vocabulary list keep the list's order.
import { lemmaForms, tokenize } from '../../supabase/functions/_shared/tokenize';
import { CEFR, levelRank } from './level';
import { normalizeTerm } from './normalize';
import type { CandidateBucket, CefrLevel } from './types';

export type { CandidateBucket };

/** Display order of the preview's sections. */
export const BUCKETS: readonly CandidateBucket[] = ['for_you', 'easy', 'known', 'too_hard'];

/** Share of the pre-selected set that must be at the learner's level (at least). */
export const SAME_LEVEL_MIN = 0.55;
/** Share of the pre-selected set that may be one level above (at most). */
export const NEXT_LEVEL_MAX = 0.1;

export interface CandidateFacts {
  id: string;
  /** Normalised term (notes.term_norm / known-term key). */
  key: string;
  /** Resolved level of the candidate's sense; null = unknown (treated as L+1). */
  cefr: CefrLevel | null;
  /** Occurrences of the term in the whole imported text (≥ 1). */
  occurrences: number;
  /** Word frequency (Zipf); null = unknown (sorted last). */
  zipf: number | null;
  /** The learner already has a live note for this term (any sense). */
  hasNote: boolean;
  /** The candidate comes from a vocabulary list (every entry is shown). */
  fromList: boolean;
  /** Original position (tie-breaker, keeps the text's order). */
  order: number;
}

export interface CandidatePlanRow {
  id: string;
  bucket: CandidateBucket;
  selected: boolean;
}

export interface CandidatePlan {
  /** Every input row once, sorted by section, then inside the section. */
  rows: CandidatePlanRow[];
  counts: Record<CandidateBucket, number>;
  selected: number;
}

export type LevelBand = 'lower' | 'same' | 'next' | 'above';

/** Where a candidate's level sits relative to the learner's; unknown counts as the next level. */
export function levelBand(cefr: CefrLevel | null, level: CefrLevel): LevelBand {
  if (cefr === null) return 'next';
  const d = levelRank(cefr) - levelRank(level);
  return d < 0 ? 'lower' : d === 0 ? 'same' : d === 1 ? 'next' : 'above';
}

/** The highest level a learner at `level` is offered (L+1, C2 at most). */
export function targetLevel(level: CefrLevel): CefrLevel {
  return CEFR[Math.min(CEFR.length - 1, levelRank(level) + 1)]!;
}

/** More occurrences first, then the more frequent word (unknown frequency last), then text order. */
export function compareCandidates(a: CandidateFacts, b: CandidateFacts): number {
  if (a.occurrences !== b.occurrences) return b.occurrences - a.occurrences;
  const za = a.zipf ?? -Infinity;
  const zb = b.zipf ?? -Infinity;
  if (za !== zb) return zb - za;
  return a.order - b.order;
}

/**
 * Size of the largest pre-selected set: `same` items at level L (all taken), up to `next`
 * at L+1 and `lower` below, with same ≥ 55 % and next ≤ 10 % of the total. Integer
 * arithmetic: 20·same ≥ 11·T and 10·next ≤ T.
 */
export function selectionQuota(
  same: number,
  next: number,
  lower: number,
): { same: number; next: number; lower: number } {
  if (same <= 0) return { same: 0, next: 0, lower: 0 };
  for (let total = Math.floor((20 * same) / 11); total >= same; total--) {
    const n = Math.min(next, Math.floor(total / 10), total - same);
    const l = total - same - n;
    if (l <= lower) return { same, next: n, lower: l };
  }
  return { same, next: 0, lower: 0 };
}

/** Pre-selection and sections for one import job. */
export function planCandidates(
  items: readonly CandidateFacts[],
  level: CefrLevel,
  known: ReadonlySet<string> = new Set(),
): CandidatePlan {
  const knownRows: CandidateFacts[] = [];
  const tooHard: CandidateFacts[] = [];
  const same: CandidateFacts[] = [];
  const next: CandidateFacts[] = [];
  const lower: CandidateFacts[] = [];
  for (const c of items) {
    if (c.hasNote || known.has(c.key)) {
      knownRows.push(c);
      continue;
    }
    const band = levelBand(c.cefr, level);
    if (band === 'above') tooHard.push(c);
    else if (band === 'same') same.push(c);
    else if (band === 'next') next.push(c);
    else lower.push(c);
  }
  same.sort(compareCandidates);
  next.sort(compareCandidates);
  // Lower levels: the closest to the learner's level first (an A2 word is more likely new to
  // a B1 learner than an A1 word), then occurrences and frequency.
  lower.sort((a, b) => levelRank(b.cefr!) - levelRank(a.cefr!) || compareCandidates(a, b));

  const quota = selectionQuota(same.length, next.length, lower.length);
  const chosenNext = next.slice(0, quota.next);
  const chosenLower = lower.slice(0, quota.lower);
  const selected = [...same, ...chosenNext, ...chosenLower].sort(compareCandidates);
  const forYou = [...selected, ...next.slice(quota.next)];
  const easy = lower.slice(quota.lower).sort(compareCandidates);
  knownRows.sort(compareCandidates);
  tooHard.sort(compareCandidates);

  // Display: a vocabulary list keeps its own order inside a section.
  const display = (list: CandidateFacts[]) =>
    list.every((c) => c.fromList) ? [...list].sort((a, b) => a.order - b.order) : list;
  const selectedIds = new Set(selected.map((c) => c.id));
  const rows: CandidatePlanRow[] = [];
  const push = (list: CandidateFacts[], bucket: CandidateBucket) => {
    for (const c of list) rows.push({ id: c.id, bucket, selected: selectedIds.has(c.id) });
  };
  push(display(selected).concat(display(next.slice(quota.next))), 'for_you');
  push(display(easy), 'easy');
  push(display(knownRows), 'known');
  push(display(tooHard), 'too_hard');
  return {
    rows,
    counts: {
      for_you: forYou.length,
      easy: easy.length,
      known: knownRows.length,
      too_hard: tooHard.length,
    },
    selected: selectedIds.size,
  };
}

// ------------------------------------------------------------------ occurrences

/**
 * Counts how often a candidate occurs in a text. A single word counts every inflected form
 * ("copes", "coped" → "cope"); a multi-word expression counts its surface as it appears in
 * the candidate's sentence (case-insensitive). At least 1: the candidate came from the text.
 */
export function occurrenceCounter(text: string): (term: string, surface: string) => number {
  const byForm = new Map<string, number>();
  for (const t of tokenize(text)) {
    for (const f of lemmaForms(t.norm)) byForm.set(f, (byForm.get(f) ?? 0) + 1);
  }
  const lower = normalizeTerm(text);
  return (term, surface) => {
    const key = normalizeTerm(term);
    if (/^[\p{L}\p{M}'-]+$/u.test(key)) return Math.max(1, byForm.get(key) ?? 0);
    const needle = normalizeTerm(surface);
    if (!needle) return 1;
    let n = 0;
    for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length))
      n++;
    return Math.max(1, n);
  };
}
