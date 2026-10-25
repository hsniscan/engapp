// Suggested decks ("Keşfet", redesign): ready-made word sets cut from the word bank the device
// already downloaded (public.word_bank, decision 0038). Nothing here is a hard-coded word list:
// a deck is a rule (level, part of speech, frequency rank, the false-friend table) applied to the
// bank rows. Pure: the data layer passes in the rows and what the user already has.
import { CEFR, levelRank } from './level';
import { normalizeTerm } from './normalize';
import type { WordStage } from './stages';
import type { CefrLevel } from './types';
import { byFrequency, type WordBankEntry } from './wordBank';

/** The parts of speech with their own decks: content words only. */
export const CONTENT_POS = ['verb', 'adjective', 'noun', 'adverb'] as const;
export type ContentPos = (typeof CONTENT_POS)[number];

/** "En çok kullanılanlar": the N most frequent content words. */
export const TOP_SIZES = [100, 500, 1000, 2000, 3000] as const;
export type TopSize = (typeof TOP_SIZES)[number];

export type SuggestedSpec =
  | { kind: 'top'; size: TopSize }
  | { kind: 'level'; level: CefrLevel }
  | { kind: 'pos'; pos: ContentPos }
  | { kind: 'levelPos'; level: CefrLevel; pos: ContentPos }
  | { kind: 'falseFriends' };

const isPos = (s: string): s is ContentPos => (CONTENT_POS as readonly string[]).includes(s);
const asLevel = (s: string): CefrLevel | null => {
  const up = s.toUpperCase();
  return (CEFR as readonly string[]).includes(up) ? (up as CefrLevel) : null;
};

/** URL key of a deck: top-500, level-b1, pos-verb, b1-verb, false-friends. */
export function suggestedKey(spec: SuggestedSpec): string {
  switch (spec.kind) {
    case 'top':
      return `top-${spec.size}`;
    case 'level':
      return `level-${spec.level.toLowerCase()}`;
    case 'pos':
      return `pos-${spec.pos}`;
    case 'levelPos':
      return `${spec.level.toLowerCase()}-${spec.pos}`;
    case 'falseFriends':
      return 'false-friends';
  }
}

/** The deck a URL key names, or null for an unknown key. */
export function parseSuggestedKey(raw: string): SuggestedSpec | null {
  const key = raw.trim().toLowerCase();
  if (key === 'false-friends') return { kind: 'falseFriends' };
  const [a = '', b = '', ...rest] = key.split('-');
  if (rest.length) return null;
  if (a === 'top') {
    const size = Number(b);
    return (TOP_SIZES as readonly number[]).includes(size)
      ? { kind: 'top', size: size as TopSize }
      : null;
  }
  if (a === 'level') {
    const level = asLevel(b);
    return level ? { kind: 'level', level } : null;
  }
  if (a === 'pos') return isPos(b) ? { kind: 'pos', pos: b } : null;
  const level = asLevel(a);
  return level && isPos(b) ? { kind: 'levelPos', level, pos: b } : null;
}

export interface DeckWordOptions {
  /** Lemmas of the false-friend table (normalised); needed for the 'falseFriends' deck. */
  falseFriends?: ReadonlySet<string>;
}

/** Parts of speech that make a word a function word ("in", "that", "all"), whatever else it is. */
const FUNCTION_POS: ReadonlySet<string> = new Set([
  'preposition',
  'conjunction',
  'pronoun',
  'determiner',
  'interjection',
]);
/** Auxiliary and modal verbs: listed as verbs, but grammar rather than vocabulary. */
export const AUXILIARIES: ReadonlySet<string> = new Set([
  'be',
  'have',
  'do',
  'can',
  'could',
  'will',
  'would',
  'shall',
  'should',
  'may',
  'might',
  'must',
]);

/**
 * Inflected and contracted forms the CEFR-J list carries as separate verbs ("is", "'re"): never
 * a card of their own in a suggested deck (the base word "be" is).
 */
