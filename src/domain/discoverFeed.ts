// Keşfet's feed (v0.5.1, ADR 0057): what the page shows and in which order. Pure: no React,
// Dexie or network. The page builds one entry per thing it can show today (a text to continue,
// suggested texts, a deck, the word of the day, …); this module filters them by the chosen
// chip and orders them: what the user was doing first, then a daily mix that changes from day
// to day but stays put within a day, then the browsing shelves.
//
// Entries carry only what ordering needs (kind, key, category, slot, weight); the page keeps
// each kind's own data on the same object (arrangeFeed is generic), so a new kind such as
// "Paylaşılanlar" (texts and decks other learners share) is one more kind with a category.

/** A filter chip's group. */
export type FeedCategory = 'okuma' | 'desteler' | 'kelimeler';
/** The chips: Hepsi · Okuma · Desteler · Kelimeler. */
export type FeedFilter = 'hepsi' | FeedCategory;
export const FEED_FILTERS = ['hepsi', 'okuma', 'desteler', 'kelimeler'] as const satisfies readonly FeedFilter[];

/** ?f=… → filter; anything else is "Hepsi". */
export function parseFeedFilter(raw: string | null | undefined): FeedFilter {
  return (FEED_FILTERS as readonly string[]).includes(raw ?? '') ? (raw as FeedFilter) : 'hepsi';
}

export type FeedKind =
  /** The text left unfinished ("Devam et"). */
  | 'continue'
  /** Bugünün hikâyesi. */
  | 'story'
  /** Graded library texts that fit the user ("Sana uygun metinler"). */
  | 'textSuggestions'
  /** Invitation to "Kelimelerimle metin oluştur". */
  | 'createText'
  /** Newest graded library texts. */
  | 'newTexts'
  /** The user's own texts (Metinlerim). */
  | 'myTexts'
  /** The featured suggested deck for the user's level. */
  | 'featuredDeck'
  /** "Senin için" suggested decks. */
  | 'forYouDecks'
  /** Decks by level and by part of speech. */
  | 'deckShelf'
  /** Günün kelimesi: a word-bank word at the user's level they do not have yet. */
  | 'wordOfDay'
  /** Günün yanıltıcı benzeri. */
  | 'falseFriendOfDay'
  /** A few more new words at the user's level. */
  | 'wordsAtLevel'
  /** Reserved: something another learner shared (its category says what it is). */
  | 'shared';

/**
 * Where an entry sits: `lead` items open the feed in the order given (what the user was in
 * the middle of), `daily` items are mixed per day, `tail` items close it (browsing shelves).
 */
export type FeedSlot = 'lead' | 'daily' | 'tail';

export interface FeedEntry {
  kind: FeedKind;
  /** Unique within the feed and stable across days (also the React key). */
  key: string;
  category: FeedCategory;
  slot: FeedSlot;
  /** Higher comes earlier among `daily` entries; equal weights are shuffled per day. */
  weight: number;
}

/** The category, slot and weight each kind has unless an entry says otherwise. */
export const KIND_DEFAULTS: Record<Exclude<FeedKind, 'shared'>, Omit<FeedEntry, 'kind' | 'key'>> = {
  continue: { category: 'okuma', slot: 'lead', weight: 0 },
  story: { category: 'okuma', slot: 'daily', weight: 3 },
  textSuggestions: { category: 'okuma', slot: 'daily', weight: 3 },
  featuredDeck: { category: 'desteler', slot: 'daily', weight: 2 },
  wordOfDay: { category: 'kelimeler', slot: 'daily', weight: 2 },
  createText: { category: 'okuma', slot: 'daily', weight: 2 },
  falseFriendOfDay: { category: 'kelimeler', slot: 'daily', weight: 1 },
  forYouDecks: { category: 'desteler', slot: 'daily', weight: 1 },
  newTexts: { category: 'okuma', slot: 'daily', weight: 1 },
  wordsAtLevel: { category: 'kelimeler', slot: 'daily', weight: 0 },
  myTexts: { category: 'okuma', slot: 'tail', weight: 0 },
  deckShelf: { category: 'desteler', slot: 'tail', weight: 0 },
};

