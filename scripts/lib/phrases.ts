// Phrasal verbs and collocations for the Kelime Bankası (v0.5.3 C4, decision 0074): the
// candidate lists, their corpus counts and levels. Pure functions; scripts/build-phrases.ts
// downloads the inputs and stores the result in public.ref_phrases.
//
// Sources and licences: phrasal-verb headwords from Wiktionary's "English phrasal verbs"
// category (CC BY-SA 4.0; only the list of titles is used, no definitions); collocations are
// found in the corpora themselves. Counts come from the Tatoeba English sentences (CC BY 2.0 FR)
// and, when given, Simple English Wikipedia (CC BY-SA 4.0); no corpus text is shipped. Lists
// with unclear commercial terms (PHaVE, Liu, Oxford, Cambridge, Kelly) are not used.

import { irregularBases, lemmaForms } from '../../supabase/functions/_shared/tokenize.ts';
import type { LevelIndex } from './example-match.ts';

/** Particles (adverbs and prepositions) a phrasal verb is made with. */
export const PARTICLES: ReadonlySet<string> = new Set([
  'about', 'across', 'after', 'against', 'ahead', 'along', 'apart', 'around', 'aside', 'at',
  'away', 'back', 'behind', 'by', 'down', 'for', 'forward', 'from', 'in', 'into', 'of', 'off',
  'on', 'onto', 'out', 'over', 'past', 'round', 'through', 'to', 'together', 'under', 'up',
  'upon', 'with', 'without',
]);

/** Particles that may follow a short object ("turn the radio down"); prepositions may not. */
export const SEPARABLE: ReadonlySet<string> = new Set([
  'about', 'apart', 'around', 'aside', 'away', 'back', 'down', 'in', 'off', 'on', 'out', 'over',
  'round', 'through', 'together', 'up',
]);

/** Verbs that make the verb + noun collocations Turkish speakers get wrong ("do a mistake"). */
export const COLLOCATION_VERBS: readonly string[] = [
  'make', 'do', 'take', 'have', 'give', 'pay', 'keep', 'catch', 'break', 'tell', 'lose', 'save',
  'spend', 'waste', 'raise', 'set', 'hold', 'miss', 'commit', 'reach', 'solve', 'play', 'win',
  'follow', 'run', 'get', 'change', 'answer', 'ask', 'meet', 'brush', 'call', 'cause', 'draw',
  'earn', 'face', 'fill', 'gain', 'hit', 'join', 'kill', 'lead', 'leave', 'lend', 'pass', 'pick',
  'place', 'press', 'pull', 'put', 'reach', 'ring', 'see', 'send', 'shake', 'show', 'take',
  'tell', 'throw', 'wash', 'watch', 'wear',
].filter((v, i, a) => a.indexOf(v) === i && v !== 'kill' && v !== 'see');

/** Determiners kept in a collocation's headword ("make a decision", "tell the truth"). */
const ARTICLES: ReadonlySet<string> = new Set(['a', 'an', 'the']);
const POSSESSIVES: ReadonlySet<string> = new Set(['my', 'your', 'his', 'her', 'our', 'their', 'its']);
const OTHER_DETERMINERS: ReadonlySet<string> = new Set(['some', 'any', 'no', 'this', 'that', 'every']);