export const AUXILIARY_FORMS: ReadonlySet<string> = new Set([
  'am',
  'is',
  'are',
  'was',
  'were',
  'been',
  'being',
  'has',
  'had',
  'having',
  'does',
  'did',
  'doing',
  "'m",
  "'re",
  "'s",
  "'ve",
  "'d",
  "'ll",
]);

/**
 * Lemmas that never count as content words for the frequency decks: any word the lists also
 * give a function-word reading (so "in" as an adverb does not top the list) and auxiliaries.
 */
export function functionLemmas(entries: readonly WordBankEntry[]): Set<string> {
  const out = new Set<string>(AUXILIARIES);
  for (const e of entries) if (FUNCTION_POS.has(e.pos)) out.add(e.lemma_norm);
  return out;
}

function matches(
  spec: SuggestedSpec,
  e: WordBankEntry,
  opts: DeckWordOptions,
  fn: ReadonlySet<string> | null,
): boolean {
  switch (spec.kind) {
    case 'top':
      return isPos(e.pos) && !fn?.has(e.lemma_norm);
    case 'level':
      return e.cefr === spec.level;
    case 'pos':
      return e.pos === spec.pos;
    case 'levelPos':
      return e.cefr === spec.level && e.pos === spec.pos;
    case 'falseFriends':
      return opts.falseFriends?.has(e.lemma_norm) ?? false;
  }
}

/**
 * The words of a deck, most frequent first, one row per word (a lemma listed as both noun and
 * verb counts once, under its more frequent row). A 'top' deck keeps its first N content words.
 */
export function deckWords(
  entries: readonly WordBankEntry[],
  spec: SuggestedSpec,
  opts: DeckWordOptions = {},
): WordBankEntry[] {
  const fn = spec.kind === 'top' ? functionLemmas(entries) : null;
  const seen = new Set<string>();
  const out: WordBankEntry[] = [];
  const kept = entries.filter((x) => !AUXILIARY_FORMS.has(x.lemma_norm) && matches(spec, x, opts, fn));
  for (const e of kept.sort(byFrequency)) {
    if (seen.has(e.lemma_norm)) continue;
    seen.add(e.lemma_norm);
    out.push(e);
  }
  return spec.kind === 'top' ? out.slice(0, spec.size) : out;
}

// ------------------------------------------------------------------ the user's side

/** What the user has, by normalised term: "Biliyorum" words and the stage of carded words. */
export interface OwnedIndex {
  known: ReadonlySet<string>;
  /** Live notes: the stage of the word's recognition card ('new' when it has none yet). */
  stage: ReadonlyMap<string, WordStage>;
}

/**
 * One word against the user's collection. A card beats "Biliyorum" (the word is being
 * studied). 'learned' = Öğrenildi or Kalıcı; 'studying' = a card at any earlier stage.
 */
export type DeckWordStatus = 'learned' | 'studying' | 'known' | 'new';

export function deckWordStatus(e: Pick<WordBankEntry, 'lemma_norm'>, idx: OwnedIndex): DeckWordStatus {
  const key = normalizeTerm(e.lemma_norm);
  const stage = idx.stage.get(key);
  if (stage !== undefined) return stage === 'learned' || stage === 'mastered' ? 'learned' : 'studying';
  return idx.known.has(key) ? 'known' : 'new';
}

export interface DeckProgress {
  total: number;
  learned: number;
  studying: number;
  known: number;
  /** Not in the collection and not known: what "Ekle" would add. */
  fresh: number;
}

export function deckProgress(words: readonly WordBankEntry[], idx: OwnedIndex): DeckProgress {
  const p: DeckProgress = { total: words.length, learned: 0, studying: 0, known: 0, fresh: 0 };
  for (const w of words) {
    const s = deckWordStatus(w, idx);
    if (s === 'new') p.fresh++;
    else p[s]++;
  }
  return p;
}

/** Share of the deck the user already knows (learned with cards or marked "Biliyorum"), 0..1. */
export function knownShare(p: DeckProgress): number {
  return p.total ? (p.learned + p.known) / p.total : 0;
}

