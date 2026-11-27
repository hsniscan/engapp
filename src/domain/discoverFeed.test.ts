import { describe, expect, it } from 'vitest';
import {
  arrangeFeed,
  dailyPick,
  dailyPickWhere,
  dailyPicksWhere,
  dailySpreadPicks,
  type FeedEntry,
  feedEntry,
  hash32,
  parseFeedFilter,
  spreadCategories,
} from './discoverFeed';

const ALL: FeedEntry[] = [
  feedEntry('myTexts'),
  feedEntry('deckShelf'),
  feedEntry('wordOfDay'),
  feedEntry('featuredDeck'),
  feedEntry('textSuggestions'),
  feedEntry('story'),
  feedEntry('createText'),
  feedEntry('falseFriendOfDay'),
  feedEntry('forYouDecks'),
  feedEntry('newTexts'),
  feedEntry('wordsAtLevel'),
  feedEntry('continue'),
];
const kinds = (xs: readonly FeedEntry[]) => xs.map((x) => x.kind);
const days = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);

describe('Keşfet filters', () => {
  it('reads ?f= and falls back to Hepsi', () => {
    expect(parseFeedFilter('okuma')).toBe('okuma');
    expect(parseFeedFilter('desteler')).toBe('desteler');
    expect(parseFeedFilter('kelimeler')).toBe('kelimeler');
    expect(parseFeedFilter('hepsi')).toBe('hepsi');
    expect(parseFeedFilter('x')).toBe('hepsi');
    expect(parseFeedFilter(null)).toBe('hepsi');
  });

  it('keeps only the chosen category', () => {
    const okuma = arrangeFeed(ALL, { filter: 'okuma', day: days[0]! });
    expect(new Set(okuma.map((x) => x.category))).toEqual(new Set(['okuma']));
    expect(okuma).toHaveLength(6);
    const words = arrangeFeed(ALL, { filter: 'kelimeler', day: days[0]! });
    expect(kinds(words).sort()).toEqual(['falseFriendOfDay', 'wordOfDay', 'wordsAtLevel']);
  });

  it('leaves out what the filter’s full list shows anyway', () => {
    const okuma = arrangeFeed(ALL, { filter: 'okuma', day: days[0]!, dropCovered: true });
    expect(kinds(okuma)).toEqual(['continue', 'story', 'createText']);
    expect(arrangeFeed(ALL, { filter: 'desteler', day: days[0]!, dropCovered: true })).toEqual([]);
    // "Hepsi" has no full list: nothing is dropped.
    expect(arrangeFeed(ALL, { filter: 'hepsi', day: days[0]!, dropCovered: true })).toHaveLength(ALL.length);
  });
});

describe('Keşfet order', () => {
  it('opens with what the user was doing and closes with the shelves', () => {
    for (const day of days) {
      const feed = arrangeFeed(ALL, { filter: 'hepsi', day });
      expect(feed).toHaveLength(ALL.length);
      expect(feed[0]!.kind).toBe('continue');
      expect(kinds(feed.slice(-2))).toEqual(['myTexts', 'deckShelf']);
    }
  });

  it('is the same all day and changes from day to day', () => {
    // The daily mix does not depend on the order the page built the entries in.
    const daily = (xs: FeedEntry[]) =>
      kinds(arrangeFeed(xs, { filter: 'hepsi', day: days[0]! }).filter((x) => x.slot === 'daily'));
    expect(daily([...ALL].reverse())).toEqual(daily(ALL));
    expect(kinds(arrangeFeed(ALL, { filter: 'hepsi', day: days[0]! }))).toEqual(
      kinds(arrangeFeed(ALL, { filter: 'hepsi', day: days[0]! })),
    );
    const orders = new Set(days.map((day) => kinds(arrangeFeed(ALL, { filter: 'hepsi', day })).join()));
    expect(orders.size).toBeGreaterThan(3);
  });

  it('puts higher weights first in the daily mix', () => {
    for (const day of days) {
      const daily = arrangeFeed(ALL, { filter: 'okuma', day }).filter((x) => x.slot === 'daily');
      // story and textSuggestions (3) before createText (2) before newTexts (1).
      expect(kinds(daily).slice(2)).toEqual(['createText', 'newTexts']);
    }
  });

  it('does not put two cards of one category side by side when it can avoid it', () => {
    for (const day of days) {
      const daily = arrangeFeed(ALL, { filter: 'hepsi', day }).filter((x) => x.slot === 'daily');
      let same = 0;
      for (let i = 1; i < daily.length; i++) if (daily[i]!.category === daily[i - 1]!.category) same++;
      // 4 okuma, 2 desteler, 3 kelimeler daily cards: at most one unavoidable pair.
      expect(same).toBeLessThanOrEqual(1);
    }
  });

  it('drops duplicate keys and takes shared items like any other card', () => {
    const shared: FeedEntry & { by: string } = {
      kind: 'shared',
      key: 'shared:abc',
      category: 'okuma',
      slot: 'daily',
      weight: 2,
      by: 'Ayşe',
    };
    const feed = arrangeFeed([...ALL, feedEntry('story'), shared], { filter: 'okuma', day: days[3]! });
    expect(feed.filter((x) => x.kind === 'story')).toHaveLength(1);
    const found = feed.find((x) => x.kind === 'shared');
    expect(found).toBe(shared);
    expect(found && 'by' in found ? found.by : null).toBe('Ayşe');
  });

  it('spreads categories greedily', () => {
    const c = (category: FeedEntry['category']) => ({ category });
    expect(spreadCategories([c('okuma'), c('okuma'), c('desteler'), c('kelimeler')]).map((x) => x.category)).toEqual([
      'okuma',
      'desteler',
      'okuma',
      'kelimeler',
    ]);
    expect(spreadCategories([])).toEqual([]);
  });
});

