import { describe, expect, it } from 'vitest';
import { LEGACY_PATHS, legacyRedirect } from './redirects';
import { isImmersive } from './routeHandle';

describe('old addresses', () => {
  it('sends each old place to its new home', () => {
    expect(legacyRedirect('/review')).toBe('/study?mode=word');
    expect(legacyRedirect('/more')).toBe('/study/more');
    expect(legacyRedirect('/kelime-bankasi')).toBe('/decks?tab=bank');
    expect(legacyRedirect('/stats')).toBe('/progress');
    expect(legacyRedirect('/settings/profile')).toBe('/settings/ilgi-alanlari');
  });

  it('keeps the query string (report tab, word bank filters)', () => {
    expect(legacyRedirect('/stats', '?tab=rapor')).toBe('/progress?tab=rapor');
    expect(legacyRedirect('/kelime-bankasi', '?level=B1')).toBe('/decks?level=B1&tab=bank');
    expect(legacyRedirect('/kelime-bankasi', '?tab=x')).toBe('/decks?tab=bank');
  });

  it('keeps the review screen’s own "ahead" mode', () => {
    expect(legacyRedirect('/review', '?mode=ahead')).toBe('/study?mode=ahead');
    expect(legacyRedirect('/review', '?from=push')).toBe('/study?mode=word&from=push');
  });

  it('ignores a trailing slash and leaves new paths alone', () => {
    expect(legacyRedirect('/review/')).toBe('/study?mode=word');
    expect(legacyRedirect('/')).toBeNull();
    expect(legacyRedirect('/decks')).toBeNull();
    expect(legacyRedirect('/decks/themes')).toBeNull();
    expect(legacyRedirect('/study', '?mode=word')).toBeNull();
  });

  it('has a redirect for every listed old path', () => {
    for (const p of LEGACY_PATHS)
      expect(legacyRedirect(`/${p}`)).not.toBeNull();
  });
});

describe('immersive routes', () => {
  const study = { immersive: (s: URLSearchParams) => s.has('mode') };
  it('decides from the query string when the route asks to', () => {
    expect(isImmersive([undefined, study], new URLSearchParams('mode=word'))).toBe(true);
    expect(isImmersive([undefined, study], new URLSearchParams(''))).toBe(false);
  });
  it('takes a plain flag as it is', () => {
    expect(isImmersive([{ immersive: true }], new URLSearchParams())).toBe(true);
    expect(isImmersive([null, {}], new URLSearchParams())).toBe(false);
  });
});