/** The words "Ekle" adds: never one the user knows or already has a card for. */
export function wordsToAdd(words: readonly WordBankEntry[], idx: OwnedIndex): WordBankEntry[] {
  return words.filter((w) => deckWordStatus(w, idx) === 'new');
}

/** Words per CEFR level in a deck (levels with none are 0). */
export function levelSpread(words: readonly WordBankEntry[]): Record<CefrLevel, number> {
  const out = Object.fromEntries(CEFR.map((l) => [l, 0])) as Record<CefrLevel, number>;
  for (const w of words) out[w.cefr]++;
  return out;
}

/** Bank words per level for each content part of speech (the "Kelime türüne göre" bars). */
export function posLevelCounts(
  entries: readonly WordBankEntry[],
): Record<ContentPos, Record<CefrLevel, number>> {
  const zero = () => Object.fromEntries(CEFR.map((l) => [l, 0])) as Record<CefrLevel, number>;
  const out = {
    verb: zero(),
    adjective: zero(),
    noun: zero(),
    adverb: zero(),
  } satisfies Record<ContentPos, Record<CefrLevel, number>>;
  for (const e of entries) if (isPos(e.pos)) out[e.pos][e.cefr]++;
  return out;
}

// ------------------------------------------------------------------ what to suggest

/** A deck is "done" for suggestions when this share of it is known or in the collection. */
export const DONE_SHARE = 0.9;

function openShare(p: DeckProgress): number {
  return p.total ? p.fresh / p.total : 0;
}

/**
 * The highlighted deck for a learner at `level`: their level's verbs (they build sentences),
 * then adjectives, nouns, adverbs; then the same one level up. The first that still has more
 * than 1 - DONE_SHARE of its words open wins. Null when nothing at or one above the level is.
 */
export function featuredSpec(
  entries: readonly WordBankEntry[],
  idx: OwnedIndex,
  level: CefrLevel,
): SuggestedSpec | null {
  const x = levelRank(level);
  for (const r of [x, x + 1]) {
    const lv = CEFR[r];
    if (!lv) continue;
    for (const pos of CONTENT_POS) {
      const spec: SuggestedSpec = { kind: 'levelPos', level: lv, pos };
      const words = deckWords(entries, spec);
      if (words.length && openShare(deckProgress(words, idx)) > 1 - DONE_SHARE) return spec;
    }
  }
  return null;
}

/**
 * "Senin için": up to `n` level × part-of-speech decks around the learner's level (their level
 * first, then one above), skipping the featured one, empty decks and decks they mostly have.
 */
export function forYouSpecs(
  entries: readonly WordBankEntry[],
  idx: OwnedIndex,
  level: CefrLevel,
  exclude: SuggestedSpec | null,
  n = 2,
): { spec: SuggestedSpec; upLevel: boolean }[] {
  const x = levelRank(level);
  const skip = exclude ? suggestedKey(exclude) : '';
  const out: { spec: SuggestedSpec; upLevel: boolean }[] = [];
  // Alternate: one at the level, one above, so both show when there is room for two.
  const order: [number, ContentPos][] = [];
  for (const pos of CONTENT_POS) order.push([x, pos], [x + 1, pos]);
  const atLevel = order.filter(([r]) => r === x);
  const above = order.filter(([r]) => r === x + 1);
  const mixed: [number, ContentPos][] = [];
  for (let i = 0; i < CONTENT_POS.length; i++) mixed.push(atLevel[i]!, above[i]!);
  for (const [r, pos] of mixed) {
    if (out.length >= n) break;
    const lv = CEFR[r];
    if (!lv) continue;
    const spec: SuggestedSpec = { kind: 'levelPos', level: lv, pos };
    if (suggestedKey(spec) === skip) continue;
    const words = deckWords(entries, spec);
    if (!words.length || openShare(deckProgress(words, idx)) <= 1 - DONE_SHARE) continue;
    out.push({ spec, upLevel: r > x });
  }
  return out.sort((a, b) => Number(a.upLevel) - Number(b.upLevel));
}
