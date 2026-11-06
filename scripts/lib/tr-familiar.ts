// "Tanıdık" words (v0.5.3 C5, decision 0073): English words a Turkish speaker already knows
// because Turkish has the same international word (microphone ↔ mikrofon, penicillin ↔
// penisilin, catalogue ↔ katalog). Pure logic; the CLI is scripts/build-tr-familiar.ts.
//
// How a candidate is found, deterministically:
//   1. the English lemma is spelled the Turkish way by a few loan-word rules (ph → f,
//      c → k / s, -tion → -syon, -cy → -si, -ure → -ür, -gue → -g, …), giving a handful of
//      spellings (u/ü and o/ö both tried, the final e kept or dropped);
//   2. a spelling that is a Turkish word in wordfreq's Turkish list (same pinned wheel as the
//      English data) is a match;
//   3. short words, words in the false-friends table and spellings that are also common
//      English words in Turkish text are left out, and every remaining match is read once by
//      a person (or a model) and either kept or written to the review file with a reason
//      (data/levels/tr-familiar-review.tsv), so a rebuild gives the same list.
//
// Effect: the word's level for Turkish learners is one step easier than its list level
// (stored like a level-tr-v1 correction, reason "tanidik:<Turkish word>"), never below A1.

import { CEFR, type Cefr } from '../../supabase/functions/_shared/cefr.ts';

/** Reason prefix of a familiar-word correction (client file and ref_word_levels.tr_reason). */
export const FAMILIAR_REASON_PREFIX = 'tanidik:';
/** Prompt-version-like tag stored with the server correction. */
export const FAMILIAR_VERSION = 'tr-familiar-v1';

/** Shortest English lemma considered (shorter ones match Turkish words by chance). */
export const MIN_LEMMA_LENGTH = 5;
/** Least Turkish Zipf of the match: the word must be common enough that people know it. */
export const MIN_TR_ZIPF = 2.5;
/** Shortest Turkish match (shorter ones are mostly chance look-alikes: kas, kek, şut). */
export const MIN_TR_LENGTH = 4;
/**
 * A match spelled exactly like the English word may be English text inside Turkish pages
 * (season, forest): kept only when it is about as common in Turkish as in English.
 */
export const SAME_SPELLING_MAX_GAP = 0.66;
/** Only list levels from here up are lowered (an A1 word cannot get easier). */
export const MIN_LIST_LEVEL: Cefr = 'A2';

// Endings, longest first: the first that fits is replaced (alternatives are all tried).
const SUFFIXES: readonly [string, readonly string[]][] = [
  ['ization', ['izasyon']],
  ['isation', ['izasyon']],
  ['ssion', ['syon']],
  ['ation', ['asyon']],
  ['ition', ['isyon']],
  ['ution', ['üsyon', 'usyon']],
  ['ction', ['ksiyon', 'ksiyon']],
  ['tion', ['syon', 'siyon']],
  ['sion', ['zyon', 'syon']],
  ['graphy', ['grafi']],
  ['logy', ['loji']],
  ['logue', ['log']],
  ['gue', ['g']],
  ['phy', ['fi']],
  ['ism', ['izm', 'izma']],
  ['ical', ['ik']],
  ['ics', ['ik']],
  ['ic', ['ik']],
  ['ity', ['ite']],
  ['ty', ['te']],
  ['cy', ['si']],
  ['gy', ['ji']],
  ['ure', ['ür', 'ur']],
  ['ive', ['if']],
  ['ine', ['in', 'ina']],
  ['ette', ['et']],
  ['ia', ['i', 'ya']],
  ['or', ['ör', 'or']],
  ['er', ['er', 'ör']],
  ['um', ['um']],
  ['e', ['', 'e']],
  ['y', ['i']],
];

/** Letter groups, in order (applied left to right on the stem). */
function letters(stem: string): string {
  let s = stem;
  s = s.replace(/eau/g, 'o');
  s = s.replace(/ph/g, 'f');
  s = s.replace(/th/g, 't');
  s = s.replace(/sch/g, 'ş');
  s = s.replace(/sh/g, 'ş');
  s = s.replace(/ch/g, 'k');
  s = s.replace(/ck/g, 'k');
  s = s.replace(/qu/g, 'kv');
  s = s.replace(/x/g, 'ks');
  s = s.replace(/w/g, 'v');
  s = s.replace(/c(?=[eiy])/g, 's');
  s = s.replace(/c/g, 'k');
  s = s.replace(/g(?=[eiy])/g, 'j');
  s = s.replace(/oo/g, 'u');
  s = s.replace(/ee/g, 'i');
  s = s.replace(/ou/g, 'u');
  s = s.replace(/au/g, 'o');
  s = s.replace(/ai/g, 'ey');
  // y between consonants or at the end is a vowel (i).
  s = s.replace(/(?<=[^aeıioöuü])y(?=[^aeıioöuü]|$)/g, 'i');
  // Double letters are single in Turkish.
  s = s.replace(/([a-zçğışöü])\1/g, '$1');
  return s;
}

