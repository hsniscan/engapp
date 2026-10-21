import { describe, expect, it } from 'vitest';
import { navAlsoActive, navItems } from './nav';

describe('navAlsoActive', () => {
  const cards = navItems.find((i) => i.to === '/library')!;
  it('marks "Kartlar" active on the deck pages', () => {
    expect(navAlsoActive(cards, '/decks')).toBe(true);
    expect(navAlsoActive(cards, '/decks/themes')).toBe(true);
    expect(navAlsoActive(cards, '/decksx')).toBe(false);
    expect(navItems.filter((i) => navAlsoActive(i, '/decks'))).toEqual([cards]);
  });
});
