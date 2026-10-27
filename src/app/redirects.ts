// Old addresses and where they live now (v0.5.1, ADR 0057; five places:
// Bugün · Kelimelerim · (+) · Keşfet · Profil). Bookmarks, shared links, notification taps
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

/** Copy of `search` without `drop`, with `set` applied on top. */
function moved(search: string, drop: string, set: Record<string, string>): URLSearchParams {
  const p = merge(search, set);
  p.delete(drop);
  return p;
}

/** Keşfet's filters (/kesfet?f=…); "hepsi" is the plain address. */
export const DISCOVER_FILTERS = ['okuma', 'desteler', 'kelimeler'] as const;

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
    case '/kitaplik':
      // The graded library is Keşfet's "Okuma" filter (with Metinlerim above it).
      return withParams('/kesfet', merge(search, { f: 'okuma' }));
    case '/decks': {
      // Desteler's old Keşfet and Okuma segments moved to the Keşfet tab; Destelerim and
      // Kelime bankası (?tab=bank) stay. Only the moved segments redirect.
      const tab = new URLSearchParams(search).get('tab');
      if (tab === 'discover') return withParams('/kesfet', moved(search, 'tab', { f: 'desteler' }));
      if (tab === 'reading') return withParams('/kesfet', moved(search, 'tab', { f: 'okuma' }));
      return null;
    }
    default:
      return null;
  }
}

/** The old paths the router redirects (each gets a redirecting route). */
export const LEGACY_PATHS = [
  'review',
  'more',
  'stats',
  'kelime-bankasi',
  'settings/profile',
  'kitaplik',
] as const;