/** u → ü and o → ö variants (Turkish loan words often front them), at most 8. */
function frontVowels(s: string): string[] {
  const idx = [...s].map((c, i) => (c === 'u' || c === 'o' ? i : -1)).filter((i) => i >= 0).slice(0, 3);
  const out = new Set<string>([s]);
  for (let mask = 1; mask < 1 << idx.length; mask++) {
    const chars = [...s];
    idx.forEach((pos, bit) => {
      if (mask & (1 << bit)) chars[pos] = chars[pos] === 'u' ? 'ü' : 'ö';
    });
    out.add(chars.join(''));
  }
  return [...out];
}

/**
 * Turkish spellings an English loan word may have, most likely first. Empty for anything that
 * is not a plain lower-case a–z word.
 */
export function turkishSpellings(lemma: string): string[] {
  if (!/^[a-z]+$/.test(lemma)) return [];
  const bases: string[] = [];
  const hit = SUFFIXES.find(([suf]) => lemma.endsWith(suf) && lemma.length > suf.length + 1);
  if (hit) {
    const stem = lemma.slice(0, -hit[0].length);
    for (const rep of hit[1]) bases.push(letters(stem) + rep);
  }
  bases.push(letters(lemma));
  const out = new Set<string>();
  for (const b of bases) for (const v of frontVowels(b.replace(/([a-zçğışöü])\1/g, '$1'))) out.add(v);
  return [...out].filter((s) => s.length >= 3);
}

export interface ListEntry {
  lemma_norm: string;
  pos: string;
  cefr: Cefr;
  source: 'cefrj' | 'octanove';
}

export interface FamiliarMatch {
  lemma_norm: string;
  pos: string;
  source: 'cefrj' | 'octanove';
  /** The list level. */
  cefr: Cefr;
  /** One step easier. */
  cefr_tr: Cefr;
  /** The Turkish word it matches. */
  tr: string;
  tr_zipf: number;
}

export const easierLevel = (c: Cefr): Cefr => CEFR[Math.max(0, CEFR.indexOf(c) - 1)]!;

export interface FindOptions {
  /** Turkish word → Zipf (wordfreq small_tr). */
  turkish: ReadonlyMap<string, number>;
  /** English word → Zipf (wordfreq large_en), for matches spelled like the English word. */
  english: ReadonlyMap<string, number>;
  /** English lemmas of the false-friends table: never familiar. */
  falseFriends: ReadonlySet<string>;
}

/**
 * The familiar-word candidates of the word list: one per (lemma, pos, source) entry from A2 up
 * whose Turkish spelling is a common Turkish word. Stable order (lemma, pos, source).
 */
export function findFamiliar(list: readonly ListEntry[], opts: FindOptions): FamiliarMatch[] {
  const out: FamiliarMatch[] = [];
  const minRank = CEFR.indexOf(MIN_LIST_LEVEL);
  for (const e of list) {
    if (CEFR.indexOf(e.cefr) < minRank) continue;
    if (e.lemma_norm.length < MIN_LEMMA_LENGTH || opts.falseFriends.has(e.lemma_norm)) continue;
    let best: { tr: string; zipf: number } | null = null;
    for (const s of turkishSpellings(e.lemma_norm)) {
      const z = opts.turkish.get(s);
      if (z === undefined || z < MIN_TR_ZIPF || s.length < MIN_TR_LENGTH) continue;
      // The same spelling as the English word: maybe only English text inside Turkish pages.
      if (s === e.lemma_norm && z < (opts.english.get(e.lemma_norm) ?? 0) - SAME_SPELLING_MAX_GAP) continue;
      best = { tr: s, zipf: z };
      break;
    }
    if (!best) continue;
    out.push({
      lemma_norm: e.lemma_norm,
      pos: e.pos,
      source: e.source,
      cefr: e.cefr,
      cefr_tr: easierLevel(e.cefr),
      tr: best.tr,
      tr_zipf: best.zipf,
    });
  }
  return out.sort(
    (a, b) => cmp(a.lemma_norm, b.lemma_norm) || cmp(a.pos, b.pos) || cmp(a.source, b.source),
  );
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The review file (data/levels/tr-familiar-review.tsv): one line per reviewed candidate,
 * "lemma \t pos (or *) \t note". A note that starts with "=" keeps the word and names its
 * Turkish spelling ("police \t * \t =polis" when the match was an inflected form); any other
 * note rejects the candidate and says why (a chance look-alike, a false friend, …). A line
 * for one part of speech wins over a "*" line.
 */
export function parseReview(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [lemma, pos, ...reason] = line.split('\t');
    if (!lemma) continue;
    out.set(`${lemma}\t${pos || '*'}`, reason.join(' ').trim());
  }
  return out;
}