/** An entry of a built-in kind with its defaults (the page adds its own data with spread). */
export function feedEntry<K extends Exclude<FeedKind, 'shared'>>(kind: K, key: string = kind): FeedEntry & { kind: K } {
  return { kind, key, ...KIND_DEFAULTS[kind] };
}

/**
 * Kinds a filter's full list already shows below the feed (Okuma: Metinlerim and the whole
 * library with its own "Sana uygun"; Desteler: every suggested deck), so the filtered feed
 * does not repeat them.
 */
export const COVERED_BY_FULL_LIST: Record<FeedCategory, readonly FeedKind[]> = {
  okuma: ['textSuggestions', 'myTexts', 'newTexts'],
  desteler: ['featuredDeck', 'forYouDecks', 'deckShelf'],
  kelimeler: [],
};

/** FNV-1a, 32 bit: a small stable hash for per-day variety (not for security). */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** One item of `list` for the day (the same all day, usually another tomorrow); undefined when empty. */
export function dailyPick<T>(list: readonly T[], day: string, salt: string): T | undefined {
  if (list.length === 0) return undefined;
  return list[hash32(`${day}|${salt}`) % list.length];
}

/**
 * Up to `n` items of `list` from the day's position onwards that `ok` accepts (wrapping), so
 * a pick moves on to the next one once the user has taken it, without reshuffling.
 */
export function dailyPicksWhere<T>(
  list: readonly T[],
  day: string,
  salt: string,
  ok: (item: T) => boolean,
  n: number,
): T[] {
  const out: T[] = [];
  if (list.length === 0 || n <= 0) return out;
  const start = hash32(`${day}|${salt}`) % list.length;
  for (let i = 0; i < list.length && out.length < n; i++) {
    const item = list[(start + i) % list.length]!;
    if (ok(item)) out.push(item);
  }
  return out;
}

/** The first of dailyPicksWhere: one item for the day that `ok` accepts. */
export function dailyPickWhere<T>(
  list: readonly T[],
  day: string,
  salt: string,
  ok: (item: T) => boolean,
): T | undefined {
  return dailyPicksWhere(list, day, salt, ok, 1)[0];
}

/**
 * Reorders `items` so that two neighbours share a category only when nothing else is left
 * (greedy: the first remaining item of another category than the previous one).
 */
export function spreadCategories<T extends Pick<FeedEntry, 'category'>>(items: readonly T[]): T[] {
  const rest = [...items];
  const out: T[] = [];
  while (rest.length > 0) {
    const prev = out[out.length - 1]?.category;
    let i = rest.findIndex((x) => x.category !== prev);
    if (i < 0) i = 0;
    out.push(rest.splice(i, 1)[0]!);
  }
  return out;
}

export interface ArrangeOptions {
  filter: FeedFilter;
  /** The user's day (domain/day.ts DayKey): the daily mix changes with it. */
  day: string;
  /** Leave out kinds a filtered page shows in full below the feed (COVERED_BY_FULL_LIST). */
  dropCovered?: boolean;
}

/**
 * The feed for a filter: `lead` entries (in the order given), then `daily` entries (by weight,
 * shuffled per day within a weight, neighbours of different categories on "Hepsi"), then
 * `tail` entries (in the order given). Duplicate keys keep the first entry.
 */
export function arrangeFeed<T extends FeedEntry>(items: readonly T[], opts: ArrangeOptions): T[] {
  const seen = new Set<string>();
  const covered = opts.filter !== 'hepsi' && opts.dropCovered ? COVERED_BY_FULL_LIST[opts.filter] : [];
  const pool = items.filter((x) => {
    if (seen.has(x.key)) return false;
    seen.add(x.key);
    if (opts.filter !== 'hepsi' && x.category !== opts.filter) return false;
    return !covered.includes(x.kind);
  });
  const lead = pool.filter((x) => x.slot === 'lead');
  const tail = pool.filter((x) => x.slot === 'tail');
  const shuffle = (x: T) => hash32(`${opts.day}|${x.key}`);
  const daily = pool
    .filter((x) => x.slot === 'daily')
    .sort((a, b) => b.weight - a.weight || shuffle(a) - shuffle(b) || a.key.localeCompare(b.key));
  const mixed = opts.filter === 'hepsi' ? spreadCategories(daily) : daily;
  return [...lead, ...mixed, ...tail];
}