/** Words in a Wiktionary title that make it an idiom template, not a phrasal verb. */
const PLACEHOLDERS = /\b(one's|oneself|someone|somebody|something|sth|sb)\b/;

// ---------------------------------------------------------------------------
// Wiktionary
// ---------------------------------------------------------------------------

/** One page of the MediaWiki categorymembers API: titles and the continue token. */
export function parseCategoryPage(json: unknown): { titles: string[]; next: string | null } {
  const j = json as {
    query?: { categorymembers?: { title?: unknown; ns?: unknown }[] };
    continue?: { cmcontinue?: unknown };
  };
  const titles = (j.query?.categorymembers ?? [])
    .filter((m) => (m.ns ?? 0) === 0 && typeof m.title === 'string')
    .map((m) => m.title as string);
  const next = typeof j.continue?.cmcontinue === 'string' ? j.continue.cmcontinue : null;
  return { titles, next };
}

/**
 * A Wiktionary title as a phrasal verb headword: lower case, a verb (a verb of the level
 * lists) and one or two particles ("give up", "look forward to"). Null for anything else
 * (idioms with "one's", capitals, other words).
 */
export function phrasalVerbOf(title: string, isVerb: (w: string) => boolean): string | null {
  const t = title.trim();
  if (t !== t.toLowerCase() || PLACEHOLDERS.test(t)) return null;
  if (!/^[a-z]+(?: [a-z]+){1,2}$/.test(t)) return null;
  const [verb, ...rest] = t.split(' ');
  if (!verb || !isVerb(verb) || rest.some((p) => !PARTICLES.has(p))) return null;
  return t;
}

// ---------------------------------------------------------------------------
// corpora
// ---------------------------------------------------------------------------

const WORD = /[a-z]+(?:'[a-z]+)?/g;

/** Lower-case word tokens of a sentence; punctuation becomes a break (null). */
export function tokens(sentence: string): (string | null)[] {
  const out: (string | null)[] = [];
  for (const part of sentence.toLowerCase().replace(/[’]/g, "'").split(/[,.;:!?()"—–]+/)) {
    for (const m of part.matchAll(WORD)) out.push(m[0]);
    out.push(null);
  }
  return out;
}

/** Wiki markup out of one line of a Simple English Wikipedia dump (rough, for counting only). */
export function wikiText(line: string): string | null {
  const t = line.trim();
  if (!t || /^[<{|!=:#;]|^\[\[(Category|File|Image):/i.test(t) || t.startsWith('}}')) return null;
  const s = t
    .replace(/<ref[^>]*\/>/g, ' ')
    .replace(/<ref[^>]*>.*?<\/ref>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{\{[^{}]*\}\}/g, ' ')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:[^\s\]]+\s?([^\]]*)\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/^\*+\s*/, '');
  return /[a-z]{3}/i.test(s) ? s : null;
}

/** Splits text into sentences (good enough for counting). */
export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z"'])/u).filter((s) => s.length > 3);
}

/** Base forms of a token (regular and the known irregular forms), cached. */
export class Lemmatizer {
  private cache = new Map<string, readonly string[]>();
  bases(w: string): readonly string[] {
    let b = this.cache.get(w);
    if (!b) {
      b = [...new Set([...lemmaForms(w), ...irregularBases(w)])];
      if (this.cache.size < 500_000) this.cache.set(w, b);
    }
    return b;
  }
}

/** Phrasal verb counts in one corpus: once per sentence, particle split included. */
export class PhrasalCounter {
  readonly counts = new Map<string, number>();
  words = 0;
  private byVerb = new Map<string, string[][]>();
  private lem = new Lemmatizer();

  constructor(phrasals: readonly string[]) {
    for (const p of phrasals) {
      const [verb, ...rest] = p.split(' ');
      this.byVerb.set(verb!, [...(this.byVerb.get(verb!) ?? []), rest]);
      this.counts.set(p, 0);
    }
  }

  add(sentence: string): void {
    const toks = tokens(sentence);
    this.words += toks.filter((t) => t !== null).length;
    const found = new Set<string>();
    toks.forEach((tok, i) => {
      if (!tok) return;
      for (const base of this.lem.bases(tok)) {
        for (const rest of this.byVerb.get(base) ?? []) {
          const name = `${base} ${rest.join(' ')}`;
          if (found.has(name)) continue;
          if (matchesAt(toks, i + 1, rest)) found.add(name);
          // "turn the radio down": one separable particle after up to three object words
          // (not a pronoun-only check: "turn it down" counts too).
          else if (rest.length === 1 && SEPARABLE.has(rest[0]!)) {
            for (let g = 1; g <= 3; g++) {
              const at = toks[i + g];
              if (!at || PARTICLES.has(at)) break;
              if (toks[i + g + 1] === rest[0]) {
                found.add(name);
                break;
              }
            }
          }
        }
      }
    });
    for (const f of found) this.counts.set(f, (this.counts.get(f) ?? 0) + 1);
  }
}

const matchesAt = (toks: (string | null)[], at: number, words: readonly string[]) =>
  words.every((w, k) => toks[at + k] === w);

/** Verb + (article) + noun counts in one corpus, with the article each pair was seen with. */
export class CollocationCounter {
  /** "make|decision" → { "": 3, "a": 40, "the": 2 } */
  readonly pairs = new Map<string, Map<string, number>>();
  readonly verbCount = new Map<string, number>();
  readonly nounCount = new Map<string, number>();
  words = 0;
  private lem = new Lemmatizer();
  private verbs: ReadonlySet<string>;
  private isNoun: (w: string) => boolean;

  constructor(verbs: readonly string[], isNoun: (w: string) => boolean) {
    this.verbs = new Set(verbs);
    this.isNoun = isNoun;
  }

  private nounBase(tok: string): string | null {
    if (this.isNoun(tok)) return tok;
    for (const b of this.lem.bases(tok)) if (b !== tok && this.isNoun(b)) return b;
    return null;
  }

  add(sentence: string): void {
    const toks = tokens(sentence);
    const seen = new Set<string>();
    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i];
      if (!tok) continue;
      this.words++;
      const noun = this.nounBase(tok);
      if (noun) this.nounCount.set(noun, (this.nounCount.get(noun) ?? 0) + 1);
      const verb = this.lem.bases(tok).find((b) => this.verbs.has(b));
      if (!verb) continue;
      this.verbCount.set(verb, (this.verbCount.get(verb) ?? 0) + 1);
      let j = i + 1;
      let det = '';
      const next = toks[j];
      if (!next) continue;
      if (ARTICLES.has(next)) det = next === 'an' ? 'a' : next;
      else if (POSSESSIVES.has(next)) det = 'poss';
      else if (OTHER_DETERMINERS.has(next)) det = 'other';
      if (det) j++;
      const n = toks[j];
      const nb = n ? this.nounBase(n) : null;
      // The noun must end the phrase: "take a photo" yes, "take a photo album" no.
      if (!nb || (toks[j + 1] && this.nounBase(toks[j + 1]!))) continue;
      const key = `${verb}|${nb}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const m = this.pairs.get(key) ?? new Map<string, number>();
      m.set(det, (m.get(det) ?? 0) + 1);
      this.pairs.set(key, m);
    }
  }
}

// ---------------------------------------------------------------------------
// ranking and levels
// ---------------------------------------------------------------------------

/** Occurrences per million words. */
const perMillion = (count: number, words: number) => (words > 0 ? (count * 1e6) / words : 0);

/** Zipf value from occurrences per million words (log10 of occurrences per billion). */
export function zipfOf(pm: number): number {
  if (pm <= 0) return 0;
  return Math.min(9, Math.max(0, Math.round(Math.log10(pm * 1000) * 100) / 100));
}

export interface PhraseRow {
  lemma_norm: string;
  pos: 'phrasal verb' | 'phrase';
  cefr: string;
  zipf: number;
  source: 'wiktionary' | 'corpus';
  corpus_count: number;
  source_version: string;
}

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

/** Level by rank in the frequency list: [last rank, level] steps. */
export const PHRASAL_BANDS: readonly [number, string][] = [
  [25, 'A1'],
  [90, 'A2'],
  [220, 'B1'],
  [360, 'B2'],
  [460, 'C1'],
];
export const COLLOCATION_BANDS: readonly [number, string][] = [
  [60, 'A2'],
  [160, 'B1'],
  [250, 'B2'],
];

/** The level of the rank-th phrase (1-based), never below its hardest word. */
export function levelFor(
  rank: number,
  bands: readonly [number, string][],
  floor: number | null,
): string {
  const band = bands.find(([last]) => rank <= last)?.[1] ?? 'C2';
  const r = Math.max(LEVELS.indexOf(band as (typeof LEVELS)[number]), floor ?? 0);
  return LEVELS[Math.min(r, 5)]!;
}

/** Corpora counted for one candidate: per-million rates averaged over the corpora. */
export interface CorpusTotals {
  counts: number[];
  words: number[];
}

const meanRate = (t: CorpusTotals) =>
  t.counts.reduce((s, c, k) => s + perMillion(c, t.words[k] ?? 0), 0) / Math.max(1, t.counts.length);

/**
 * The phrasal verbs to keep: seen at least `minCount` times in all corpora together, most
 * frequent first (average rate over the corpora, so a dialogue-heavy corpus does not decide
 * alone), the top `size`, each with a level.
 */
export function rankPhrasals(
  totals: ReadonlyMap<string, CorpusTotals>,
  levels: LevelIndex,
  opts: { size: number; minCount: number; version: string },
): PhraseRow[] {
  return [...totals]
    .filter(([, t]) => t.counts.reduce((a, b) => a + b, 0) >= opts.minCount)
    .sort((a, b) => meanRate(b[1]) - meanRate(a[1]) || a[0].localeCompare(b[0]))
    .slice(0, opts.size)
    .map(([lemma, t], k) => ({
      lemma_norm: lemma,
      pos: 'phrasal verb' as const,
      cefr: levelFor(k + 1, PHRASAL_BANDS, levels.get(lemma.split(' ')[0]!)?.rank ?? null),
      zipf: zipfOf(meanRate(t)),
      source: 'wiktionary' as const,
      corpus_count: t.counts.reduce((a, b) => a + b, 0),
      source_version: opts.version,
    }));
}

export interface CollocationStat {
  verb: string;
  noun: string;
  /** Per corpus: how often the pair was seen. */
  totals: CorpusTotals;
  /** Determiner seen most often ('' = none). */
  det: string;
  /** log-Dice association (14 at most): how much the two words belong together. */
  logDice: number;
}

/**
 * Collocation statistics merged over the corpora: the pair counts, the most common article
 * (pairs mostly seen with a possessive or another determiner are left out: "brush my teeth"
 * has no neutral headword) and the log-Dice association of verb and noun.
 */
export function collocationStats(counters: readonly CollocationCounter[]): CollocationStat[] {
  const keys = new Set(counters.flatMap((c) => [...c.pairs.keys()]));
  const out: CollocationStat[] = [];
  for (const key of keys) {
    const [verb, noun] = key.split('|') as [string, string];
    const dets = new Map<string, number>();
    let fxy = 0;
    let fx = 0;
    let fy = 0;
    const counts: number[] = [];
    for (const c of counters) {
      let n = 0;
      for (const [d, k] of c.pairs.get(key) ?? []) {
        dets.set(d, (dets.get(d) ?? 0) + k);
        n += k;
      }
      counts.push(n);
      fxy += n;
      fx += c.verbCount.get(verb) ?? 0;
      fy += c.nounCount.get(noun) ?? 0;
    }
    const det = [...dets].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '';
    if (det === 'poss' || det === 'other') continue;
    const logDice = fx + fy > 0 ? 14 + Math.log2((2 * fxy) / (fx + fy)) : 0;
    out.push({ verb, noun, totals: { counts, words: counters.map((c) => c.words) }, det, logDice });
  }
  return out;
}

/**
 * The collocations to keep: often enough (minCount), strongly associated (minLogDice), not a
 * phrasal verb or an entry the lists already have, most frequent first, the top `size`.
 */
export function rankCollocations(
  stats: readonly CollocationStat[],
  levels: LevelIndex,
  opts: { size: number; minCount: number; minLogDice: number; version: string; exclude: ReadonlySet<string> },
): PhraseRow[] {
  return stats
    .map((s) => ({ s, lemma: [s.verb, s.det, s.noun].filter(Boolean).join(' ') }))
    .filter(
      ({ s, lemma }) =>
        s.totals.counts.reduce((a, b) => a + b, 0) >= opts.minCount &&
        s.logDice >= opts.minLogDice &&
        !PARTICLES.has(s.noun) &&
        !opts.exclude.has(lemma) &&
        !opts.exclude.has(`${s.verb} ${s.noun}`),
    )
    .sort((a, b) => meanRate(b.s.totals) - meanRate(a.s.totals) || a.lemma.localeCompare(b.lemma))
    .slice(0, opts.size)
    .map(({ s, lemma }, k) => {
      const floor = Math.max(levels.get(s.verb)?.rank ?? 0, levels.get(s.noun)?.rank ?? 0);
      return {
        lemma_norm: lemma,
        pos: 'phrase' as const,
        cefr: levelFor(k + 1, COLLOCATION_BANDS, floor),
        zipf: zipfOf(meanRate(s.totals)),
        source: 'corpus' as const,
        corpus_count: s.totals.counts.reduce((a, b) => a + b, 0),
        source_version: opts.version,
      };
    });
}

/** Lemmas of the level file that have an entry of this part of speech (n, v, j…). */
export function posPredicate(levelFile: string, code: string): (w: string) => boolean {
  const set = new Set<string>();
  for (const line of levelFile.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [lemma, , entries] = line.split('\t');
    if (lemma && entries?.split('|').some((e) => e.startsWith(`${code}:`))) set.add(lemma);
  }
  return (w) => set.has(w);
}
