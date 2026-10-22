// Words the learner mixes up ("karıştırılan kelimeler", v0.3 İP6, docs/decisions/0026).
// Pure: the device scan for near pairs among the user's own terms, pair keys, the contrast
// card's ("fark kartı") term and keys, and the user_content shapes that remember a reported or
// hidden pair and the user's text of a contrast card. Nothing here reaches the network.
import { meaningAlternatives } from '../../supabase/functions/_shared/text';
import { contrastKey } from '../../supabase/functions/_shared/contrast-contracts';
import { contentRowId } from './examples';
import { normalizeTerm } from './normalize';
import type { Id, NoteTermType } from './types';

export { contrastKey };

/** Edit distance (Damerau–Levenshtein, adjacent transpositions) that makes a near pair. */
export const MAX_SPELLING_DISTANCE = 2;
/** Both lemmas need at least this many characters for a spelling pair ("affect" / "effect"). */
export const MIN_SPELLING_LENGTH = 5;
/**
 * A Turkish meaning shared by more notes than this is too common to suggest pairs from
 * ("olmak", "yapmak"): every pair of them would show up.
 */
export const MAX_MEANING_GROUP = 8;
/** Longest term (characters) the spelling scan looks at; longer ones are phrases, not look-alikes. */
const MAX_SCAN_LENGTH = 32;

/** user_content.kind of a pair the user reported (selected true) or hid (selected false). */
export const CONFUSION_KIND = 'confusion';
/** user_content.kind of the user's text of a contrast card (the one-line difference). */
export const CONTRAST_KIND = 'contrast';
/** notes.term_type of a contrast card (recognition card only). */
export const CONTRAST_TERM_TYPE = 'contrast' satisfies NoteTermType;
/** Joins the two terms of a contrast card: "affect ↔ effect". */
export const CONTRAST_JOIN = ' ↔ ';
/** Longest one-line difference the user can write or edit. */
export const MAX_CONTRAST_TEXT = 300;

// ------------------------------------------------------------------ edit distance

/**
 * Damerau–Levenshtein distance (optimal string alignment: insert, delete, substitute,
 * swap two neighbours), on code points. Stops early and returns `max + 1` once the distance
 * is certain to be above `max`.
 */
export function damerauLevenshtein(a: string, b: string, max = Infinity): number {
  const s = [...a];
  const t = [...b];
  if (Math.abs(s.length - t.length) > max) return max + 1;
  if (s.length === 0) return t.length;
  if (t.length === 0) return s.length;
  let prev2: number[] = [];
  let prev = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[t.length]!;
}

/**
 * Every string made by deleting up to `k` code points (symmetric-delete candidates): two
 * strings within Damerau–Levenshtein distance k always share one, because every edit can be
 * undone by deleting at most one character from each side.
 */
function deletions(word: string, k: number): Set<string> {
  const out = new Set<string>([word]);
  let frontier = [word];
  for (let d = 0; d < k; d++) {
    const next: string[] = [];
    for (const w of frontier) {
      const cps = [...w];
      for (let i = 0; i < cps.length; i++) {
        const v = cps.slice(0, i).join('') + cps.slice(i + 1).join('');
        if (!out.has(v)) {
          out.add(v);
          next.push(v);
        }
      }
    }
    frontier = next;
  }
  return out;
}

// ------------------------------------------------------------------ scan

export interface ConfusableTerm {
  note_id: Id;
  term: string;
  term_norm: string;
  term_type: NoteTermType;
  /** Live senses in display order (the first one stands for the note in a spelling pair). */
  senses: { id: Id; meaning: string; lexicon_sense_id: Id | null }[];
}

export type ConfusableReason = 'spelling' | 'meaning' | 'reported';

export interface ConfusableSide {
  note_id: Id;
  term: string;
  term_norm: string;
  /** The user's sense the pair is about (the shared meaning, else the first sense). */
  sense_id: Id | null;
}

export interface ConfusablePair {
  /** pairKey of the two terms. */
  key: string;
  /** Sorted by term_norm. */
  a: ConfusableSide;
  b: ConfusableSide;
  reason: ConfusableReason;
  /** Spelling pairs: the distance; meaning pairs: 0. */
  distance: number;
}

export interface ScanOptions {
  /**
   * Word-family id of a term (morphology data), or null when unknown. Members of one family
   * ("employ", "employer") are not confusables: they share a root on purpose.
   */
  familyOf?: (termNorm: string) => string | number | null;
}

/** Order-independent key of two terms (their normalised forms, sorted). */
export function pairKey(a: string, b: string): string {
  const [x, y] = [normalizeTerm(a), normalizeTerm(b)].sort();
  return `${x}\u0000${y}`;
}

const scannable = (t: ConfusableTerm) => t.term_type === 'word' || t.term_type === 'phrase' || t.term_type === 'pattern';

