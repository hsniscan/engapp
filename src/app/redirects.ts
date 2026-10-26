// Old addresses of the four-tab app and where they live after the redesign (five places:
// Bugün · Desteler · (+) · İlerleme · Profil). Bookmarks, shared links, notification taps
// (/review) and the installed PWA's start URLs keep working. Pure: the router turns the
// result into a redirect before anything renders.

function withParams(path: string, params: URLSearchParams): string {
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}

/** Copy of `search` with `set` applied on top (the new place's own params win). */
function merge(search: string, set: Record<string, string>): URLSearchParams {
  const p = new URLSearchParams(search);
  for (const [k, v] of Object.entries(set)) p.set(k, v);
  return p;
}

/**
 * Where an old path goes now, keeping its query string; null for a path that is not old.
 * `search` is location.search ("?a=b" or "").
 */
export function legacyRedirect(pathname: string, search = ''): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  switch (path) {
    case '/review': {
      // The word study session; "?mode=ahead" (tomorrow's cards now) is the study screen's
      // own "ahead" mode.
      const p = new URLSearchParams(search);
      const out = new URLSearchParams({ mode: p.get('mode') === 'ahead' ? 'ahead' : 'word' });
      for (const [k, v] of p) if (k !== 'mode') out.append(k, v);
      return withParams('/study', out);
    }
    case '/more':
      // "Biraz daha çalış" (extra new cards, a practice round, tomorrow's cards) is offered on
      // the finished home screen and the session summary; its full page is /study/more.
      return withParams('/study/more', new URLSearchParams(search));
    case '/kelime-bankasi':
      return withParams('/decks', merge(search, { tab: 'bank' }));
    case '/stats':
      // ?tab=rapor (the weekly report) keeps working on İlerleme.
      return withParams('/progress', new URLSearchParams(search));
    case '/settings/profile':
      return withParams('/settings/ilgi-alanlari', new URLSearchParams(search));
    default:
      return null;
  }
}

/** The old paths the router redirects (each gets a redirecting route). */
export const LEGACY_PATHS = ['review', 'more', 'stats', 'kelime-bankasi', 'settings/profile'] as const;
