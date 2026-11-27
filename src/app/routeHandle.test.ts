import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { pageTitleOf, type RouteHandle } from './routeHandle';

const t = i18n.t.bind(i18n);
const m = (handle: RouteHandle | undefined, params = {}) => ({ handle, params });

describe('pageTitleOf', () => {
  it('names the deepest route that has a title', () => {
    expect(pageTitleOf([m(undefined), m({ title: 'home' })], t)).toBe('Bugün · Engapp');
    expect(pageTitleOf([m({ title: 'profile' }), m({ immersive: true })], t)).toBe(
      'Profil · Engapp',
    );
  });

  it('takes a title from the route params', () => {
    const title: RouteHandle['title'] = ({ section }, tt) =>
      tt(`settings.pages.${section}.title` as 'settings.pages.calisma.title');
    expect(pageTitleOf([m({ title }, { section: 'veri' })], t)).toBe('Yedek ve veri · Engapp');
  });

  it('falls back to the app name', () => {
    expect(pageTitleOf([m(undefined)], t)).toBe('Engapp');
  });
});
