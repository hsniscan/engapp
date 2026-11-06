// Step A of the bulk example job (decision 0074): find Tatoeba sentence pairs that contain a
// bank word and are easy enough for the word's level. No model call: a cheap model pass later
// says which meaning each pair shows (or none) and whether it is natural.
//
// Level of a sentence: every other word is looked up in the client level file
// (data/levels/client-levels.tsv, CEFR-J + Octanove with the Turkish-learner corrections, and
// wordfreq Zipf values for words outside the lists). Names (capitalised words inside the
// sentence) are ignored. A pair passes when no word is more than one level above the bank
// word and at most two are above it.

import { exampleTextKey } from '../../supabase/functions/_shared/sentences.ts';
import { irregularBases, lemmaForms } from '../../supabase/functions/_shared/tokenize.ts';
import { exampleSpan } from '../../supabase/functions/_shared/wordbank-contract.ts';
import type { TatoebaPair } from './tatoeba.ts';

export const CEFR_RANKS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export const rankOf = (cefr: string): number => {
  const r = (CEFR_RANKS as readonly string[]).indexOf(cefr);
  return r < 0 ? 5 : r;
};

/** Lemma → the easiest level any list gives it (Turkish-learner correction applied), and Zipf. */
export type LevelIndex = Map<string, { rank: number | null; zipf: number | null }>;

/** Parses data/levels/client-levels.tsv ("lemma \t zipf \t pos:cefr:src[:cefr_tr:reason]|…"). */
export function parseLevelIndex(text: string): LevelIndex {
  const out: LevelIndex = new Map();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [lemma, z, entries] = line.split('\t');
    if (!lemma) continue;
    let rank: number | null = null;
    for (const e of entries ? entries.split('|') : []) {
      const [, cefr, , trCefr] = e.split(':');
      const lv = trCefr && (CEFR_RANKS as readonly string[]).includes(trCefr) ? trCefr : cefr;
      if (!lv || !(CEFR_RANKS as readonly string[]).includes(lv)) continue;
      const r = rankOf(lv);
      rank = rank === null ? r : Math.min(rank, r);
    }
    const zipf = z ? Number(z) : null;
    out.set(lemma, { rank, zipf: zipf !== null && Number.isFinite(zipf) ? zipf : null });
  }
  return out;
}

/** Rough level of a word known only by its frequency. */
export function rankFromZipf(zipf: number): number {
  if (zipf >= 5.5) return 0;
  if (zipf >= 5) return 1;
  if (zipf >= 4.5) return 2;
  if (zipf >= 4) return 3;
  if (zipf >= 3.5) return 4;
  return 5;
}

/** Level rank of one lower-case word (its easiest base form), or null when unknown. */
export function wordRank(word: string, index: LevelIndex): number | null {
  let best: number | null = null;
  let freq: number | null = null;
  for (const f of new Set([...lemmaForms(word), ...irregularBases(word)])) {
    const hit = index.get(f);
    if (!hit) continue;
    if (hit.rank !== null) best = best === null ? hit.rank : Math.min(best, hit.rank);
    else if (hit.zipf !== null) freq = Math.max(freq ?? 0, hit.zipf);
  }
  if (best !== null) return best;
  return freq !== null ? rankFromZipf(freq) : null;
}

const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;

/**
 * Words the job leaves out of Tatoeba matches unless they are the bank word itself (our
 * content rules: no violence, adult topics, religion, politics or insults).
 */
export const BLOCKED_WORDS: ReadonlySet<string> = new Set([
  'kill', 'killed', 'kills', 'killing', 'murder', 'murdered', 'gun', 'guns', 'shoot', 'shot',
  'suicide', 'drug', 'drugs', 'drunk', 'sex', 'sexy', 'naked', 'god', 'jesus', 'allah', 'church',
  'mosque', 'bible', 'pray', 'war', 'bomb', 'president', 'politics', 'damn', 'hell', 'fuck',
  'shit', 'bitch', 'stupid', 'idiot', 'hate', 'hates', 'dead', 'die', 'died', 'blood', 'beer',
  'wine', 'whisky', 'alcohol', 'cigarette', 'smoke', 'prison', 'police', 'nazi', 'hitler',
]);

export interface PairFeatures {
  words: number;
  /** Words above the bank word's level (names and the bank word itself left out). */
  above: number;
  /** The level rank of the hardest such word (-1 when none). */
  hardest: number;
  unknown: number;
  names: number;
  blocked: boolean;
}

