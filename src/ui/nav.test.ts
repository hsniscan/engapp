import { describe, expect, it } from 'vitest';
import { isNavActive, navAlsoActive, navItems, type NavLinkItem } from './nav';

const links = navItems.filter((i): i is NavLinkItem => i.kind === 'link');
const tab = (to: string) => links.find((i) => i.to === to)!;
const activeTabs = (path: string) => links.filter((i) => isNavActive(i, path)).map((i) => i.to);

describe('bottom navigation', () => {
  it('has five places with the (+) in the middle', () => {
    expect(navItems.map((i) => (i.kind === 'add' ? '+' : i.to))).toEqual([
      '/',
      '/decks',
      '+',
      '/progress',
      '/profile',
    ]);
  });

  it('marks exactly one tab for each section of the app', () => {
    expect(activeTabs('/')).toEqual(['/']);
    expect(activeTabs('/decks')).toEqual(['/decks']);
    expect(activeTabs('/decks/abc')).toEqual(['/decks']);
    expect(activeTabs('/decks/suggested/freq-500')).toEqual(['/decks']);
    expect(activeTabs('/library')).toEqual(['/decks']);
    expect(activeTabs('/add')).toEqual(['/decks']);
    expect(activeTabs('/progress')).toEqual(['/progress']);
    expect(activeTabs('/profile')).toEqual(['/profile']);
    expect(activeTabs('/settings')).toEqual(['/profile']);
    expect(activeTabs('/settings/calisma')).toEqual(['/profile']);
  });

  it('does not match a path that only shares a prefix', () => {
    expect(isNavActive(tab('/decks'), '/decksx')).toBe(false);
    expect(navAlsoActive(tab('/profile'), '/settingsx')).toBe(false);
    expect(isNavActive(tab('/'), '/decks')).toBe(false);
  });
});