/** Same family or an obvious derivation (one form starts with the other: "employ" / "employer"). */
function related(a: ConfusableTerm, b: ConfusableTerm, opts: ScanOptions): boolean {
  if (a.term_norm.startsWith(b.term_norm) || b.term_norm.startsWith(a.term_norm)) return true;
  const fa = opts.familyOf?.(a.term_norm) ?? null;
  return fa !== null && fa === (opts.familyOf?.(b.term_norm) ?? null);
}

function side(t: ConfusableTerm, senseId: Id | null): ConfusableSide {
  return { note_id: t.note_id, term: t.term, term_norm: t.term_norm, sense_id: senseId ?? t.senses[0]?.id ?? null };
}

function makePair(x: ConfusableTerm, y: ConfusableTerm, reason: ConfusableReason, distance: number, sx: Id | null, sy: Id | null): ConfusablePair {
  const swap = y.term_norm < x.term_norm;
  const [a, b] = swap ? [side(y, sy), side(x, sx)] : [side(x, sx), side(y, sy)];
  return { key: pairKey(x.term_norm, y.term_norm), a, b, reason, distance };
}

/**
 * Near pairs among the user's terms: spelling (Damerau–Levenshtein ≤ 2, both lemmas at least
 * 5 characters) or the same Turkish meaning (a shared whole alternative, "etkilemek"), never
 * two members of one word family. Roots/affixes and contrast cards are left out. A pair that
 * is both comes once, as a spelling pair. Sorted by key, so the result is deterministic.
 */