describe('picks of the day', () => {
  const words = ['apple', 'borrow', 'cheap', 'decide', 'eager', 'faint'];

  it('picks one item per day, the same all day', () => {
    for (const day of days) {
      const p = dailyPick(words, day, 'word');
      expect(words).toContain(p);
      expect(dailyPick(words, day, 'word')).toBe(p);
    }
    expect(new Set(days.map((d) => dailyPick(words, d, 'word'))).size).toBeGreaterThan(2);
    expect(dailyPick([], days[0]!, 'word')).toBeUndefined();
  });

  it('moves on to the next acceptable item without reshuffling', () => {
    const day = days[5]!;
    const first = dailyPickWhere(words, day, 'w', () => true)!;
    const next = dailyPickWhere(words, day, 'w', (w) => w !== first)!;
    const i = words.indexOf(first);
    expect(next).toBe(words[(i + 1) % words.length]);
    expect(dailyPickWhere(words, day, 'w', () => false)).toBeUndefined();
  });

  it('gives the next few acceptable items in the same order', () => {
    const day = days[7]!;
    const run = dailyPicksWhere(words, day, 'w', () => true, 3);
    expect(run).toHaveLength(3);
    expect(run[0]).toBe(dailyPickWhere(words, day, 'w', () => true));
    expect(new Set(run).size).toBe(3);
    expect(dailyPicksWhere(words, day, 'w', () => true, 99)).toHaveLength(words.length);
    expect(dailyPicksWhere(words, day, 'w', () => true, 0)).toEqual([]);
  });

  it('hashes stably (spread picks below)', () => {
    expect(hash32('')).toBe(0x811c9dc5);
    expect(hash32('a')).toBe(hash32('a'));
    expect(hash32('a')).not.toBe(hash32('b'));
  });
});

describe('spread daily picks', () => {
  // 200 words, most frequent first; the old code took six neighbours of this list.
  const list = Array.from({ length: 200 }, (_, i) => `w${String(i).padStart(3, '0')}`);
  const key = (w: string) => w;
  const yes = () => true;

  it('is stable within a day and changes across days', () => {
    const a = dailySpreadPicks(list, days[0]!, 'word', yes, 6, key);
    expect(a).toHaveLength(6);
    expect(new Set(a).size).toBe(6);
    expect(dailySpreadPicks(list, days[0]!, 'word', yes, 6, key)).toEqual(a);
    const firsts = new Set(days.map((d) => dailySpreadPicks(list, d, 'word', yes, 6, key)[0]));
    expect(firsts.size).toBeGreaterThan(10);
  });

  it('does not pick a run of neighbours and prefers the frequent part', () => {
    for (const day of days) {
      const idx = dailySpreadPicks(list, day, 'word', yes, 6, key)
        .map((w) => list.indexOf(w))
        .sort((x, y) => x - y);
      // From the first quarter (the most frequent words) only.
      expect(idx.every((i) => i < 50)).toBe(true);
      // Not six consecutive positions.
      expect(idx[5]! - idx[0]!).toBeGreaterThan(5);
    }
  });

  it('skips what ok refuses, and taking one keeps the others', () => {
    const day = days[3]!;
    const before = dailySpreadPicks(list, day, 'word', yes, 6, key);
    const taken = before[0]!;
    const after = dailySpreadPicks(list, day, 'word', (w) => w !== taken, 6, key);
    expect(after).not.toContain(taken);
    expect(after.slice(0, 5)).toEqual(before.slice(1));
    expect(dailySpreadPicks(list, day, 'word', () => false, 6, key)).toEqual([]);
    expect(dailySpreadPicks(list, day, 'word', yes, 0, key)).toEqual([]);
    expect(dailySpreadPicks(list.slice(0, 3), day, 'word', yes, 6, key)).toHaveLength(3);
  });
});