const noteOf = (review: ReadonlyMap<string, string>, m: Pick<FamiliarMatch, 'lemma_norm' | 'pos'>) =>
  review.get(`${m.lemma_norm}\t${m.pos}`) ?? review.get(`${m.lemma_norm}\t*`);

export function isRejected(review: ReadonlyMap<string, string>, m: Pick<FamiliarMatch, 'lemma_norm' | 'pos'>): boolean {
  const note = noteOf(review, m);
  return note !== undefined && !note.startsWith('=');
}

/** The candidates the review keeps, with the Turkish spelling it names. */
export function applyReview(
  candidates: readonly FamiliarMatch[],
  review: ReadonlyMap<string, string>,
): FamiliarMatch[] {
  const out: FamiliarMatch[] = [];
  for (const c of candidates) {
    const note = noteOf(review, c);
    if (note === undefined) out.push(c);
    else if (note.startsWith('=') && note.length > 1) out.push({ ...c, tr: note.slice(1).trim() });
  }
  return out;
}

/** Header + rows of data/levels/tr-familiar.tsv. */
export function familiarTsv(rows: readonly FamiliarMatch[]): string {
  return (
    [
      '# Familiar international words for Turkish speakers (decision 0073), built by',
      '# `node scripts/build-tr-familiar.ts` from the word lists and wordfreq 3.1.1 (English and',
      '# Turkish; CC BY-SA 4.0), after review (tr-familiar-review.tsv). CC BY-SA 4.0.',
      '# Columns: lemma_norm, pos, source, list cefr, cefr for Turkish learners, Turkish word',
      ...rows.map((r) => [r.lemma_norm, r.pos, r.source, r.cefr, r.cefr_tr, r.tr].join('\t')),
    ].join('\n') + '\n'
  );
}

export interface FamiliarRow {
  lemma_norm: string;
  pos: string;
  source: string;
  cefr: Cefr;
  cefr_tr: Cefr;
  tr: string;
}

export function parseFamiliarTsv(text: string): FamiliarRow[] {
  return text
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [lemma_norm, pos, source, cefr, cefr_tr, tr] = l.split('\t');
      return { lemma_norm: lemma_norm!, pos: pos!, source: source!, cefr: cefr as Cefr, cefr_tr: cefr_tr as Cefr, tr: tr! };
    });
}

const sql = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * The migration that stores the familiar words as Turkish-learner corrections on the server
 * (ref_word_levels.tr_*), so signed-in users, the word bank's level and the nightly level job
 * agree with the client file. It never makes a word harder: an existing correction that is
 * already as easy is kept; one made for another list level, or a harder one, is replaced.
 */
export function familiarMigration(rows: readonly FamiliarRow[]): string {
  const values = rows
    .map((r) => `  (${sql(r.lemma_norm)}, ${sql(r.pos)}, ${sql(r.source)}, '${r.cefr}', '${r.cefr_tr}', ${sql(FAMILIAR_REASON_PREFIX + r.tr)})`)
    .join(',\n');
  return `-- GENERATED by scripts/build-tr-familiar.ts (decision 0073). Do not edit by hand.
-- Familiar international words for Turkish speakers (microphone ↔ mikrofon): the list level
-- moves one step easier, stored like a level-tr-v1 correction with the reason
-- '${FAMILIAR_REASON_PREFIX}<Turkish word>' and tr_prompt_version '${FAMILIAR_VERSION}'. Data: data/levels/tr-familiar.tsv
-- (CC BY-SA 4.0, derived from the word lists and wordfreq). The nightly level job's first,
-- deterministic step re-resolves the lexicon senses with it. Idempotent.

update public.ref_word_levels r
   set tr_cefr = v.cefr_tr,
       tr_reason = v.reason,
       tr_base_cefr = r.cefr,
       tr_checked_at = coalesce(r.tr_checked_at, now()),
       tr_prompt_version = '${FAMILIAR_VERSION}'
  from (values
${values}
  ) as v (lemma_norm, pos, source, cefr, cefr_tr, reason)
 where r.lemma_norm = v.lemma_norm and r.pos = v.pos and r.source = v.source and r.cefr = v.cefr
   and (r.tr_cefr is null
        or r.tr_base_cefr is distinct from r.cefr
        or public.cefr_rank(r.tr_cefr) > public.cefr_rank(v.cefr_tr));
`;
}