export function scanConfusables(terms: readonly ConfusableTerm[], opts: ScanOptions = {}): ConfusablePair[] {
  const list = terms.filter(scannable);
  const found = new Map<string, ConfusablePair>();

  // Spelling: symmetric-delete candidates, then the exact distance.
  const byVariant = new Map<string, number[]>();
  list.forEach((t, i) => {
    const len = [...t.term_norm].length;
    if (len < MIN_SPELLING_LENGTH || len > MAX_SCAN_LENGTH) return;
    for (const v of deletions(t.term_norm, MAX_SPELLING_DISTANCE)) {
      const bucket = byVariant.get(v);
      if (bucket) bucket.push(i);
      else byVariant.set(v, [i]);
    }
  });
  const checked = new Set<number>();
  const n = list.length;
  for (const bucket of byVariant.values()) {
    if (bucket.length < 2) continue;
    for (let p = 0; p < bucket.length; p++) {
      for (let q = p + 1; q < bucket.length; q++) {
        const i = bucket[p]!;
        const j = bucket[q]!;
        const id = i < j ? i * n + j : j * n + i;
        if (checked.has(id)) continue;
        checked.add(id);
        const x = list[i]!;
        const y = list[j]!;
        if (x.term_norm === y.term_norm || related(x, y, opts)) continue;
        const d = damerauLevenshtein(x.term_norm, y.term_norm, MAX_SPELLING_DISTANCE);
        if (d <= MAX_SPELLING_DISTANCE) {
          const key = pairKey(x.term_norm, y.term_norm);
          found.set(key, makePair(x, y, 'spelling', d, null, null));
        }
      }
    }
  }

  // Meaning: notes that share a whole Turkish alternative.
  const byMeaning = new Map<string, { t: ConfusableTerm; sense: Id }[]>();
  for (const t of list) {
    const seen = new Set<string>();
    for (const s of t.senses) {
      for (const alt of meaningAlternatives(s.meaning)) {
        if (seen.has(alt)) continue;
        seen.add(alt);
        const group = byMeaning.get(alt);
        if (group) group.push({ t, sense: s.id });
        else byMeaning.set(alt, [{ t, sense: s.id }]);
      }
    }
  }
  for (const group of byMeaning.values()) {
    if (group.length < 2 || group.length > MAX_MEANING_GROUP) continue;
    for (let p = 0; p < group.length; p++) {
      for (let q = p + 1; q < group.length; q++) {
        const x = group[p]!;
        const y = group[q]!;
        if (x.t.term_norm === y.t.term_norm) continue;
        const key = pairKey(x.t.term_norm, y.t.term_norm);
        if (found.has(key) || related(x.t, y.t, opts)) continue;
        found.set(key, makePair(x.t, y.t, 'meaning', 0, x.sense, y.sense));
      }
    }
  }
  return [...found.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Pairs of the scan that involve this note. */
export const pairsOf = (pairs: readonly ConfusablePair[], noteId: Id): ConfusablePair[] =>
  pairs.filter((p) => p.a.note_id === noteId || p.b.note_id === noteId);

/**
 * The user's own terms for the "Hangi kelimeyle karıştırdın?" picker: near pairs of the card's
 * note first (spelling, then meaning), then the other terms filtered by `query` (any part of
 * the term or a Turkish meaning), alphabetically. The note itself, roots and contrast cards
 * are left out. At most `limit` entries.
 */
export function pickerTerms(
  terms: readonly ConfusableTerm[],
  noteId: Id,
  query: string,
  near: readonly ConfusablePair[],
  limit = 30,
): { term: ConfusableTerm; near: ConfusableReason | null }[] {
  const q = normalizeTerm(query);
  const nearBy = new Map<Id, ConfusableReason>();
  for (const p of pairsOf(near, noteId)) {
    const other = p.a.note_id === noteId ? p.b.note_id : p.a.note_id;
    if (!nearBy.has(other) || p.reason === 'spelling') nearBy.set(other, p.reason);
  }
  const matches = (t: ConfusableTerm) =>
    !q || t.term_norm.includes(q) || t.senses.some((s) => normalizeTerm(s.meaning).includes(q));
  const rank = (r: ConfusableReason | null) => (r === 'spelling' ? 0 : r === 'meaning' ? 1 : 2);
  return terms
    .filter((t) => t.note_id !== noteId && scannable(t) && matches(t))
    .map((t) => ({ term: t, near: nearBy.get(t.note_id) ?? null }))
    .sort((a, b) => rank(a.near) - rank(b.near) || a.term.term_norm.localeCompare(b.term.term_norm, 'en'))
    .slice(0, limit);
}

// ------------------------------------------------------------------ contrast cards

/** Display term of a contrast card: the two terms, sorted, "affect ↔ effect". */
export function contrastTerm(a: string, b: string): string {
  const [x, y] = [a.trim(), b.trim()].sort((p, q) => {
    const np = normalizeTerm(p);
    const nq = normalizeTerm(q);
    return np < nq ? -1 : np > nq ? 1 : 0;
  });
  return `${x}${CONTRAST_JOIN}${y}`;
}

/** The two terms of a contrast card's display term (null when it is not one). */
export function contrastTerms(term: string): [string, string] | null {
  const parts = term.split(CONTRAST_JOIN);
  if (parts.length !== 2 || !parts[0]!.trim() || !parts[1]!.trim()) return null;
  return [parts[0]!.trim(), parts[1]!.trim()];
}

/** The one-line difference: one line, trimmed, null when empty. */
export function cleanContrastText(text: string): string | null {
  const v = text.replace(/\s+/g, ' ').trim();
  return v ? v.slice(0, MAX_CONTRAST_TEXT) : null;
}

/** user_content row of a reported or hidden pair (two devices write the same row). */
export const confusionRowId = (termA: string, termB: string): Promise<Id> => {
  const [x, y] = [normalizeTerm(termA), normalizeTerm(termB)].sort();
  return contentRowId(['user_content', CONFUSION_KIND, x!, y!]);
};

/** user_content row with the user's text of a contrast card (one per contrast note). */
export const contrastTextRowId = (noteId: Id): Promise<Id> => contentRowId(['user_content', CONTRAST_KIND, noteId]);

/**
 * Pairs the app should offer: the scan's pairs and the reported ones (reported first), minus
 * the pairs the user hid and the pairs that already have a contrast card.
 */
export function suggestedPairs(
  scanned: readonly ConfusablePair[],
  reported: readonly ConfusablePair[],
  hidden: ReadonlySet<string>,
  carded: ReadonlySet<string>,
): ConfusablePair[] {
  const out = new Map<string, ConfusablePair>();
  for (const p of [...reported, ...scanned]) {
    if (hidden.has(p.key) || carded.has(p.key) || out.has(p.key)) continue;
    out.set(p.key, p);
  }
  return [...out.values()];
}

/** A scanned pair is worth offering only when its words gave this many lapses together. */
export const MIN_PAIR_LAPSES = 2;

/**
 * The pairs to show, best first. A distance of two letters matches many harmless pairs
 * ("acorn" / "apron"), so a scanned pair is offered only when the learner actually forgets
 * its words (MIN_PAIR_LAPSES lapses in total); a reported pair always is. Order: reported,
 * then more lapses, then fewer edits (a shared meaning counts as one), then key.
 */
export function rankPairs(
  pairs: readonly ConfusablePair[],
  lapsesOf: (noteId: Id) => number,
  limit = 20,
): ConfusablePair[] {
  const lapses = (p: ConfusablePair) => lapsesOf(p.a.note_id) + lapsesOf(p.b.note_id);
  const edits = (p: ConfusablePair) => (p.reason === 'meaning' ? 1 : p.distance);
  return pairs
    .filter((p) => p.reason === 'reported' || lapses(p) >= MIN_PAIR_LAPSES)
    .sort(
      (x, y) =>
        Number(y.reason === 'reported') - Number(x.reason === 'reported') ||
        lapses(y) - lapses(x) ||
        edits(x) - edits(y) ||
        (x.key < y.key ? -1 : x.key > y.key ? 1 : 0),
    )
    .slice(0, limit);
}
