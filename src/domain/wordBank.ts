// Kelime Bankası (decision 0038): browsing the leveled list words and picking words to study.
// Pure functions; the rows come from the device's copy of public.word_bank (src/data/wordBank.ts).
import type {
  WordBankRow,
  WordBankSense,
} from '../../supabase/functions/_shared/wordbank-contract';
import { CEFR, levelRank } from './level';
import { normalizeTerm } from './normalize';
import type { CefrLevel } from './types';

export type { WordBankSense };

/** A bank row on the device (Dexie `word_bank`), keyed by lemma and part of speech. */
export interface WordBankEntry {
  /** `${lemma_norm}|${pos}` */
  id: string;
  lemma_norm: string;
  pos: string;
  lemma: string;
  cefr: CefrLevel;
  zipf: number | null;
  lexicon_term_id: string | null;
  senses: WordBankSense[];
}

export const wordBankId = (lemmaNorm: string, pos: string): string => `${lemmaNorm}|${pos}`;

export function entryFromRow(row: WordBankRow): WordBankEntry {
  return {
    id: wordBankId(row.lemma_norm, row.pos),
    lemma_norm: row.lemma_norm,
    pos: row.pos,
    lemma: row.lemma,
    cefr: row.cefr,
    zipf: row.zipf,
    lexicon_term_id: row.lexicon_term_id,
    senses: row.senses,
  };
}

/** What the user already has: live known words and live notes, by normalised term. */
export interface OwnedTerms {
  known: ReadonlySet<string>;
  carded: ReadonlySet<string>;
}

export type OwnedStatus = 'known' | 'carded' | null;

/** A card beats "known" (the word is being studied). */
export function ownedStatus(
  entry: Pick<WordBankEntry, 'lemma_norm'>,
  owned: OwnedTerms,
): OwnedStatus {
  const key = normalizeTerm(entry.lemma_norm);
  if (owned.carded.has(key)) return 'carded';
  if (owned.known.has(key)) return 'known';
  return null;
}

export interface BankFilter {
  /** null: every level. */
  level: CefrLevel | null;
  /** null: every part of speech. */
  pos: string | null;
  /** Free text: English word or Turkish meaning. */
  query: string;
  /** Also show words the user knows or has cards for (marked). */
  showOwned: boolean;
}

export interface BankItem {
  entry: WordBankEntry;
  owned: OwnedStatus;
}

/** Turkish-aware lower case for matching meanings ("İ" → "i", "I" → "ı"). */
const trLower = (s: string) => s.normalize('NFC').toLocaleLowerCase('tr');

/** More frequent words first, then alphabetical. */
export function byFrequency(a: WordBankEntry, b: WordBankEntry): number {
  return (
    (b.zipf ?? -1) - (a.zipf ?? -1) ||
    a.lemma_norm.localeCompare(b.lemma_norm, 'en') ||
    a.pos.localeCompare(b.pos)
  );
}

/**
 * The list the screen shows: level, part of speech and text filters; owned words hidden
 * unless asked for. Without a query: most frequent first. With a query: exact word, then
 * words starting with it, then words containing it, then Turkish meanings containing it (the
 * query matches both languages, so "elma" finds "apple").
 */
export function filterBank(
  entries: readonly WordBankEntry[],
  f: BankFilter,
  owned: OwnedTerms,
): BankItem[] {
  const q = normalizeTerm(f.query);
  const qTr = trLower(f.query.trim());
  const scored: { item: BankItem; score: number }[] = [];
  for (const entry of entries) {
    if (f.level && entry.cefr !== f.level) continue;
    if (f.pos && entry.pos !== f.pos) continue;
    const status = ownedStatus(entry, owned);
    if (status && !f.showOwned) continue;
    let score = 0;
    if (q) {
      if (entry.lemma_norm === q) score = 4;
      else if (entry.lemma_norm.startsWith(q)) score = 3;
      else if (entry.lemma_norm.includes(q)) score = 2;
      else if (entry.senses.some((s) => trLower(s.meaning_tr).includes(qTr))) score = 1;
      else continue;
    }
    scored.push({ item: { entry, owned: status }, score });
  }
  scored.sort((a, b) => b.score - a.score || byFrequency(a.item.entry, b.item.entry));
  return scored.map((s) => s.item);
}

/** Words per level the user does not own yet (for the level chips). */
export function countByLevel(
  entries: readonly WordBankEntry[],
  owned: OwnedTerms,
): Record<CefrLevel, number> {
  const out = Object.fromEntries(CEFR.map((l) => [l, 0])) as Record<CefrLevel, number>;
  for (const e of entries) if (!ownedStatus(e, owned)) out[e.cefr]++;
  return out;
}

// ---------------------------------------------------------------------------
// "Bu seviyeden 10 kelime ekle": the owner's level mix
// ---------------------------------------------------------------------------

/** Share of the learner's own level X. */
export const MIX_OWN_SHARE = 0.55;
/** At most this share from X+1; never anything above X+1. */
export const MIX_UP_MAX_SHARE = 0.1;
export const QUICK_ADD_COUNT = 10;

export interface MixPlan {
  own: number;
  up: number;
  lower: number;
}

/** How many words of each kind a mix of n aims for (before availability). */
export function mixTargets(level: CefrLevel, n: number): MixPlan {
  const x = levelRank(level);
  const own = Math.round(n * MIX_OWN_SHARE);
  const up = x < CEFR.length - 1 ? Math.floor(n * MIX_UP_MAX_SHARE) : 0;
  return { own, up, lower: Math.max(0, n - own - up) };
}

/**
 * Up to n words for a learner at `level`, never one they know or have a card for: about 55 %
 * from their level X, at most 10 % from X+1, the rest from lower levels (nearest first), never
 * above X+1. When a group runs short the others fill in (lower levels first, then X), but X+1
 * never takes more than its share. Within a level the most frequent words come first, so the
 * next quick add continues where this one stopped. Distinct words: one part of speech per lemma.
 */
export function pickLevelMix(
  entries: readonly WordBankEntry[],
  owned: OwnedTerms,
  level: CefrLevel,
  n: number = QUICK_ADD_COUNT,
): WordBankEntry[] {
  if (n <= 0) return [];
  const x = levelRank(level);
  const byLevel = new Map<number, WordBankEntry[]>();
  const seen = new Set<string>();
  for (const e of [...entries].sort(byFrequency)) {
    const r = levelRank(e.cefr);
    if (r > x + 1 || ownedStatus(e, owned) || seen.has(e.lemma_norm)) continue;
    seen.add(e.lemma_norm);
    byLevel.set(r, [...(byLevel.get(r) ?? []), e]);
  }
  const take = (r: number, k: number): WordBankEntry[] => {
    const list = byLevel.get(r) ?? [];
    const got = list.splice(0, Math.max(0, k));
    return got;
  };
  const t = mixTargets(level, n);
  const up = take(x + 1, t.up);
  const own = take(x, t.own);
  const lower: WordBankEntry[] = [];
  let want = n - up.length - own.length;
  for (let r = x - 1; r >= 0 && want > 0; r--) {
    const got = take(r, want);
    lower.push(...got);
    want -= got.length;
  }
  // Short on lower levels (A1, or few left): more from X.
  if (want > 0) own.push(...take(x, want));
  return [...lower, ...own, ...up];
}
