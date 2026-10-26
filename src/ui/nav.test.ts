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
      '/kesfet',
      '/profile',
    ]);
  });

  it('marks exactly one tab for each section of the app', () => {
    expect(activeTabs('/')).toEqual(['/']);
    expect(activeTabs('/decks')).toEqual(['/decks']);
    expect(activeTabs('/decks/abc')).toEqual(['/decks']);
    expect(activeTabs('/decks/suggested/freq-500')).toEqual(['/decks']);
    expect(activeTabs('/decks/themes')).toEqual(['/decks']);
    expect(activeTabs('/library')).toEqual(['/decks']);
    expect(activeTabs('/kesfet')).toEqual(['/kesfet']);
    expect(activeTabs('/kitaplik')).toEqual(['/kesfet']);
    expect(activeTabs('/oku/abc')).toEqual(['/kesfet']);
    // İlerleme lives at the top of Profil (v0.5.1).
    expect(activeTabs('/progress')).toEqual(['/profile']);
    expect(activeTabs('/profile')).toEqual(['/profile']);
    expect(activeTabs('/settings')).toEqual(['/profile']);
    expect(activeTabs('/settings/calisma')).toEqual(['/profile']);
  });

  it('marks no tab on the (+) sheet\'s own flows', () => {
    expect(activeTabs('/add')).toEqual([]);
    expect(activeTabs('/import/anki')).toEqual([]);
  });

  it('does not match a path that only shares a prefix', () => {
    expect(isNavActive(tab('/decks'), '/decksx')).toBe(false);
    expect(navAlsoActive(tab('/profile'), '/settingsx')).toBe(false);
    expect(isNavActive(tab('/'), '/decks')).toBe(false);
    expect(isNavActive(tab('/kesfet'), '/okuma')).toBe(false);
  });
});