/** Plain-text shape checks of a pair (the model checks the meaning and naturalness later). */
export function pairShapeOk(p: Pick<TatoebaPair, 'en' | 'tr'>): boolean {
  const en = p.en;
  const tr = p.tr;
  if (en.length < 12 || en.length > 120 || tr.length < 8 || tr.length > 160) return false;
  if (!/^["'A-Z]/u.test(en) || !/[.!?]["']?$/u.test(en) || !/[.!?…]["']?$/u.test(tr)) return false;
  if (/[<>{}[\]\\|@#*_~/]|https?:|\d{3,}/u.test(en + tr)) return false;
  if (/[\p{Script=Cyrillic}\p{Script=Han}\p{Script=Arabic}]/u.test(en + tr)) return false;
  if (en.toLowerCase() === tr.toLowerCase()) return false;
  const ratio = tr.length / en.length;
  if (ratio < 0.5 || ratio > 2.2) return false;
  const words = en.match(WORD)?.length ?? 0;
  return words >= 4 && words <= 16;
}

/** Level and content features of an English sentence for one bank word. */
export function pairFeatures(
  en: string,
  span: [number, number],
  wordRankOfRow: number,
  index: LevelIndex,
): PairFeatures {
  const f: PairFeatures = { words: 0, above: 0, hardest: -1, unknown: 0, names: 0, blocked: false };
  for (const m of en.matchAll(WORD)) {
    f.words++;
    const at = m.index ?? 0;
    if (at >= span[0] && at < span[1]) continue; // the bank word itself
    const raw = m[0];
    const w = raw.toLowerCase().replace(/’/g, "'");
    if (BLOCKED_WORDS.has(w)) f.blocked = true;
    const r = wordRank(w, index);
    // A capital inside the sentence, or an unknown capitalised first word ("Tom"), is a name.
    if (/^\p{Lu}/u.test(raw) && w !== 'i' && (at > 0 || r === null)) {
      f.names++;
      continue;
    }
    if (r === null) {
      f.unknown++;
      continue;
    }
    if (r > wordRankOfRow) {
      f.above++;
      f.hardest = Math.max(f.hardest, r);
    }
  }
  return f;
}

/** Lower is better: short, easy, few names. Null: the pair does not fit the word's level. */
export function pairScore(f: PairFeatures, wordRankOfRow: number): number | null {
  if (f.blocked) return null;
  if (f.hardest > wordRankOfRow + 1 || f.above > 2 || f.unknown > 1) return null;
  return f.words + 3 * f.above + 4 * f.unknown + 1.5 * f.names;
}

/** A Tatoeba pair found for a bank row. */
export interface MatchedPair {
  pair: TatoebaPair;
  score: number;
}

/**
 * Inverted index over the pairs: every base form of every English word → pair numbers, the
 * pairs sorted shortest first, so a row reads its easiest candidates first.
 */
export class PairIndex {
  readonly pairs: TatoebaPair[];
  private readonly byForm = new Map<string, number[]>();

  constructor(pairs: readonly TatoebaPair[]) {
    // One pair per English sentence (its first Turkish translation), shortest first.
    const seen = new Set<string>();
    this.pairs = [...pairs]
      .filter(pairShapeOk)
      .sort((a, b) => a.en.length - b.en.length || a.en_id - b.en_id)
      .filter((p) => {
        const k = exampleTextKey(p.en);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    this.pairs.forEach((p, i) => {
      const forms = new Set<string>();
      for (const m of p.en.matchAll(WORD)) {
        const w = m[0].toLowerCase().replace(/’/g, "'");
        for (const f of lemmaForms(w)) forms.add(f);
        for (const f of irregularBases(w)) forms.add(f);
      }
      for (const f of forms) {
        const list = this.byForm.get(f);
        if (list) list.push(i);
        else this.byForm.set(f, [i]);
      }
    });
  }

  /** Pair numbers whose English has every content word of the lemma (in order of length). */
  candidates(lemmaNorm: string): number[] {
    const parts = lemmaNorm.split(/\s+/).filter((w) => w.length > 1 || lemmaNorm.length === 1);
    const lists = parts.map((w) => this.byForm.get(w) ?? []);
    if (lists.length === 0 || lists.some((l) => l.length === 0)) return [];
    if (lists.length === 1) return lists[0]!;
    const [shortest, ...rest] = [...lists].sort((a, b) => a.length - b.length);
    const sets = rest.map((l) => new Set(l));
    return shortest!.filter((i) => sets.every((s) => s.has(i))).sort((a, b) => a - b);
  }
}

export interface MatchOptions {
  /** At most this many pairs per row. */
  want: number;
  /** English sentences the senses already have (bank examples, shared examples): skipped. */
  avoid: ReadonlySet<string>;
  /** Stop after checking this many candidates (frequent words have tens of thousands). */
  maxChecked?: number;
}

/** The best pairs for one bank row (lemma, level), best first. */
export function matchRow(
  index: PairIndex,
  levels: LevelIndex,
  row: { lemma_norm: string; cefr: string },
  opts: MatchOptions,
): MatchedPair[] {
  const rank = rankOf(row.cefr);
  const found: MatchedPair[] = [];
  const maxChecked = opts.maxChecked ?? 4000;
  let checked = 0;
  for (const i of index.candidates(row.lemma_norm)) {
    if (++checked > maxChecked) break;
    const pair = index.pairs[i]!;
    if (opts.avoid.has(exampleTextKey(pair.en))) continue;
    const span = exampleSpan(pair.en, row.lemma_norm);
    if (!span) continue;
    const score = pairScore(pairFeatures(pair.en, span, rank, levels), rank);
    if (score === null) continue;
    found.push({ pair, score });
    // Candidates come shortest first: once there are plenty, longer ones rarely win.
    if (found.length >= opts.want * 6) break;
  }
  // Prefer easy, short sentences; keep some variety (no two with the same first three words).
  found.sort((a, b) => a.score - b.score || a.pair.en.length - b.pair.en.length);
  const out: MatchedPair[] = [];
  const starts = new Set<string>();
  for (const m of found) {
    const start = exampleTextKey(m.pair.en).split(' ').slice(0, 3).join(' ');
    if (starts.has(start)) continue;
    starts.add(start);
    out.push(m);
    if (out.length >= opts.want) break;
  }
  return out;
}
